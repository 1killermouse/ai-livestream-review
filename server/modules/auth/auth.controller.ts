import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { ResponseCode } from '@server/common/constants/api_response_code';
import { BusinessException } from '@server/common/interfaces/exception.interface';
import type {
  AuthStatusResponse,
  AuthSessionResponse,
  BootstrapAccountRequest,
  CreateInternalAccountRequest,
  InternalAccountSummary,
  InternalUser,
  LoginRequest,
} from '@shared/api.interface';

import {
  AUTH_COOKIE_NAME,
  AUTH_HEADER_NAME,
  AUTH_SESSION_TTL_MS,
} from './auth.constants';
import { AuthService } from './auth.service';
import { PublicRoute } from './public.decorator';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @PublicRoute()
  @Get('status')
  async getStatus(@Req() req: Request): Promise<AuthStatusResponse> {
    const initialized: boolean = await this.authService.isInitialized();
    const user: InternalUser | undefined = initialized
      ? await this.authService.authenticateToken(this.getToken(req))
      : undefined;
    return {
      initialized,
      authenticated: Boolean(user),
      user,
    };
  }

  @PublicRoute()
  @Post('bootstrap')
  async bootstrap(
    @Body() body: BootstrapAccountRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const authenticated = await this.authService.bootstrap(body);
    this.setSessionCookie(response, authenticated.token);
    return authenticated;
  }

  @PublicRoute()
  @HttpCode(200)
  @Post('login')
  async login(
    @Body() body: LoginRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const authenticated = await this.authService.login(body);
    this.setSessionCookie(response, authenticated.token);
    return authenticated;
  }

  @HttpCode(200)
  @PublicRoute()
  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ success: true }> {
    await this.authService.logout(this.getToken(request));
    response.clearCookie(AUTH_COOKIE_NAME, this.cookieOptions());
    return { success: true };
  }

  @Get('accounts')
  async listAccounts(@Req() request: Request): Promise<InternalAccountSummary[]> {
    return this.authService.listAccounts(this.requireUser(request));
  }

  @Post('accounts')
  async createAccount(
    @Req() request: Request,
    @Body() body: CreateInternalAccountRequest,
  ): Promise<InternalAccountSummary> {
    return this.authService.createAccount(this.requireUser(request), body);
  }

  private getToken(request: Request): string | undefined {
    const headerToken: string | string[] | undefined =
      request.headers[AUTH_HEADER_NAME];
    return (
      request.cookies?.[AUTH_COOKIE_NAME] ||
      (Array.isArray(headerToken) ? headerToken[0] : headerToken)
    );
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

  private setSessionCookie(response: Response, token: string): void {
    response.cookie(AUTH_COOKIE_NAME, token, {
      ...this.cookieOptions(),
      maxAge: AUTH_SESSION_TTL_MS,
    });
  }

  private cookieOptions(): {
    httpOnly: true;
    sameSite: 'strict';
    secure: boolean;
    path: '/';
  } {
    return {
      httpOnly: true,
      sameSite: 'strict',
      secure:
        process.env.NODE_ENV === 'production' &&
        process.env.STANDALONE_LOCAL_DEV !== '1',
      path: '/',
    };
  }
}
