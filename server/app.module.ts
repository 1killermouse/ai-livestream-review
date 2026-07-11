import { APP_FILTER } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { AccessModule } from './modules/access/access.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { FeishuModule } from './modules/feishu/feishu.module';
import { RecorderModule } from './modules/recorder/recorder.module';
import { StorageModule } from './modules/storage/storage.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { ViewModule } from './modules/view/view.module';

@Module({
  imports: [
    // 平台 Module，提供平台能力
    PlatformModule.forRoot(),
    // ====== @route-section: business-modules START ======
    AccessModule,
    AnalysisModule,
    AnalyticsModule,
    FeishuModule,
    RecorderModule,
    StorageModule,
    WorkspaceModule,
    // ====== @route-section: business-modules END ======

    // ⚠️ @route-order: last
    // ViewModule is the fallback route module, must be registered last.
    ViewModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
