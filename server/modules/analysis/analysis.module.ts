import { Module } from '@nestjs/common';

import { HistoryModule } from '../history/history.module';

import { AliyunEmbeddingService } from './aliyun-embedding.service';
import { AliyunAsrService } from './aliyun-asr.service';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { DeepSeekAnalysisService } from './deepseek-analysis.service';
import { LiveScriptPolicyProvider } from './live-script-policy.provider';
import { RagKnowledgeProvider } from './rag-knowledge.provider';
import { ReportAnswerEvidenceValidator } from './report-answer-evidence.validator';
import { ReportReactAgentService } from './report-react-agent.service';
import { RewriteAdviceAgentService } from './rewrite-advice-agent.service';
import { RhythmAnalysisAgentService } from './rhythm-analysis-agent.service';

@Module({
  imports: [HistoryModule],
  controllers: [AnalysisController],
  providers: [
    AliyunEmbeddingService,
    AliyunAsrService,
    AnalysisService,
    DeepSeekAnalysisService,
    LiveScriptPolicyProvider,
    RagKnowledgeProvider,
    ReportAnswerEvidenceValidator,
    ReportReactAgentService,
    RhythmAnalysisAgentService,
    RewriteAdviceAgentService,
  ],
})
export class AnalysisModule {}
