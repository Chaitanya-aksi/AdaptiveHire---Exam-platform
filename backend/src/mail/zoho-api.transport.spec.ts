import type MailMessage from 'nodemailer/lib/mailer/mail-message';
import { ZohoApiTransport, addressList } from './zoho-api.transport';

/**
 * The transport is the one piece of this route with no safety net: a mistake
 * here is an email that silently does not arrive, which is exactly the failure
 * it was written to end. So the cases covered are the ones that fail quietly —
 * a 200 carrying an error, an expired token, a burst of concurrent sends — not
 * the happy path alone.
 */

const CONFIG = {
  clientId: 'cid',
  clientSecret: 'secret',
  refreshToken: 'refresh',
  accountId: '12345',
  region: 'in',
};

/** A message shaped the way nodemailer hands one to a transport. */
const message = (overrides: Record<string, unknown> = {}) =>
  ({
    data: {
      from: 'AdaptiveHire <ds09.user@aksiaerospace.com>',
      to: 'candidate@example.com',
      subject: 'You have been invited',
      text: 'plain body',
      html: '<p>html body</p>',
      ...overrides,
    },
  }) as unknown as MailMessage;

const send = (transport: ZohoApiTransport, mail: MailMessage) =>
  new Promise<unknown>((resolve, reject) => {
    transport.send(mail, (error, info) =>
      error ? reject(error) : resolve(info),
    );
  });

const tokenOk = { access_token: 'access-1', expires_in: 3600 };
const sendOk = { status: { code: 200, description: 'success' }, data: { messageId: 'm-1' } };

function mockFetch(
  responses: { status?: number; body: unknown }[],
): jest.Mock {
  const fn = jest.fn();
  for (const { status = 200, body } of responses) {
    fn.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  }
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => jest.restoreAllMocks());

describe('ZohoApiTransport', () => {
  it('sends the fields Zoho actually accepts', async () => {
    const fetchMock = mockFetch([{ body: tokenOk }, { body: sendOk }]);
    const transport = new ZohoApiTransport(CONFIG);

    const info = (await send(transport, message())) as { messageId: string };

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://mail.zoho.in/api/accounts/12345/messages');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Zoho-oauthtoken access-1',
    );

    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      fromAddress: 'AdaptiveHire <ds09.user@aksiaerospace.com>',
      toAddress: 'candidate@example.com',
      subject: 'You have been invited',
      // HTML wins over text, and the format field has to agree with it.
      content: '<p>html body</p>',
      mailFormat: 'html',
    });
    expect(info.messageId).toBe('m-1');
  });

  it('falls back to the plain-text body when there is no HTML', async () => {
    mockFetch([{ body: tokenOk }, { body: sendOk }]);
    const transport = new ZohoApiTransport(CONFIG);

    await send(transport, message({ html: undefined }));

    const body = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[1][1].body as string,
    );
    expect(body).toMatchObject({ content: 'plain body', mailFormat: 'plaintext' });
  });

  /*
   * The trap that makes this worth testing. Zoho answers HTTP 200 with a
   * failure in the payload, so `response.ok` alone reports a send that never
   * happened as a success — and the caller would mark the job complete and
   * delete it.
   */
  it('treats a 200 carrying an error status as a failure', async () => {
    mockFetch([
      { body: tokenOk },
      { body: { status: { code: 500, description: 'Invalid from address' } } },
    ]);
    const transport = new ZohoApiTransport(CONFIG);

    await expect(send(transport, message())).rejects.toThrow(
      /Invalid from address/,
    );
  });

  it('refuses a token response that carries an error instead of a token', async () => {
    mockFetch([{ body: { error: 'invalid_client' } }]);
    const transport = new ZohoApiTransport(CONFIG);

    await expect(send(transport, message())).rejects.toThrow(/invalid_client/);
  });

  it('retries once with a fresh token after a 401', async () => {
    const fetchMock = mockFetch([
      { body: tokenOk },
      { status: 401, body: {} },
      { body: { access_token: 'access-2', expires_in: 3600 } },
      { body: sendOk },
    ]);
    const transport = new ZohoApiTransport(CONFIG);

    await send(transport, message());

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const retry = fetchMock.mock.calls[3][1] as RequestInit;
    expect((retry.headers as Record<string, string>).Authorization).toBe(
      'Zoho-oauthtoken access-2',
    );
  });

  it('reuses one access token across sends', async () => {
    const fetchMock = mockFetch([
      { body: tokenOk },
      { body: sendOk },
      { body: sendOk },
    ]);
    const transport = new ZohoApiTransport(CONFIG);

    await send(transport, message());
    await send(transport, message());

    // Three calls, not four: the second send does not re-authenticate.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  /*
   * The queue processes several emails at once. Without collapsing the
   * refresh, a cold start with five invitations would fire five token requests
   * at Zoho simultaneously, which is both wasteful and a good way to meet a
   * rate limiter mid-burst.
   */
  it('collapses concurrent cold-start sends onto one token request', async () => {
    const fetchMock = mockFetch([
      { body: tokenOk },
      { body: sendOk },
      { body: sendOk },
      { body: sendOk },
    ]);
    const transport = new ZohoApiTransport(CONFIG);

    await Promise.all([
      send(transport, message()),
      send(transport, message()),
      send(transport, message()),
    ]);

    const tokenCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/oauth/v2/token'),
    );
    expect(tokenCalls).toHaveLength(1);
  });

  it('refuses a message with no recipient rather than posting it', async () => {
    const fetchMock = mockFetch([{ body: tokenOk }]);
    const transport = new ZohoApiTransport(CONFIG);

    await expect(send(transport, message({ to: undefined }))).rejects.toThrow(
      /No recipients/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the configured data centre', async () => {
    const fetchMock = mockFetch([{ body: tokenOk }, { body: sendOk }]);
    await send(
      new ZohoApiTransport({ ...CONFIG, region: 'com' }),
      message(),
    );

    expect(String(fetchMock.mock.calls[0][0])).toContain('accounts.zoho.com');
    expect(String(fetchMock.mock.calls[1][0])).toContain('mail.zoho.com');
  });

  it('carries cc and bcc only when they are set', async () => {
    mockFetch([{ body: tokenOk }, { body: sendOk }]);
    await send(
      new ZohoApiTransport(CONFIG),
      message({ cc: ['a@example.com', 'b@example.com'] }),
    );

    const body = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[1][1].body as string,
    );
    expect(body.ccAddress).toBe('a@example.com,b@example.com');
    expect(body).not.toHaveProperty('bccAddress');
  });
});

