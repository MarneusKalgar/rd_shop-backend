import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';

import { UserRole } from '@/auth/constants';
import { Roles } from '@/auth/decorators';
import { JwtAuthGuard, RolesGuard } from '@/auth/guards';

import { AdminService } from '../admin.service';
import { UpdateUserPermissionsDto } from '../dto';

@Controller('admin')
@Roles(UserRole.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Patch('users/:userId/permissions')
  updateUserPermissions(@Param('userId') userId: string, @Body() dto: UpdateUserPermissionsDto) {
    return this.adminService.updateUserPermissions(userId, dto);
  }
}
