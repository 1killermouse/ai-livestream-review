import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';

import { ResponseCode } from '@server/common/constants/api_response_code';
import { BusinessException } from '@server/common/interfaces/exception.interface';
import type {
  HistoryReportDetail,
  HistoryReportListResponse,
  InternalUser,
} from '@shared/api.interface';

import { HistoryService } from './history.service';

@Controller('api/history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get('reports')
  async listReports(@Req() request: Request): Promise<HistoryReportListResponse> {
    return this.historyService.listReports(this.requireUser(request));
  }

  @Get('reports/:id')
  async getReport(
    @Req() request: Request,
    @Param('id') id: string,
  ): Promise<HistoryReportDetail> {
    return this.historyService.getReport(this.requireUser(request), id);
  }

  private requireUser(request: Request): InternalUser {
    if (request.internalUser) {
      return request.internalUser;
    }
    throw new BusinessException(
      ResponseCode.UNAUTHORIZED,
      '请先登录后再继续',
    );
  }
}
