import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organisation } from './entities/organisation.entity';
import { OrganisationsController } from './organisations.controller';
import { OrganisationsService } from './organisations.service';

/**
 * A workspace is created as a side effect of a recruiter registering, so the
 * service is exported for the auth module which owns that signup. The
 * controller exists for the one thing a workspace has that can be changed
 * afterwards: how it presents itself to the candidates it assesses.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Organisation])],
  controllers: [OrganisationsController],
  providers: [OrganisationsService],
  exports: [OrganisationsService],
})
export class OrganisationsModule {}
