import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  CreateSessionRequest,
  LiveSessionSummary,
  WorkspaceOverviewResponse,
} from '@shared/api.interface';
import { ResponseCode } from '@server/common/constants/api_response_code';
import { BusinessException } from '@server/common/interfaces/exception.interface';

import { WorkspaceService } from './workspace.service';

@Controller('api/workspace')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get('overview')
  async getOverview(@Req() req: Request): Promise<WorkspaceOverviewResponse> {
    const { userId, userName } = req.userContext;
    return this.workspaceService.getOverview(userId, userName);
  }

  @NeedLogin()
  @Post('sessions')
  async createSession(
    @Req() req: Request,
    @Body() body: CreateSessionRequest,
  ): Promise<LiveSessionSummary> {
    if (!body.title?.trim()) {
      throw new BusinessException(
        ResponseCode.VALIDATION_ERROR,
        '直播标题不能为空',
      );
    }
    return this.workspaceService.createSession(req.userContext.userId, body);
  }
}
