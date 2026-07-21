import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { StandaloneStoreModule } from '@server/modules/standalone-store/standalone-store.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { InternalAuthGuard } from './internal-auth.guard';

@Module({
  imports: [StandaloneStoreModule],
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
