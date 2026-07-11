import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import type {
  RecorderCaptureRequest,
  RecorderCaptureResult,
} from '@shared/api.interface';

import { RecorderService } from './recorder.service';

@Controller('api/recorder')
export class RecorderController {
  constructor(private readonly recorderService: RecorderService) {}

  @Post('capture')
  async captureLive(
    @Body() body: RecorderCaptureRequest,
  ): Promise<RecorderCaptureResult> {
    return this.recorderService.captureLive(body);
  }

  @Get('capture/:id')
  async getCaptureStatus(
    @Param('id') id: string,
  ): Promise<RecorderCaptureResult> {
    return this.recorderService.getCaptureStatus(id);
  }
}
