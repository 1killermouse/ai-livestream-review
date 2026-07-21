import { Injectable } from '@nestjs/common';

import type { ReviewDomain } from '@shared/api.interface';

import type { DomainPolicyProvider } from './domain-policy.interface';

@Injectable()
export class LiveScriptPolicyProvider implements DomainPolicyProvider {
  readonly domain: ReviewDomain = 'live_script_rewrite';
  readonly version: string = '2026-07-mvp';

  getWorkflowSteps(): string[] {
    return [
      'capture-live-or-upload-recording',
      'transcribe-with-aliyun-asr',
      'select-or-upload-script-framework',
      'retrieve-framework-rules-and-templates',
      'diagnose-rhythm-with-react-agent',
      'scan-banned-words',
      'assess-semantic-risk',
      'generate-rewrite-with-react-agent',
    ];
  }

  getRiskTaxonomy(): string[] {
    return [
      'AI 变现承诺或结果保证',
      'AI 副业案例夸大收益',
      'AI 工具能力夸大',
      'AI 焦虑式成交',
      '伪权威背书',
      '过度逼单',
      '适用人群边界不清',
      '站外导流或规避平台交易',
      'AI 生成内容版权边界不清',
    ];
  }
}
