import { resolveCname, resolveTxt } from 'node:dns/promises';
import { createConnection, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import * as nodemailer from 'nodemailer';
import { ZohoApiTransport } from '../../mail/zoho-api.transport';

/** What both transports report back after a send. */
interface SendReceipt {
  response?: string;
  messageId?: string;
  rejected?: (string | { address: string })[];
}

/*
 * Proves the whole email chain, or says exactly which link is broken.
 *
 *   npm run check:mail                    # config, port, AUTH and DNS
 *   npm run check:mail you@example.com    # the above, then a real send
 *
 * Written after an outage that lasted about a month unnoticed. Every layer
 * failed silently in its own way: Render blocks outbound SMTP on 25, 465 and
 * 587, so sends timed out; the API answers success as soon as a job is queued,
 * so the UI always said "invited"; and invite jobs carry a plaintext password
 * so they are queued `removeOnFail: true` and delete their own evidence when
 * the retries run out. The failure was real, logged, and in a place nobody
 * looked.
 *
 * So this checks the things that break independently, and prints a verdict per
 * link rather than one pass/fail:
 *
 *   1. Is the transport even configured, or is it silently on the dev fallback?
 *   2. Is the port reachable from HERE? (Run it on the host that sends.)
 *   3. Does the server offer encryption, and do the credentials authenticate?
 *   4. Does DNS authorise this provider to send as your domain?
 *   5. Does a real message actually leave?
 *
 * Step 4 is the one that bites after a provider switch. Mail to your own tenant
 * keeps working while Gmail quietly starts filtering, because the receiving
 * side is the only thing that checks.
 *
 * MAIL_PASS is never printed. Only its presence and length.
 */

const RESET = '\x1b[0m';
const ok = (s: string) => `\x1b[32m  OK   ${s}${RESET}`;
const bad = (s: string) => `\x1b[31m  FAIL ${s}${RESET}`;
const warn = (s: string) => `\x1b[33m  WARN ${s}${RESET}`;
const info = (s: string) => `       ${s}`;

/** Providers whose SPF include we can recognise, by the host you send through. */
const SPF_HINTS: { match: RegExp; include: string; label: string }[] = [
  { match: /zeptomail/i, include: 'zeptomail', label: 'ZeptoMail' },
  { match: /zoho/i, include: 'zohomail', label: 'Zoho Mail' },
  { match: /sendgrid/i, include: 'sendgrid', label: 'SendGrid' },
  { match: /mailgun/i, include: 'mailgun', label: 'Mailgun' },
  { match: /brevo|sendinblue/i, include: 'spf.brevo', label: 'Brevo' },
];

/**
 * Opens a socket and reads the SMTP greeting plus the EHLO capabilities.
 *
 * `secure` decides which kind of socket, and it is not cosmetic. Port 465 is
 * implicit TLS: the server sends **nothing at all** until a TLS handshake
 * completes, so a plaintext probe sits there until it times out and reports a
 * perfectly healthy port as unreachable. Ports 587 and 2525 are the opposite —
 * plaintext first, then STARTTLS.
 */
function probe(
  host: string,
  port: number,
  secure: boolean,
): Promise<{ reachable: boolean; banner: string; capabilities: string[] }> {
  return new Promise((resolve) => {
    const socket: Socket = secure
      ? tlsConnect({ host, port, servername: host, timeout: 15000 })
      : createConnection({ host, port, timeout: 15000 });
    let buffer = '';
    let greeted = false;

    const done = (reachable: boolean) => {
      socket.destroy();
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      resolve({
        reachable,
        banner: lines[0] ?? '',
        capabilities: lines.filter((l) => /^250[- ]/.test(l)),
      });
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (!greeted && buffer.includes('\n')) {
        greeted = true;
        socket.write('EHLO adaptivehire.check\r\n');
        return;
      }
      // A bare "250 " (not "250-") is the last capability line.
      if (/\r?\n250 /.test(buffer) || buffer.length > 4096) done(true);
    });
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

/**
 * The bounce subdomain a provider asks you to CNAME at it, if it resolves.
 *
 * This is how ZeptoMail and several others authorise sending without touching
 * your SPF record: the envelope sender moves to a subdomain of yours that
 * points at theirs, so SPF is evaluated against a record they control.
 */
async function bounceDelegation(domain: string): Promise<string | null> {
  for (const label of ['bounce-zem', 'bounce', 'bounces', 'em']) {
    try {
      const target = await resolveCname(`${label}.${domain}`);
      if (target.length) return `${label}.${domain} -> ${target[0]}`;
    } catch {
      // Not present; try the next conventional name.
    }
  }
  return null;
}

/**
 * Any published DKIM selector, tried against the conventional names.
 *
 * Selectors are arbitrary — ZeptoMail issues a numeric one — so this cannot be
 * exhaustive and a miss is reported as a warning rather than a failure. The
 * provider console is the authority on whether the record has landed.
 */
async function anyDkimSelector(domain: string): Promise<string | null> {
  const candidates = ['zoho', 'zmail', 'default', 's1', 's2', 'google', 'k1'];
  for (const selector of candidates) {
    try {
      const records = await resolveTxt(`${selector}._domainkey.${domain}`);
      if (records.length) return `${selector}._domainkey.${domain}`;
    } catch {
      // Not this one.
    }
  }
  return null;
}

async function main(): Promise<void> {
  /*
   * The first argument that looks like an address.
   *
   * Not `argv[2]`: the npm script passes `dotenv_config_path=../.env` through,
   * so positional indexing picked that up and tried to mail it, failing with
   * "No recipients defined" on a run that was otherwise clean. Matching on the
   * shape of the value is what keeps this working however the script is
   * invoked.
   */
  const recipient = process.argv
    .slice(2)
    .find((arg) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(arg));

  /*
   * Which route mail actually takes, read exactly as `configuration.ts` reads
   * it. Anything but the literal 'zoho-api' means SMTP, so a typo checks the
   * transport that is really in use rather than the one that was intended.
   */
  const transport =
    process.env.MAIL_TRANSPORT === 'zoho-api' ? 'zoho-api' : 'smtp';
  const zoho = {
    clientId: process.env.MAIL_ZOHO_CLIENT_ID ?? '',
    clientSecret: process.env.MAIL_ZOHO_CLIENT_SECRET ?? '',
    refreshToken: process.env.MAIL_ZOHO_REFRESH_TOKEN ?? '',
    accountId: process.env.MAIL_ZOHO_ACCOUNT_ID ?? '',
    region: process.env.MAIL_ZOHO_REGION ?? 'in',
  };

  const host = process.env.MAIL_HOST ?? '';
  const port = Number(process.env.MAIL_PORT ?? 587);
  const secure = process.env.MAIL_SECURE === 'true';
  const user = process.env.MAIL_USER ?? '';
  const pass = process.env.MAIL_PASS ?? '';
  const from = process.env.MAIL_FROM ?? '';

  let failures = 0;
  const fail = (m: string) => {
    failures += 1;
    console.log(bad(m));
  };

  /**
   * The same transporter the app would build, for whichever route is selected.
   *
   * Built here rather than inline so section 5 sends through exactly what
   * production would use. A check that sent by some other means would prove
   * something about the check rather than about the deployment.
   */
  /*
   * Only the fields section 5 reads back.
   *
   * Named because `nodemailer.Transporter` with no type argument is
   * `Transporter<any>`, which makes every field of the receipt an `any` and
   * silently unchecks the four lines that print it. The two transports return
   * different shapes — SMTP's own `SentMessageInfo` and the Zoho API's — and
   * this is the part they agree on.
   */
  const buildTransporter = (): nodemailer.Transporter<SendReceipt> =>
    transport === 'zoho-api'
      ? nodemailer.createTransport(new ZohoApiTransport(zoho))
      : nodemailer.createTransport({
          host,
          port,
          secure,
          auth: user || pass ? { user, pass } : undefined,
          connectionTimeout: 20000,
          greetingTimeout: 20000,
        });

  // ── 1. Configuration ─────────────────────────────────────────────────────
  console.log('\n1. Transport configuration');

  /*
   * The API route answers the same five questions, but two of them differently.
   *
   * Probing a port and calling `verify()` are questions about SMTP. Asked of an
   * HTTPS transport they mean nothing, and reporting their failure would be the
   * exact confusion this script exists to remove. So sections 2 and 3 ask the
   * equivalent instead: is the data centre reachable on 443, and does the
   * refresh token still mint an access token? Sections 4 and 5 are shared,
   * because DNS and a real delivery are the same question either way.
   */
  if (transport === 'zoho-api') {
    console.log(ok(`transport zoho-api (mail.zoho.${zoho.region})`));
    for (const [label, value] of [
      ['MAIL_ZOHO_CLIENT_ID', zoho.clientId],
      ['MAIL_ZOHO_CLIENT_SECRET', zoho.clientSecret],
      ['MAIL_ZOHO_REFRESH_TOKEN', zoho.refreshToken],
      ['MAIL_ZOHO_ACCOUNT_ID', zoho.accountId],
    ] as const) {
      if (value) console.log(ok(`${label} set (${value.length} chars)`));
      else fail(`${label} is empty.`);
    }
    console.log(from ? ok(`from ${from}`) : warn('MAIL_FROM is empty'));

    console.log(`\n2. Can this machine reach mail.zoho.${zoho.region} on 443?`);
    const reachStarted = Date.now();
    try {
      // 401 is the expected answer without a token, and it still proves the
      // host answered, which is all this section asks.
      const answer = await fetch(
        `https://mail.zoho.${zoho.region}/api/accounts`,
      );
      console.log(
        ok(`answered ${answer.status} in ${Date.now() - reachStarted}ms`),
      );
      console.log(
        info('Port 443, so no SMTP port block applies. That is the point.'),
      );
    } catch (error) {
      fail(`unreachable: ${(error as Error).message}`);
    }

    console.log('\n3. Does the refresh token still work?');
    const tokenStarted = Date.now();
    try {
      const answer = await fetch(
        `https://accounts.zoho.${zoho.region}/oauth/v2/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            refresh_token: zoho.refreshToken,
            client_id: zoho.clientId,
            client_secret: zoho.clientSecret,
            grant_type: 'refresh_token',
          }),
        },
      );
      const payload = (await answer.json().catch(() => ({}))) as {
        access_token?: string;
        error?: string;
      };
      // Zoho answers HTTP 200 with an `error` field for a bad grant, so the
      // status code on its own is not the verdict.
      if (payload.error || !payload.access_token) {
        fail(`refused: ${payload.error ?? 'no access_token returned'}`);
        console.log(
          info('Re-run `npm run zoho:setup` with a fresh grant code,'),
        );
        console.log(
          info('and check MAIL_ZOHO_REGION matches the console you used.'),
        );
      } else {
        console.log(
          ok(`access token issued in ${Date.now() - tokenStarted}ms`),
        );
      }
    } catch (error) {
      fail((error as Error).message);
    }
  } else if (!host) {
    fail('MAIL_HOST is empty.');
    console.log(
      info('The app falls back to an Ethereal test inbox: sends "succeed" and'),
    );
    console.log(
      info('reach nobody. This is the failure that looks like success.'),
    );
    process.exitCode = 1;
    return;
  } else {
    console.log(ok(`transport smtp — host ${host}:${port} secure=${secure}`));
    console.log(
      pass
        ? ok(
            `credentials present (user "${user}", password ${pass.length} chars)`,
          )
        : warn('no MAIL_PASS set — fine only if this relay needs no auth'),
    );
    if (!from) console.log(warn('MAIL_FROM is empty'));
    else console.log(ok(`from ${from}`));

    // Port 465 is implicit TLS and needs secure=true; 587 and 2525 are STARTTLS
    // and need secure=false. Getting this pair wrong produces a hang, not an
    // error, which is indistinguishable from a blocked port.
    if (port === 465 && !secure) {
      fail('port 465 needs MAIL_SECURE=true — it is implicit TLS.');
    }
    if ((port === 587 || port === 2525) && secure) {
      fail(`port ${port} needs MAIL_SECURE=false — it upgrades via STARTTLS.`);
    }

    // ── 2. Reachability ────────────────────────────────────────────────────
    console.log(`\n2. Can this machine reach ${host}:${port}?`);
    const reach = await probe(host, port, secure);
    if (!reach.reachable) {
      fail(`no answer on port ${port}.`);
      console.log(
        info('A timeout here is usually the host blocking the port, not'),
      );
      console.log(
        info('the mail provider. Render blocks 25, 465 and 587 on free'),
      );
      console.log(
        info('web services; 2525 is not blocked. Run this ON the machine'),
      );
      console.log(
        info('that sends — passing on your laptop proves nothing about it.'),
      );
    } else {
      console.log(ok(reach.banner.slice(0, 90)));
      const starttls = reach.capabilities.some((c) => /STARTTLS/i.test(c));
      console.log(
        starttls || secure
          ? ok(secure ? 'implicit TLS' : 'STARTTLS offered')
          : warn(
              'no STARTTLS offered and secure=false — mail would go in clear',
            ),
      );
    }

    // ── 3. Authentication ──────────────────────────────────────────────────
    console.log('\n3. Do the credentials authenticate?');
    const started = Date.now();
    try {
      await buildTransporter().verify();
      console.log(ok(`AUTH accepted in ${Date.now() - started}ms`));
    } catch (error) {
      fail(`${(error as Error).message} (after ${Date.now() - started}ms)`);
    }
  }

  // ── 4. DNS authorisation ─────────────────────────────────────────────────
  //
  // The check that survives a provider switch. Your own tenant will keep
  // accepting mail whatever DNS says; Gmail will not.
  const domain = (from.match(/<([^>]+)>/)?.[1] ?? from).split('@')[1]?.trim();
  /*
   * Which host DNS is being asked about, per transport.
   *
   * This read `host` regardless, which on the API route is whatever MAIL_HOST
   * still says — a value that transport never uses. It gave the right verdict
   * here only because the leftover was `smtp.zoho.in` and the Zoho hint matched
   * it; clearing MAIL_HOST would have reported "unrecognised provider" while
   * sending perfectly well. A diagnostic that is right by luck is one that will
   * be wrong later.
   */
  const providerHost =
    transport === 'zoho-api' ? `mail.zoho.${zoho.region}` : host;

  console.log(
    `\n4. Does DNS authorise ${providerHost} to send as ${domain ?? '?'}?`,
  );
  if (!domain) {
    console.log(warn('could not read a domain out of MAIL_FROM'));
  } else {
    try {
      const txt = (await resolveTxt(domain)).map((r) => r.join(''));
      const spf = txt.find((r) => r.toLowerCase().startsWith('v=spf1'));
      if (!spf) {
        fail(`no SPF record on ${domain}.`);
      } else {
        console.log(info(spf));
        const hint = SPF_HINTS.find((h) => h.match.test(providerHost));
        const bounce = await bounceDelegation(domain);

        if (!hint) {
          console.log(
            warn('unrecognised provider — check the include by hand'),
          );
        } else if (spf.toLowerCase().includes(hint.include)) {
          console.log(ok(`SPF includes ${hint.label}`));
        } else if (bounce) {
          /*
           * No SPF include, and that is correct for ZeptoMail.
           *
           * It does not ask you to list its servers in your SPF. It gives you a
           * `bounce-zem` CNAME instead, which delegates the envelope sender to
           * a domain it already publishes SPF for. The receiving server checks
           * SPF against that bounce domain, not against yours, so your record
           * stays untouched — which is the safer arrangement, since editing it
           * is how people accidentally stop authorising their normal mail.
           *
           * Alignment for DMARC then comes from DKIM, whose signature carries
           * your own domain. That is why the DKIM record below is the one that
           * actually has to be right.
           */
          console.log(ok(`bounce delegation present: ${bounce}`));
          console.log(
            info(
              `${hint.label} authenticates by DKIM plus this CNAME, so no SPF ` +
                'include is needed and your existing record is left alone.',
            ),
          );
        } else {
          fail(`neither an SPF include for ${hint.label} nor a bounce CNAME.`);
          console.log(
            info('Add the records the provider console lists, then re-run.'),
          );
          console.log(
            info(
              'If you do add an SPF include, put it in the EXISTING record — ' +
                'two SPF records is itself a failure.',
            ),
          );
          console.log(
            info(
              'Until then Gmail may spam or reject; your own tenant will not.',
            ),
          );
        }

        // DKIM is what carries your domain into the signature, so on a
        // provider that skips SPF it is the whole of the alignment story.
        const dkim = await anyDkimSelector(domain);
        console.log(
          dkim
            ? ok(`DKIM published at ${dkim}`)
            : warn(
                'no DKIM selector found at the usual names — if the provider ' +
                  'console still says Pending, the TXT record has not landed',
              ),
        );
      }
    } catch {
      fail(`could not resolve TXT for ${domain}.`);
    }

    try {
      const dmarc = (await resolveTxt(`_dmarc.${domain}`))
        .map((r) => r.join(''))
        .find((r) => r.toLowerCase().startsWith('v=dmarc1'));
      console.log(dmarc ? ok(`DMARC: ${dmarc}`) : warn('no DMARC record'));
    } catch {
      console.log(
        warn(
          'no DMARC record — not fatal, but it is what turns a silent filtering ' +
            'problem into a report you receive',
        ),
      );
    }
  }

  // ── 5. A real message ────────────────────────────────────────────────────
  if (!recipient) {
    console.log(
      '\n5. Delivery — skipped. Pass an address to send a real test:',
    );
    console.log(info('npm run check:mail you@example.com'));
  } else {
    console.log(`\n5. Sending a real message to ${recipient}`);
    try {
      const sent = Date.now();
      const receipt = await buildTransporter().sendMail({
        from,
        to: recipient,
        subject: 'AdaptiveHire mail check',
        text:
          'If you are reading this, the transport works end to end.\n\n' +
          'Check the headers for spf=pass and dkim=pass before trusting it ' +
          'for candidates on Gmail or Outlook.\n',
      });
      console.log(ok(`accepted in ${Date.now() - sent}ms`));
      console.log(info(`server said: ${receipt.response}`));
      console.log(info(`message id:  ${receipt.messageId}`));
      if (receipt.rejected?.length) {
        // SMTP reports plain addresses; other transports report objects.
        // Joining the raw array would print "[object Object]" and hide which
        // recipient was actually refused, on the one line that matters here.
        const refused = receipt.rejected.map((r) =>
          typeof r === 'string' ? r : r.address,
        );
        fail(`rejected: ${refused.join(', ')}`);
      }
      console.log(
        info(
          'Accepted is not delivered. Open it, view the original, and confirm ' +
            'spf=pass and dkim=pass.',
        ),
      );
    } catch (error) {
      fail((error as Error).message);
    }
  }

  console.log(
    failures === 0
      ? '\nAll checks passed.\n'
      : `\n${failures} check(s) failed — see above.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('check:mail crashed:', error);
  process.exitCode = 1;
});
