import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ResponseCode } from '@server/common/constants/api_response_code';
import { BusinessException } from '@server/common/interfaces/exception.interface';
import type { InternalUser } from '@shared/api.interface';

import {
  AUTH_COOKIE_NAME,
  AUTH_HEADER_NAME,
  AUTH_PUBLIC_ROUTE,
} from './auth.constants';
import { AuthService } from './auth.service';

@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic: boolean = this.reflector.getAllAndOverride<boolean>(
      AUTH_PUBLIC_ROUTE,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }

    const request: Request = context.switchToHttp().getRequest<Request>();
    if (!request.path.includes('/api/')) {
      return true;
    }

    const headerToken: string | string[] | undefined =
      request.headers[AUTH_HEADER_NAME];
    const token: string | undefined =
      request.cookies?.[AUTH_COOKIE_NAME] ||
      (Array.isArray(headerToken) ? headerToken[0] : headerToken);
    const user: InternalUser | undefined =
      await this.authService.authenticateToken(token);
    if (!user) {
      throw new BusinessException(
        ResponseCode.UNAUTHORIZED,
        '请先登录后再继续',
      );
    }

    request.internalUser = user;
    request.userContext = {
      ...request.userContext,
      userId: user.id,
      userName: user.displayName,
      tenantId: request.userContext?.tenantId || 0,
      appId: process.env.MIAODA_APP_ID || 'ai-livestream-review',
    };
    return true;
  }
}
