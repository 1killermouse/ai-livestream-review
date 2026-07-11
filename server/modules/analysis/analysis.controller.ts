import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import type {
  AnalysisCapability,
  FileAnalysisJob,
  FileUrlAnalysisRequest,
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
    @Body() body: FileUrlAnalysisRequest,
  ): Promise<PrototypeAnalysisReport> {
    return this.analysisService.createReportFromFileUrl(body);
  }

  @Post('jobs')
  startFileAnalysisJob(@Body() body: FileUrlAnalysisRequest): FileAnalysisJob {
    return this.analysisService.startFileAnalysisJob(body);
  }

  @Get('jobs/:id')
  getFileAnalysisJob(@Param('id') id: string): FileAnalysisJob {
    return this.analysisService.getFileAnalysisJob(id);
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
}
