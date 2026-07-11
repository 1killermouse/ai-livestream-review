import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  AccessProfile,
  UpdateRoleRequest,
  UserRole,
} from '@shared/api.interface';
import { ResponseCode } from '@server/common/constants/api_response_code';
import { BusinessException } from '@server/common/interfaces/exception.interface';

import { AccessService } from './access.service';

@Controller('api/access')
export class AccessController {
  constructor(private readonly accessService: AccessService) {}

  @Get('me')
  async getMe(@Req() req: Request): Promise<AccessProfile> {
    const { userId, userName } = req.userContext;
    return this.accessService.getOrCreateProfile(userId, userName);
  }

  @NeedLogin()
  @Put('roles/:userId')
  async updateRole(
    @Req() req: Request,
    @Param('userId') targetUserId: string,
    @Body() body: UpdateRoleRequest,
  ): Promise<AccessProfile> {
    const role: UserRole = body.role;
    if (role !== 'admin' && role !== 'anchor') {
      throw new BusinessException(
        ResponseCode.VALIDATION_ERROR,
        '角色只能是 admin 或 anchor',
      );
    }

    const { userId, userName } = req.userContext;
    return this.accessService.updateRole(userId, userName, targetUserId, role);
  }
}
