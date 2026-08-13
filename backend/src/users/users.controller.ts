import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentOrg } from '../common/decorators/current-org.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

/**
 * Two groups of endpoints, deliberately in one controller.
 *
 * `me/*` is open to both roles and always scopes to the caller's own id, so one
 * user can never read or edit another's account through it.
 *
 * The directory routes carry `@Roles(RECRUITER_ADMIN)` individually — not at
 * class level, which would lock candidates out of their own profile.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser('id') userId: string) {
    return this.users.getProfile(userId);
  }

  /** Directory listing. Never exposes password or refresh-token columns. */
  @Roles(UserRole.RECRUITER_ADMIN)
  @Get()
  list(@Query() query: QueryUsersDto, @CurrentOrg() organisationId: string) {
    return this.users.list(query, organisationId);
  }

  /**
   * Provisions an account and returns its one-time password in the response.
   * That password is shown to the creating recruiter once and is never
   * retrievable again — only a hash is stored.
   */
  @Roles(UserRole.RECRUITER_ADMIN)
  @Post()
  create(@Body() dto: CreateUserDto, @CurrentOrg() organisationId: string) {
    // The organisation comes from the creating recruiter, never the payload — a
    // client-supplied one would let anybody add a member to another company.
    return this.users.createByAdmin({ ...dto, organisationId });
  }

  @Patch('me')
  updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto) {
    return this.users.updateName(userId, dto.fullName);
  }

  @Post('me/change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.users.changePassword(
      userId,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
