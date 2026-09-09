/*
 * Turns a Zoho Self Client grant code into the four values `.env` needs.
 *
 *   npm run zoho:setup -- <client-id> <client-secret> <grant-code> [region]
 *
 * The grant code is single-use and short-lived, so if this fails, generate a
 * fresh one in the API console rather than re-running with the same code.
 *
 * It does two things a person should not have to do by hand: exchanges the code
 * for a long-lived refresh token, and then looks up the numeric `accountId`,
 * which is not shown anywhere in the Zoho Mail UI and is required on every send.
 *
 * Nothing is written to disk. The values are printed for you to paste into
 * `.env` yourself, because a script that edits a file holding live database
 * credentials is a worse idea than one extra copy and paste.
 */

/** Where each Zoho data centre lives. A token from one is rejected by another. */
const REGIONS = ['in', 'com', 'eu', 'au', 'jp', 'ca', 'sa'];

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
}

interface AccountsResponse {
  data?: {
    accountId?: string | number;
    primaryEmailAddress?: string;
    displayName?: string;
  }[];
}

function usage(message: string): never {
  console.error(
    `${message}\n\n` +
      'Usage:\n' +
      '  npm run zoho:setup -- <client-id> <client-secret> <grant-code> [region]\n\n' +
      `Region defaults to "in". Valid: ${REGIONS.join(', ')}.\n\n` +
      'Get the three values from https://api-console.zoho.in :\n' +
      '  1. Add a client, choose Self Client.\n' +
      '  2. Client ID and Client Secret are on the Client Secret tab.\n' +
      '  3. On Generate Code, use scope ZohoMail.messages.CREATE,ZohoMail.accounts.READ\n' +
      '     and copy the code it produces.',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const [clientId, clientSecret, code, region = 'in'] = process.argv.slice(2);

  if (!clientId || !clientSecret || !code) usage('Missing arguments.');
  if (!REGIONS.includes(region)) usage(`Unknown region "${region}".`);

  const accountsHost = `https://accounts.zoho.${region}`;
  const mailHost = `https://mail.zoho.${region}`;

  // ── 1. Grant code -> refresh token ────────────────────────────────────────
  console.log(`Exchanging the grant code at ${accountsHost} ...`);
  const tokenResponse = await fetch(`${accountsHost}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const token = (await tokenResponse
    .json()
    .catch(() => ({}))) as TokenResponse;

  // Zoho answers HTTP 200 with an `error` field for a bad or reused code, so
  // the status alone is not the verdict.
  if (token.error || !token.refresh_token) {
    console.error(
      `\nFailed: ${token.error ?? 'no refresh_token in the response'}\n\n` +
        (token.error === 'invalid_code'
          ? 'That code was already used or has expired. Generate a new one.\n'
          : token.access_token && !token.refresh_token
            ? 'Zoho returned an access token but no refresh token. That happens\n' +
              'when the code was generated without offline access — generate a\n' +
              'new code and make sure the duration is set on the console.\n'
            : 'Check the client id, the secret, and that the region matches the\n' +
              'console you generated the code in.\n'),
    );
    process.exit(1);
  }
  console.log('  got a refresh token');

  // ── 2. Which mailbox is it? ───────────────────────────────────────────────
  //
  // `accountId` is required on every send and is not surfaced in the Zoho Mail
  // interface, so it is fetched here rather than left as a scavenger hunt.
  console.log('Looking up the account id ...');
  const accountsResponse = await fetch(`${mailHost}/api/accounts`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Zoho-oauthtoken ${token.access_token ?? ''}`,
    },
  });

  const accounts = (await accountsResponse
    .json()
    .catch(() => ({}))) as AccountsResponse;
  const list = accounts.data ?? [];

  if (!accountsResponse.ok || list.length === 0) {
    console.error(
      `\nCould not read the account list (HTTP ${accountsResponse.status}).\n` +
        'The refresh token below is still valid — add the ZohoMail.accounts.READ\n' +
        'scope and regenerate if you need this step to work, or find the account\n' +
        'id another way.\n\n' +
        `MAIL_ZOHO_REFRESH_TOKEN=${token.refresh_token}\n`,
    );
    process.exit(1);
  }

  if (list.length > 1) {
    console.log(`  ${list.length} mailboxes on this account:`);
    for (const account of list) {
      console.log(
        `    ${String(account.accountId)}  ${account.primaryEmailAddress ?? ''}`,
      );
    }
    console.log('  using the first; pick another by hand if that is wrong.');
  }

  const account = list[0];
  console.log(`  ${account.primaryEmailAddress ?? 'account'} -> ${String(account.accountId)}`);

  // ── 3. What to paste ──────────────────────────────────────────────────────
  console.log(
    '\nAdd these to your .env, and the same five to Render:\n\n' +
      'MAIL_TRANSPORT=zoho-api\n' +
      `MAIL_ZOHO_CLIENT_ID=${clientId}\n` +
      `MAIL_ZOHO_CLIENT_SECRET=${clientSecret}\n` +
      `MAIL_ZOHO_REFRESH_TOKEN=${token.refresh_token}\n` +
      `MAIL_ZOHO_ACCOUNT_ID=${String(account.accountId)}\n` +
      `MAIL_ZOHO_REGION=${region}\n\n` +
      'Leave MAIL_FROM as it is. MAIL_HOST, MAIL_PORT, MAIL_SECURE, MAIL_USER\n' +
      'and MAIL_PASS are ignored while MAIL_TRANSPORT is zoho-api — keep them,\n' +
      'so switching back is one line.\n\n' +
      'The refresh token does not expire. Treat it like a password.\n\n' +
      'Then check it end to end:  npm run check:mail you@example.com\n',
  );
}

main().catch((error) => {
  console.error('zoho:setup failed:', error);
  process.exit(1);
});
