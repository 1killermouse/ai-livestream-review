import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { ResponseCode } from '@server/common/constants/api_response_code';
import { BusinessException } from '@server/common/interfaces/exception.interface';

import type {
  AnalysisCapability,
  FileAnalysisJob,
  FileUrlAnalysisRequest,
  InternalUser,
  PrototypeAnalysisReport,
  PrototypeAnalysisRequest,
  ReportChatRequest,
  ReportChatResponse,
  TranscribeUrlRequest,
  TranscriptSegmentSummary,
} from '@shared/api.interface';

import { AnalysisService } from './analysis.service';

@Controller('api/analysis')
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Get('capability')
  async getCapability(): Promise<AnalysisCapability> {
    return this.analysisService.getCapability();
  }

  @Post('prototype')
  async createPrototypeReport(
    @Body() body: PrototypeAnalysisRequest,
  ): Promise<PrototypeAnalysisReport> {
    return this.analysisService.createPrototypeReport(body);
  }

  @Post('from-file-url')
  async createReportFromFileUrl(
    @Req() request: Request,
    @Body() body: FileUrlAnalysisRequest,
  ): Promise<PrototypeAnalysisReport> {
    return this.analysisService.createReportFromFileUrl(
      body,
      this.requireUser(request).id,
    );
  }

  @Post('jobs')
  startFileAnalysisJob(
    @Req() request: Request,
    @Body() body: FileUrlAnalysisRequest,
  ): FileAnalysisJob {
    return this.analysisService.startFileAnalysisJob(
      body,
      this.requireUser(request).id,
    );
  }

  @Get('jobs/:id')
  getFileAnalysisJob(
    @Req() request: Request,
    @Param('id') id: string,
  ): FileAnalysisJob {
    return this.analysisService.getFileAnalysisJob(
      id,
      this.requireUser(request),
    );
  }

  @Post('transcribe-url')
  async transcribeUrl(
    @Body() body: TranscribeUrlRequest,
  ): Promise<TranscriptSegmentSummary[]> {
    return this.analysisService.transcribeUrl(body);
  }

  @Post('chat')
  async chatWithReport(
    @Body() body: ReportChatRequest,
  ): Promise<ReportChatResponse> {
    return this.analysisService.chatWithReport(body);
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
