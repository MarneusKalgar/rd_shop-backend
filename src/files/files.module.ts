import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ProductsModule } from '@/products/products.module';

import { FileRecord } from './file-record.entity';
import { FilesService } from './files.service';
import { S3Service } from './s3.service';
import { FilesController as FilesControllerV1 } from './v1/files.controller';

@Module({
  controllers: [FilesControllerV1],
  exports: [TypeOrmModule, FilesService, S3Service],
  imports: [TypeOrmModule.forFeature([FileRecord]), forwardRef(() => ProductsModule)],
  providers: [FilesService, S3Service],
})
export class FilesModule {}
