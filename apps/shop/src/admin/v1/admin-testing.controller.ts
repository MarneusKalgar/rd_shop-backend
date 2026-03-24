import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { AdminTestingService } from '../testing/admin-testing.service';
import { CreateVerifiedAdminDto, CreateVerifiedAdminResponseDto } from '../testing/dto';

/**
 * Testing-only controller — no auth guards.
 * All handlers throw `ForbiddenException` in production (enforced at the service layer).
 */
@Controller('admin-testing')
export class AdminTestingController {
  constructor(private readonly adminTestingService: AdminTestingService) {}

  @HttpCode(HttpStatus.CREATED)
  @Post('verified-admin')
  createVerifiedAdmin(
    @Body() dto: CreateVerifiedAdminDto,
  ): Promise<CreateVerifiedAdminResponseDto> {
    return this.adminTestingService.createVerifiedAdmin(dto);
  }
}
