import { Body, Controller, Post } from '@nestjs/common';

import type {
  FeishuSyncRequest,
  FeishuSyncResult,
} from '@shared/api.interface';

import { FeishuService } from './feishu.service';

@Controller('api/feishu')
export class FeishuController {
  constructor(private readonly feishuService: FeishuService) {}

  @Post('sync-report')
  async syncReport(
    @Body() body: FeishuSyncRequest,
  ): Promise<FeishuSyncResult> {
    return this.feishuService.syncReport(body);
  }
}
