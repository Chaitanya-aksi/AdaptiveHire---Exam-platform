import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { AuthService } from '../../auth/auth.service';

/*
 * Prints a working password-reset link for one account, without sending email.
 *
 *   npx ts-node src/database/seeds/issue-reset-link.ts <email>
 *
 * The way back in when the mail transport is the thing that is broken. The
 * forgot-password flow works end to end — it writes a token, queues the job, and
 * hands the message to SMTP — so when the SMTP account is blocked or rate
 * limited there is nothing to fix in the application and nobody can reset a
 * password. This mints the same token the email would have carried and puts the
 * link on the operator's terminal instead of in an inbox.
 *
 * The link it prints is a live credential: it changes the account's password for
 * whoever opens it, for the next hour. Treat it exactly as you would the
 * emailed one — send it to the account's owner over something you trust, and do
 * not paste it into a shared channel or leave it in scrollback. It is single-use
 * and redeeming it burns every other outstanding link on the account.
 *
 * Prints nothing identifying for an address with no account, for the same
 * reason the HTTP endpoint says nothing: this is an ordinary lookup, and the
 * habit of not answering "does this person have an account" is worth keeping
 * even where the audience is an administrator.
 */
async function main() {
  const [email] = process.argv.slice(2);
  if (!email) {
    throw new Error('Usage: issue-reset-link.ts <email>');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  try {
    const auth = app.get(AuthService);
    const issued = await auth.issueResetLinkForOperator(email);

    if (!issued) {
      console.log(
        `\nNo account matches ${email.trim()}. Nothing was issued.\n`,
      );
      return;
    }

    console.log(
      [
        '',
        `Reset link for ${email.trim()} — valid for ${issued.expiresInMinutes} minutes, single use:`,
        '',
        `  ${issued.resetUrl}`,
        '',
        'Anyone holding this link can set the password on that account. Give it',
        'to its owner directly and do not leave it in a shared log.',
        '',
      ].join('\n'),
    );
  } finally {
    await app.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
