import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organisation } from './entities/organisation.entity';
import { OrganisationsService } from './organisations.service';

/**
 * Organisations have no controller of their own yet: one is created as a side
 * effect of a recruiter registering, and there is nothing else to do to it. The
 * service is exported for the auth module, which owns that signup.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Organisation])],
  providers: [OrganisationsService],
  exports: [OrganisationsService],
})
export class OrganisationsModule {}
