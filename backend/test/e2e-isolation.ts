/**
 * Keeps an e2e run from leaking into the real world. Two separate leaks, and
 * the second is the one that actually bit.
 *
 * Every suite creates invitations, provisioned accounts and candidate messages
 * on the reserved `@e2e.local` domain, and each one enqueues a genuine invite
 * job.
 *
 * **1. The mail transport.** With a real `MAIL_HOST`, this process would push
 * those through live SMTP to a TLD that does not exist — a burst of sends to
 * invalid recipients, which is the shape that trips a provider's reputation
 * block. Blanking it selects the mailer's own no-real-delivery path (see
 * `createTransporter` in `mail/mail.service.ts`): a throwaway Ethereal inbox,
 * falling back to logging the serialised message.
 *
 * **2. The queue, which the transport does not cover.** BullMQ queues are
 * shared by key: *any* worker on this Redis using the same prefix will consume
 * jobs enqueued by anyone else, configured however it likes. Blanking
 * `MAIL_HOST` here changes only this process's transporter — a developer's dev
 * server, running from the same repo with the real `.env`, happily picked the
 * test invitations off the shared queue and sent them through live Zoho.
 * Observed: 50 `550 5.4.6 Unusual sending activity detected` failures in a
 * thirteen-minute window, from runs whose own SMTP host was unresolvable.
 *
 * So the run takes its own queue namespace. Test jobs then land somewhere no
 * real worker is watching, which holds whether or not anyone remembers to stop
 * their dev server.
 *
 * **Why empty strings and not `delete`:** this runs through `setupFiles`, which
 * Jest executes *before* anything loads the `.env` — measured, not assumed;
 * both variables are still `undefined` at this point. `@nestjs/config` then
 * fills in only those keys absent from `process.env`, so assigning a value here
 * makes the key present and the `.env` entry is skipped. Setting either of
 * these after the config module had loaded would be too late.
 */
import { E2E_BULL_PREFIX } from './e2e.constants';

process.env.MAIL_HOST = '';
process.env.BULL_PREFIX = E2E_BULL_PREFIX;
