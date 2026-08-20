import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MinOrgRole } from '../common/decorators/org-roles.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrgRole, UserRole } from '../common/enums';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { ModulesCatalogService } from './modules-catalog.service';

@Controller('modules')
export class ModulesCatalogController {
  constructor(private readonly modules: ModulesCatalogService) {}

  /** Readable by any signed-in user — candidates see module names in reports. */
  @Get()
  findAll(
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.modules.findAll(includeInactive ?? false);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.modules.findOne(id);
  }

  @Roles(UserRole.RECRUITER_ADMIN)
  @MinOrgRole(OrgRole.ADMIN)
  @Post()
  create(@Body() dto: CreateModuleDto) {
    return this.modules.create(dto);
  }

  @Roles(UserRole.RECRUITER_ADMIN)
  @MinOrgRole(OrgRole.ADMIN)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateModuleDto) {
    return this.modules.update(id, dto);
  }

  /** Soft delete — see the service for why hard deletes aren't offered. */
  @Roles(UserRole.RECRUITER_ADMIN)
  @MinOrgRole(OrgRole.ADMIN)
  @Delete(':id')
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.modules.deactivate(id);
  }
}
