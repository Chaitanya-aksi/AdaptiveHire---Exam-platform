import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModuleCatalogEntry } from './entities/module.entity';
import { ModulesCatalogController } from './modules-catalog.controller';
import { ModulesCatalogService } from './modules-catalog.service';

@Module({
  imports: [TypeOrmModule.forFeature([ModuleCatalogEntry])],
  controllers: [ModulesCatalogController],
  providers: [ModulesCatalogService],
  exports: [ModulesCatalogService],
})
export class ModulesCatalogModule {}
