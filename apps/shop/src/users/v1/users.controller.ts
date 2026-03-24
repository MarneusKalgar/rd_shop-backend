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
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/auth/decorators/current-user';
import { Roles } from '@/auth/decorators/roles';
import { JwtAuthGuard, RolesGuard } from '@/auth/guards';
import { UserRole } from '@/auth/permissions/constants';
import { AuthUser } from '@/auth/types';

import {
  ChangePasswordDto,
  FindUsersDto,
  UpdateProfileDto,
  UserResponseDto,
  UsersListResponseDto,
} from '../dto';
import { UsersService } from '../users.service';

@ApiTags('users')
@Controller({ path: 'users', version: '1' })
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'Change own password' })
  @ApiResponse({ description: 'Password changed successfully', status: HttpStatus.NO_CONTENT })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Patch('me/password')
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.usersService.changePassword(user.sub, dto);
  }

  @ApiOperation({ summary: 'Delete user by ID (admin only)' })
  @ApiResponse({ description: 'User deleted', status: HttpStatus.NO_CONTENT })
  @ApiResponse({ description: 'User not found', status: HttpStatus.NOT_FOUND })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  async deleteUser(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.usersService.remove(id);
  }

  @ApiOperation({ summary: 'Get own profile' })
  @ApiResponse({ description: 'Profile', status: HttpStatus.OK, type: UserResponseDto })
  @Get('me')
  async getMe(@CurrentUser() user: AuthUser): Promise<UserResponseDto> {
    return this.usersService.getProfile(user.sub);
  }

  @ApiOperation({ summary: 'Get user by ID (admin only)' })
  @ApiResponse({ description: 'User found', status: HttpStatus.OK, type: UserResponseDto })
  @ApiResponse({ description: 'User not found', status: HttpStatus.NOT_FOUND })
  @Get(':id')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  async getUserById(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.findById(id);
  }

  @ApiOperation({ summary: 'List all users with cursor pagination (admin only)' })
  @ApiResponse({ description: 'Users list', status: HttpStatus.OK, type: UsersListResponseDto })
  @Get()
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  async getUsers(@Query() dto: FindUsersDto): Promise<UsersListResponseDto> {
    return this.usersService.findAll(dto);
  }

  @ApiOperation({ summary: 'Update own profile' })
  @ApiResponse({ description: 'Updated profile', status: HttpStatus.OK, type: UserResponseDto })
  @Patch('me')
  async updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    return this.usersService.updateProfile(user.sub, dto);
  }
}
