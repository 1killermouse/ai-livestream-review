import { Body, Controller, Post } from '@nestjs/common';

import type {
  LiveDataReplayRequest,
  LiveDataReplayResult,
} from '@shared/api.interface';

import { AnalyticsService } from './analytics.service';

@Controller('api/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('mock-live-data-replay')
  async createMockLiveDataReplay(
    @Body() body: LiveDataReplayRequest,
  ): Promise<LiveDataReplayResult> {
    return this.analyticsService.createMockLiveDataReplay(body);
  }
}
