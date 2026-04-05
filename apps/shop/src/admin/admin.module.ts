import { isProduction } from '@app/common';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '@/users/user.entity';

import { AdminTestingService } from './testing/admin-testing.service';
import { AdminTestingController } from './v1/admin-testing.controller';

const testingControllers = isProduction() ? [] : [AdminTestingController];
const testingProviders = isProduction() ? [] : [AdminTestingService];

@Module({
  controllers: [...testingControllers],
  imports: [TypeOrmModule.forFeature([User])],
  providers: [...testingProviders],
})
export class AdminModule {}
