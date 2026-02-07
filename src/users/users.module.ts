import { Module } from '@nestjs/common';

import { UsersService } from './users.service';
import { UsersController as UsersControllerV1 } from './v1/users.controller';

@Module({
  controllers: [UsersControllerV1],
  providers: [UsersService],
})
export class UsersModule {}
