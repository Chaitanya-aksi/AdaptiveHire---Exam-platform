import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Global so any queue worker can inject MailService without re-importing the
 * module. It holds a single nodemailer transport.
 */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
