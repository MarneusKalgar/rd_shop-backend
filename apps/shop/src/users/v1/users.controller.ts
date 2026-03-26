import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/auth/decorators/current-user';
import { JwtAuthGuard } from '@/auth/guards';
import { AuthUser } from '@/auth/types';

import { ChangePasswordDto, SetAvatarDto, UpdateProfileDto, UserDataResponseDto } from '../dto';
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

  @ApiOperation({ summary: 'Get own profile' })
  @ApiResponse({ description: 'Profile', status: HttpStatus.OK, type: UserDataResponseDto })
  @Get('me')
  async getMe(@CurrentUser() user: AuthUser): Promise<UserDataResponseDto> {
    return this.usersService.getProfile(user.sub);
  }

  @ApiOperation({ summary: 'Remove own avatar' })
  @ApiResponse({ description: 'Avatar removed', status: HttpStatus.NO_CONTENT })
  @Delete('me/avatar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAvatar(@CurrentUser() user: AuthUser): Promise<void> {
    return this.usersService.removeAvatar(user.sub);
  }

  @ApiOperation({ summary: 'Set own avatar' })
  @ApiResponse({
    description: 'Updated profile with avatar',
    status: HttpStatus.OK,
    type: UserDataResponseDto,
  })
  @Put('me/avatar')
  async setAvatar(
    @CurrentUser() user: AuthUser,
    @Body() dto: SetAvatarDto,
  ): Promise<UserDataResponseDto> {
    return this.usersService.setAvatar(user.sub, dto);
  }

  @ApiOperation({ summary: 'Update own profile' })
  @ApiResponse({ description: 'Updated profile', status: HttpStatus.OK, type: UserDataResponseDto })
  @Patch('me')
  async updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserDataResponseDto> {
    return this.usersService.updateProfile(user.sub, dto);
  }
}
