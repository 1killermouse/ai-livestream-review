import { Module } from '@nestjs/common';

import { StandaloneStoreService } from './standalone-store.service';

@Module({
  providers: [StandaloneStoreService],
  exports: [StandaloneStoreService],
})
export class StandaloneStoreModule {}
