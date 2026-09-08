import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { Company } from './entities/company.entity';

/**
 * The businesses inside a workspace, and the branding a candidate is shown.
 *
 * The service is exported because the assessments module has to validate a
 * company id before writing it: the id comes from the client, and an
 * unvalidated one would let a recruiter put another customer's logo and support
 * address in front of their own candidates.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Company])],
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
