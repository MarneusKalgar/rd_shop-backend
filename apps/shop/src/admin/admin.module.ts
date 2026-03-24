import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '@/auth/auth.module';
import { User } from '@/users/user.entity';

import { AdminService } from './admin.service';
import { AdminTestingService } from './testing/admin-testing.service';
import { AdminTestingController } from './v1/admin-testing.controller';
import { AdminController } from './v1/admin.controller';

@Module({
  controllers: [AdminController, AdminTestingController],
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  providers: [AdminService, AdminTestingService],
})
export class AdminModule {}
