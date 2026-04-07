import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { AuditEventContext } from '@/audit-log/audit-log.types';
import { CurrentUser } from '@/auth/decorators/current-user';
import { Roles } from '@/auth/decorators/roles';
import { Scopes } from '@/auth/decorators/scopes';
import { JwtAuthGuard, RolesGuard, ScopesGuard } from '@/auth/guards';
import { UserRole, UserScope } from '@/auth/permissions/constants';
import { AuthUser } from '@/auth/types';
import { REQUEST_ID_HEADER } from '@/common/constants';

import {
  FindUsersDto,
  UpdateRolesDto,
  UpdateScopesDto,
  UpdateUserPermissionsResponseDto,
  UserDataResponseDto,
  UsersListResponseDto,
} from '../dto';
import { UsersService } from '../users.service';

@ApiTags('admin / users')
@Controller({ path: 'admin/users', version: '1' })
@Roles(UserRole.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard, ScopesGuard)
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'Delete user by ID' })
  @ApiResponse({ description: 'User deleted', status: HttpStatus.NO_CONTENT })
  @ApiResponse({ description: 'User not found', status: HttpStatus.NOT_FOUND })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Scopes(UserScope.USERS_WRITE)
  async deleteUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    return this.usersService.remove(id, admin.sub, this.extractContext(req));
  }

  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({ status: HttpStatus.OK, type: UserDataResponseDto })
  @ApiResponse({ description: 'User not found', status: HttpStatus.NOT_FOUND })
  @Get(':id')
  @Scopes(UserScope.USERS_READ)
  async getUserById(@Param('id', ParseUUIDPipe) id: string): Promise<UserDataResponseDto> {
    return this.usersService.findById(id);
  }

  @ApiOperation({ summary: 'List all users with cursor pagination' })
  @ApiResponse({ status: HttpStatus.OK, type: UsersListResponseDto })
  @Get()
  @Scopes(UserScope.USERS_READ)
  async getUsers(@Query() dto: FindUsersDto): Promise<UsersListResponseDto> {
    return this.usersService.findAll(dto);
  }

  @ApiOperation({ summary: 'Set roles for a user' })
  @ApiResponse({ status: HttpStatus.OK, type: UpdateUserPermissionsResponseDto })
  @ApiResponse({ description: 'User not found', status: HttpStatus.NOT_FOUND })
  @Patch(':id/roles')
  @Scopes(UserScope.USERS_WRITE)
  async updateRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRolesDto,
    @CurrentUser() admin: AuthUser,
    @Req() req: Request,
  ): Promise<UpdateUserPermissionsResponseDto> {
    return this.usersService.updateRoles(id, dto, admin.sub, this.extractContext(req));
  }

  @ApiOperation({ summary: 'Set scopes for a user' })
  @ApiResponse({ status: HttpStatus.OK, type: UpdateUserPermissionsResponseDto })
  @ApiResponse({ description: 'User not found', status: HttpStatus.NOT_FOUND })
  @Patch(':id/scopes')
  @Scopes(UserScope.USERS_WRITE)
  async updateScopes(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScopesDto,
    @CurrentUser() admin: AuthUser,
    @Req() req: Request,
  ): Promise<UpdateUserPermissionsResponseDto> {
    return this.usersService.updateScopes(id, dto, admin.sub, this.extractContext(req));
  }

  private extractContext(req: Request): AuditEventContext {
    return {
      correlationId: req.headers[REQUEST_ID_HEADER] as string | undefined,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }
}
