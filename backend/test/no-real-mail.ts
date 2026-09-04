/**
 * Guarantees an e2e run never sends real email.
 *
 * Every suite creates invitations, provisioned accounts and candidate messages
 * on the reserved `@e2e.local` domain, and each one enqueues a genuine invite
 * job. With a real `MAIL_HOST` configured, the worker pushes all of them
 * through live SMTP to a TLD that does not exist — a burst of sends to invalid
 * recipients, which is exactly the shape that trips a provider's reputation
 * block. Fifteen runs in one morning produced 51 failed jobs and took the
 * sending account down for real invitations too.
 *
 * Blanking `MAIL_HOST` selects the mailer's own no-real-delivery path (see
 * `createTransporter` in `mail/mail.service.ts`): a throwaway Ethereal inbox,
 * falling back to logging the serialised message when Ethereal is unreachable.
 * Neither reaches a real address.
 *
 * **Why an empty string rather than `delete`,** which is the part worth
 * knowing: this file runs through `setupFiles`, which Jest executes *before*
 * anything loads the `.env` — measured, not assumed; `MAIL_HOST` is still
 * `undefined` at this point. `@nestjs/config` then fills in only those keys
 * that are absent from `process.env`. Assigning `''` makes the key present, so
 * the real value in `.env` is skipped rather than applied. Deleting the key, or
 * setting it after the config module had loaded, would leave the real host in
 * place and send the mail for real.
 */
process.env.MAIL_HOST = '';
