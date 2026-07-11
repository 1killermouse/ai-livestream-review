import { Module } from '@nestjs/common';

import { RecorderController } from './recorder.controller';
import { RecorderService } from './recorder.service';

@Module({
  controllers: [RecorderController],
  providers: [RecorderService],
  exports: [RecorderService],
})
export class RecorderModule {}