describe('addressList', () => {
  it('flattens every shape nodemailer produces', () => {
    expect(addressList('a@example.com')).toEqual(['a@example.com']);
    expect(addressList({ name: 'A', address: 'a@example.com' })).toEqual([
      'A <a@example.com>',
    ]);
    expect(
      addressList(['a@example.com', { address: 'b@example.com' }]),
    ).toEqual(['a@example.com', 'b@example.com']);
    expect(addressList(undefined)).toEqual([]);
    // An object with no address is dropped rather than sent as "undefined".
    expect(addressList({ name: 'nobody' })).toEqual([]);
  });
});

/**
 * The failure that actually happened in production, and the one this message
 * has to get right.
 *
 * Zoho answers HTTP 200 with `IP_NOT_ALLOWED` when its account-level IP
 * Restriction is on and the caller is not on the allowlist. The credentials are
 * valid — the same refresh token works from an allowed machine — so reporting
 * it as "check your client id and secret" sends the reader to inspect four
 * correct values while the real cause is a setting in a different console.
 */
describe('ZohoApiTransport IP_NOT_ALLOWED', () => {
  const message = () =>
    ({
      data: {
        from: 'AdaptiveHire <ds09.user@aksiaerospace.com>',
        to: 'candidate@example.com',
        subject: 's',
        text: 't',
      },
    }) as unknown as MailMessage;

  const send = (t: ZohoApiTransport) =>
    new Promise((resolve, reject) => {
      t.send(message(), (e, i) => (e ? reject(e) : resolve(i)));
    });

  beforeEach(() => {
    // A 200 carrying an error body, which is the shape Zoho actually returns.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ error: 'IP_NOT_ALLOWED' }),
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('names the real cause instead of blaming the credentials', async () => {
    const transport = new ZohoApiTransport({
      clientId: 'cid',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      accountId: '123',
      region: 'in',
    });

    const error = await send(transport).catch((e: Error) => e);
    const text = (error as Error).message;

    expect(text).toContain('IP_NOT_ALLOWED');
    expect(text).toMatch(/credentials are fine/i);
    expect(text).toMatch(/Allowed IP Address/i);
    // The point: it must NOT send the reader back to the env vars.
    expect(text).not.toContain('MAIL_ZOHO_CLIENT_ID');
  });
});
