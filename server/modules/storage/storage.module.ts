import { Module } from '@nestjs/common';

import { OssService } from './oss.service';
import { StorageController } from './storage.controller';

@Module({
  controllers: [StorageController],
  providers: [OssService],
  exports: [OssService],
})
export class StorageModule {}
