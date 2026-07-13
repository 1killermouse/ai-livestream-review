import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { InternalAuthGuard } from './internal-auth.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: APP_GUARD,
      useClass: InternalAuthGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
