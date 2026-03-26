import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { AdminUsersController } from './v1/admin-users.controller';
import { UsersController as UsersControllerV1 } from './v1/users.controller';

@Module({
  controllers: [UsersControllerV1, AdminUsersController],
  exports: [UsersService, TypeOrmModule],
  imports: [TypeOrmModule.forFeature([User]), ConfigModule, AuthModule, FilesModule],
  providers: [UsersService],
})
export class UsersModule {}
