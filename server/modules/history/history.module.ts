import { Module } from '@nestjs/common';

import { StandaloneStoreModule } from '@server/modules/standalone-store/standalone-store.module';

import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  imports: [StandaloneStoreModule],
  controllers: [HistoryController],
  providers: [HistoryService],
  exports: [HistoryService],
})
export class HistoryModule {}
