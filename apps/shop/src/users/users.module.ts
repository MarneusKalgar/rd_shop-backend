import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { UsersController as UsersControllerV1 } from './v1/users.controller';

@Module({
  controllers: [UsersControllerV1],
  exports: [UsersService, TypeOrmModule],
  imports: [TypeOrmModule.forFeature([User]), ConfigModule, AuthModule],
  providers: [UsersService],
})
export class UsersModule {}
