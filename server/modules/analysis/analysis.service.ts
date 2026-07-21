import { randomUUID } from 'node:crypto';

import { Injectable, NotFoundException } from '@nestjs/common';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

import type {
  AgentTraceStep,
  AnalysisCapability,
  FileAnalysisJob,
  FileUrlAnalysisRequest,
  FrameworkMatchSummary,
  InternalUser,
  PrototypeAnalysisReport,
  RagReferenceSummary,
  ReportChatRequest,
  ReportChatResponse,
  PrototypeAnalysisRequest,
  ScriptFinding,
  TranscribeUrlRequest,
  TranscriptSegmentSummary,
} from '@shared/api.interface';

import { AliyunAsrService } from './aliyun-asr.service';
import { DeepSeekAnalysisService } from './deepseek-analysis.service';
import type { DomainPolicyProvider } from './domain-policy.interface';
import { LiveScriptPolicyProvider } from './live-script-policy.provider';
import { RagKnowledgeProvider } from './rag-knowledge.provider';
import { isWarningOrRefutationContext } from './report-answer-evidence.validator';
import { ReportReactAgentService } from './report-react-agent.service';
import {
  RewriteAdviceAgentService,
  type RewriteAgentResult,
} from './rewrite-advice-agent.service';
import {
  RhythmAnalysisAgentService,
  type RhythmAgentResult,
} from './rhythm-analysis-agent.service';
import { HistoryService } from '../history/history.service';

const DEFAULT_FRAMEWORK_NAME = 'AI 知识付费直播全场转化框架';
const MAX_IN_MEMORY_ANALYSIS_JOBS = 20;
const ANALYSIS_JOB_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RAG_QUERY_CHARS = 6000;

interface TimelineStageRule {
  stageName: string;
  expectedWindow: string;
  startMinute: number;
  endMinute?: number;
  keywords: string[];
  suggestion: string;
}

interface ReportAgentOptions {
  frameworkName: string;
  customFramework?: string;
}

interface InternalFileAnalysisJob extends FileAnalysisJob {
  ownerId: string;
}

@Injectable()
export class AnalysisService {
  private readonly analysisJobs = new Map<string, InternalFileAnalysisJob>();

  constructor(
    private readonly policyProvider: LiveScriptPolicyProvider,
    private readonly aliyunAsrService: AliyunAsrService,
    private readonly ragKnowledgeProvider: RagKnowledgeProvider,
    private readonly deepSeekAnalysisService: DeepSeekAnalysisService,
    private readonly reportReactAgentService: ReportReactAgentService,
    private readonly rhythmAnalysisAgentService: RhythmAnalysisAgentService,
    private readonly rewriteAdviceAgentService: RewriteAdviceAgentService,
    private readonly historyService: HistoryService,
  ) {}

  async getCapability(): Promise<AnalysisCapability> {
    return {
      langchain: true,
      langgraph: true,
      configured: Boolean(
        process.env.OPENAI_API_KEY ||
        process.env.AI_API_KEY ||
        this.aliyunAsrService.isConfigured() ||
        this.deepSeekAnalysisService.isConfigured() ||
        this.ragKnowledgeProvider.isEmbeddingConfigured(),
      ),
      deepseekConfigured: this.deepSeekAnalysisService.isConfigured(),
      deepseekModel: this.deepSeekAnalysisService.getModelName(),
      embeddingConfigured: this.ragKnowledgeProvider.isEmbeddingConfigured(),
      embeddingModel: this.ragKnowledgeProvider.getEmbeddingModelName(),
      embeddingDimensions: this.ragKnowledgeProvider.getEmbeddingDimensions(),
      domain: this.policyProvider.domain,
      domainVersion: this.policyProvider.version,
      workflow: this.policyProvider.getWorkflowSteps(),
      riskTaxonomy: this.policyProvider.getRiskTaxonomy(),
    };
  }

  async splitRuleDocument(content: string): Promise<string[]> {
    const splitter: RecursiveCharacterTextSplitter =
      new RecursiveCharacterTextSplitter({
        chunkSize: 800,
        chunkOverlap: 120,
      });
    return splitter.splitText(content);
  }

  async createPrototypeReport(
    request: PrototypeAnalysisRequest,
  ): Promise<PrototypeAnalysisReport> {
    const frameworkName: string =
      request.frameworkName?.trim() || DEFAULT_FRAMEWORK_NAME;
    const transcriptSegments: TranscriptSegmentSummary[] =
      this.getPrototypeTranscript();
    const findings: ScriptFinding[] = this.getPrototypeFindings();
    const frameworkMatches: FrameworkMatchSummary[] =
      this.getPrototypeFrameworkMatches();
    const ragReferences: RagReferenceSummary[] =
      this.ragKnowledgeProvider.retrieveByKeyword(
        [
          ...transcriptSegments.map(
            (segment: TranscriptSegmentSummary): string => segment.text,
          ),
          ...findings.map(
            (finding: ScriptFinding): string => finding.originalText,
          ),
        ].join(' '),
        6,
      );
    const agentTrace: AgentTraceStep[] = this.getPrototypeAgentTrace(
      transcriptSegments,
      findings,
    );
    const durationSeconds: number =
      this.getTranscriptDurationSeconds(transcriptSegments);
    const transcriptWordCount: number = transcriptSegments.reduce(
      (total: number, segment: TranscriptSegmentSummary): number =>
        total + segment.wordCount,
      0,
    );
    const highRiskFindings: number = findings.filter(
      (finding: ScriptFinding): boolean =>
        finding.riskLevel === 'critical' || finding.riskLevel === 'high',
    ).length;

    return {
      id: `prototype-${Date.now()}`,
      title:
        request.inputSource === 'live_url'
          ? 'AI 知识付费直播链接话术诊断报告'
          : request.recordingName || 'AI 知识付费录屏话术诊断报告',
      inputSource: request.inputSource,
      durationSeconds,
      transcriptWordCount,
      frameworkName,
      summary: {
        totalFindings: findings.length,
        highRiskFindings,
        rewriteSuggestions: findings.length,
        overallDiagnosis:
          '本场话术按 AI 知识付费全场框架诊断：前 60 分钟要集中输出干货建立价值感，60-84 分钟承接课程和权益，84-90 分钟用案例继续立人设，后续再做成交承接，同时收敛 AI 变现承诺和过度逼单。',
      },
      transcriptSegments,
      findings,
      frameworkMatches,
      reviewScript:
        '前面继续保留 AI 工具和提示词案例，让用户先听懂方法价值。讲到课程时，把训练内容、作业反馈和适合人群说清楚，不要承诺确定收益。涉及工具效果时可以直接说：“AI 能提高内容生产效率，但选题判断、内容修改和最终交付仍然需要人来完成。”',
      ragReferences,
      agentTrace,
    };
  }

  async createReportFromFileUrl(
    request: FileUrlAnalysisRequest,
    ownerId: string,
  ): Promise<PrototypeAnalysisReport> {
    const fileUrl: string = request.fileUrl?.trim();
    if (!fileUrl) {
      throw new Error('fileUrl 不能为空');
    }

    const transcriptSegments: TranscriptSegmentSummary[] =
      await this.aliyunAsrService.transcribeFileUrl(fileUrl);
    const report: PrototypeAnalysisReport =
      await this.createReportFromTranscript(request, transcriptSegments);
    return this.historyService.saveReport(ownerId, report);
  }

  startFileAnalysisJob(
    request: FileUrlAnalysisRequest,
    ownerId: string,
  ): FileAnalysisJob {
    if (!request.fileUrl?.trim()) {
      throw new Error('fileUrl 不能为空');
    }

    this.pruneAnalysisJobs();
    const now: string = new Date().toISOString();
    const job: InternalFileAnalysisJob = {
      id: randomUUID(),
      ownerId,
      status: 'processing',
      phase: 'transcribing',
      createdAt: now,
      updatedAt: now,
    };
    this.analysisJobs.set(job.id, job);
    void this.runFileAnalysisJob(job.id, request);
    return this.toPublicJob(job);
  }

  getFileAnalysisJob(id: string, user: InternalUser): FileAnalysisJob {
    const job: InternalFileAnalysisJob | undefined = this.analysisJobs.get(id);
    if (!job || (user.role !== 'admin' && job.ownerId !== user.id)) {
      throw new NotFoundException('没有找到这次录屏分析任务');
    }
    return this.toPublicJob(job);
  }

  async transcribeUrl(
    request: TranscribeUrlRequest,
  ): Promise<TranscriptSegmentSummary[]> {
    const fileUrl: string = request.fileUrl?.trim();
    if (!fileUrl) {
      throw new Error('fileUrl 不能为空');
    }
    return this.aliyunAsrService.transcribeFileUrl(fileUrl);
  }

  async chatWithReport(
    request: ReportChatRequest,
  ): Promise<ReportChatResponse> {
    const question: string = request.question?.trim();
    if (!question) {
      throw new Error('请先输入你想追问的问题');
    }
    if (!request.report?.transcriptSegments?.length) {
      throw new Error('请先生成本场直播体检报告');
    }

    const relatedSegments: TranscriptSegmentSummary[] =
      this.findRelatedSegments(request.report.transcriptSegments, question);
    return this.reportReactAgentService.answer({
      report: request.report,
      question,
      messages: request.messages || [],
      fallbackSegments: relatedSegments,
    });
  }

  getDomainPolicy(): DomainPolicyProvider {
    return this.policyProvider;
  }

  private findRelatedSegments(
    segments: TranscriptSegmentSummary[],
    question: string,
  ): TranscriptSegmentSummary[] {
    const keywords: string[] = Array.from(
      new Set(
        question
          .split(/[，。！？、,.!?：:\s]+/)
          .map((keyword: string): string => keyword.trim())
          .filter((keyword: string): boolean => keyword.length >= 2),
      ),
    ).slice(0, 8);

    const scoredSegments: Array<{
      segment: TranscriptSegmentSummary;
      score: number;
    }> = segments
      .map((segment: TranscriptSegmentSummary) => {
        const keywordScore: number = keywords.reduce(
          (total: number, keyword: string): number =>
            total + (segment.text.includes(keyword) ? 1 : 0),
          0,
        );
        const riskWordScore: number =
          /风险|违规|赚钱|案例|课程|成交|逼单|焦虑|开场|下播|话术/.test(
            question,
          )
            ? /风险|违规|赚钱|案例|课程|成交|逼单|焦虑|开场|下播|话术/.test(
                segment.text,
              )
              ? 1
              : 0
            : 0;

        return {
          segment,
          score: keywordScore + riskWordScore,
        };
      })
      .filter((item): boolean => item.score > 0)
      .sort((left, right): number => right.score - left.score);

    if (scoredSegments.length > 0) {
      return scoredSegments
        .slice(0, 5)
        .map((item): TranscriptSegmentSummary => item.segment);
    }

    return segments.slice(0, 5);
  }

  private getTranscriptDurationSeconds(
    segments: TranscriptSegmentSummary[],
  ): number {
    if (segments.length === 0) {
      return 0;
    }
    return Math.max(
      0,
      ...segments.map((segment: TranscriptSegmentSummary): number =>
        Number.isFinite(segment.endSeconds) ? segment.endSeconds : 0,
      ),
    );
  }

  private async createReportFromTranscript(
    request: PrototypeAnalysisRequest,
    transcriptSegments: TranscriptSegmentSummary[],
  ): Promise<PrototypeAnalysisReport> {
    const frameworkName: string =
      request.frameworkName?.trim() || DEFAULT_FRAMEWORK_NAME;
    const agentResult: {
      transcriptSegments: TranscriptSegmentSummary[];
      findings: ScriptFinding[];
      frameworkMatches: FrameworkMatchSummary[];
      reviewScript: string;
      ragReferences: RagReferenceSummary[];
      agentTrace: AgentTraceStep[];
    } = await this.runReportAgent(transcriptSegments, {
      frameworkName,
      customFramework: request.customFramework?.trim() || undefined,
    });
    const enrichedSegments: TranscriptSegmentSummary[] =
      agentResult.transcriptSegments;
    const findings: ScriptFinding[] = agentResult.findings;
    const frameworkMatches: FrameworkMatchSummary[] =
      agentResult.frameworkMatches;
    const durationSeconds: number =
      this.getTranscriptDurationSeconds(enrichedSegments);
    const transcriptWordCount: number = enrichedSegments.reduce(
      (total: number, segment: TranscriptSegmentSummary): number =>
        total + segment.wordCount,
      0,
    );
    const highRiskFindings: number = findings.filter(
      (finding: ScriptFinding): boolean =>
        finding.riskLevel === 'critical' || finding.riskLevel === 'high',
    ).length;

    return {
      id: `real-asr-${Date.now()}`,
      title:
        request.inputSource === 'live_url'
          ? 'AI 知识付费直播链接真实 ASR 话术报告'
          : request.recordingName || 'AI 知识付费录屏真实 ASR 话术报告',
      inputSource: request.inputSource,
      durationSeconds,
      transcriptWordCount,
      frameworkName,
      summary: {
        totalFindings: findings.length,
        highRiskFindings,
        rewriteSuggestions: findings.length,
        overallDiagnosis: this.buildOverallDiagnosis(
          transcriptWordCount,
          findings,
          frameworkMatches,
        ),
      },
      transcriptSegments: enrichedSegments,
      findings,
      frameworkMatches,
      reviewScript: agentResult.reviewScript,
      ragReferences: agentResult.ragReferences,
      agentTrace: agentResult.agentTrace,
    };
  }

  private async runFileAnalysisJob(
    jobId: string,
    request: FileUrlAnalysisRequest,
  ): Promise<void> {
    try {
      const transcriptSegments: TranscriptSegmentSummary[] =
        await this.aliyunAsrService.transcribeFileUrl(request.fileUrl.trim());
      if (transcriptSegments.length === 0) {
        throw new Error('录屏中没有识别到可以分析的主播话术');
      }
      this.updateAnalysisJob(jobId, {
        phase: 'analyzing',
      });
      const report: PrototypeAnalysisReport =
        await this.createReportFromTranscript(request, transcriptSegments);
      const job: InternalFileAnalysisJob | undefined =
        this.analysisJobs.get(jobId);
      if (!job) {
        return;
      }
      const savedReport: PrototypeAnalysisReport =
        await this.historyService.saveReport(job.ownerId, report);
      this.updateAnalysisJob(jobId, {
        status: 'completed',
        phase: 'completed',
        report: savedReport,
      });
    } catch (error: unknown) {
      const message: string =
        error instanceof Error ? error.message.trim() : '';
      this.updateAnalysisJob(jobId, {
        status: 'failed',
        phase: 'failed',
        errorMessage:
          message === '录屏中没有识别到可以分析的主播话术'
            ? message
            : '录屏转写或分析没有完成，请检查文件链接、ASR 配置和音频质量后重试。',
      });
    }
  }

  private updateAnalysisJob(
    jobId: string,
    updates: Partial<FileAnalysisJob>,
  ): void {
    const current: InternalFileAnalysisJob | undefined =
      this.analysisJobs.get(jobId);
    if (!current) {
      return;
    }
    this.analysisJobs.set(jobId, {
      ...current,
      ...updates,
      id: current.id,
      ownerId: current.ownerId,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    });
  }

  private pruneAnalysisJobs(): void {
    const cutoff: number = Date.now() - ANALYSIS_JOB_TTL_MS;
    for (const [id, job] of this.analysisJobs) {
      if (Date.parse(job.updatedAt) < cutoff) {
        this.analysisJobs.delete(id);
      }
    }

    const oldestJobs: InternalFileAnalysisJob[] = [
      ...this.analysisJobs.values(),
    ].sort(
      (left: InternalFileAnalysisJob, right: InternalFileAnalysisJob): number =>
        Date.parse(left.createdAt) - Date.parse(right.createdAt),
    );
    while (
      this.analysisJobs.size >= MAX_IN_MEMORY_ANALYSIS_JOBS &&
      oldestJobs.length > 0
    ) {
      const oldest: InternalFileAnalysisJob | undefined = oldestJobs.shift();
      if (oldest) {
        this.analysisJobs.delete(oldest.id);
      }
    }
  }

  private toPublicJob(job: InternalFileAnalysisJob): FileAnalysisJob {
    const { ownerId: _ownerId, ...publicJob } = job;
    return { ...publicJob };
  }

  private async runReportAgent(
    transcriptSegments: TranscriptSegmentSummary[],
    options: ReportAgentOptions,
  ): Promise<{
    transcriptSegments: TranscriptSegmentSummary[];
    findings: ScriptFinding[];
    frameworkMatches: FrameworkMatchSummary[];
    reviewScript: string;
    ragReferences: RagReferenceSummary[];
    agentTrace: AgentTraceStep[];
  }> {
    const ReportAgentState = Annotation.Root({
      transcriptSegments: Annotation<TranscriptSegmentSummary[]>(),
      frameworkName: Annotation<string>(),
      customFramework: Annotation<string | undefined>(),
      findings: Annotation<ScriptFinding[]>(),
      frameworkMatches: Annotation<FrameworkMatchSummary[]>(),
      reviewScript: Annotation<string>(),
      ragReferences: Annotation<RagReferenceSummary[]>(),
      agentTrace: Annotation<AgentTraceStep[]>({
        reducer: (
          left: AgentTraceStep[],
          right: AgentTraceStep[],
        ): AgentTraceStep[] => [...left, ...right],
        default: (): AgentTraceStep[] => [],
      }),
    });

    const reportAgent = new StateGraph(ReportAgentState)
      .addNode('prepare_transcript', (state) => {
        const enrichedSegments: TranscriptSegmentSummary[] =
          state.transcriptSegments.map(
            (segment: TranscriptSegmentSummary): TranscriptSegmentSummary => ({
              ...segment,
              matchedStage: this.inferSegmentStage(segment.text),
            }),
          );
        const wordCount: number = enrichedSegments.reduce(
          (total: number, segment: TranscriptSegmentSummary): number =>
            total + segment.wordCount,
          0,
        );
        return {
          transcriptSegments: enrichedSegments,
          agentTrace: [
            {
              nodeName: '转写整理 Agent',
              status: 'completed' as const,
              output: `整理 ${enrichedSegments.length} 段 ASR 时间戳文本，共 ${wordCount} 字。`,
            },
          ],
        };
      })
      .addNode('retrieve_framework', async (state) => {
        const frameworkMatches: FrameworkMatchSummary[] =
          this.buildFrameworkMatches(
            state.transcriptSegments,
            state.customFramework,
          );
        const ragReferences: RagReferenceSummary[] =
          await this.retrieveRagReferences(
            state.transcriptSegments,
            state.findings,
          );
        const frameworkLabel: string = state.customFramework
          ? '用户自定义框架'
          : state.frameworkName;
        const matchedCount: number = frameworkMatches.filter(
          (match: FrameworkMatchSummary): boolean => match.status === 'matched',
        ).length;
        const applicableCount: number = frameworkMatches.filter(
          (match: FrameworkMatchSummary): boolean =>
            match.status !== 'not_applicable',
        ).length;
        return {
          frameworkMatches,
          ragReferences,
          agentTrace: [
            {
              nodeName: '框架检索 Agent',
              status: 'completed' as const,
              output: `对齐${frameworkLabel}，当前可判断环节已覆盖 ${matchedCount}/${Math.max(applicableCount, 1)} 个，并通过 ${this.getRagModeLabel()} 召回 ${ragReferences.length} 条 RAG 依据。`,
            },
          ],
        };
      })
      .addNode('diagnose_rhythm', async (state) => {
        const result: RhythmAgentResult =
          await this.rhythmAnalysisAgentService.analyze({
            transcriptSegments: state.transcriptSegments,
            frameworkName: state.frameworkName,
            customFramework: state.customFramework,
            baselineMatches: state.frameworkMatches,
            ragReferences: state.ragReferences,
          });
        return {
          frameworkMatches: result.frameworkMatches,
          agentTrace: [
            {
              nodeName: '节奏诊断 ReAct Agent',
              status: 'completed' as const,
              output: result.statusText,
            },
          ],
        };
      })
      .addNode('assess_risk', async (state) => {
        const ruleFindings: ScriptFinding[] = this.detectFindings(
          state.transcriptSegments,
        );
        const deepSeekResult: {
          findings: ScriptFinding[];
          statusText: string;
        } = await this.runDeepSeekRiskAnalysis({
          transcriptSegments: state.transcriptSegments,
          frameworkName: state.frameworkName,
          customFramework: state.customFramework,
          frameworkMatches: state.frameworkMatches,
          ragReferences: state.ragReferences,
        });
        const findings: ScriptFinding[] = this.removeContextualFalsePositives(
          this.mergeFindings(ruleFindings, deepSeekResult.findings),
          state.transcriptSegments,
        );
        const ragReferences: RagReferenceSummary[] =
          await this.retrieveRagReferences(state.transcriptSegments, findings);
        const highRiskCount: number = findings.filter(
          (finding: ScriptFinding): boolean =>
            finding.riskLevel === 'critical' || finding.riskLevel === 'high',
        ).length;
        return {
          findings,
          ragReferences,
          agentTrace: [
            {
              nodeName: '风险判断 Agent',
              status: 'completed' as const,
              output: `本地规则识别 ${ruleFindings.length} 个风险点，${deepSeekResult.statusText}。合并后共 ${findings.length} 个风险点，其中 ${highRiskCount} 个为高风险。`,
            },
          ],
        };
      })
      .addNode('rewrite_advice', async (state) => {
        const result: RewriteAgentResult =
          await this.rewriteAdviceAgentService.rewrite({
            transcriptSegments: state.transcriptSegments,
            findings: state.findings,
            frameworkMatches: state.frameworkMatches,
            ragReferences: state.ragReferences,
          });
        return {
          findings: result.findings,
          reviewScript: result.reviewScript,
          agentTrace: [
            {
              nodeName: '整改话术 ReAct Agent',
              status: 'completed' as const,
              output: result.statusText,
            },
          ],
        };
      })
      .addEdge(START, 'prepare_transcript')
      .addEdge('prepare_transcript', 'retrieve_framework')
      .addEdge('retrieve_framework', 'diagnose_rhythm')
      .addEdge('diagnose_rhythm', 'assess_risk')
      .addEdge('assess_risk', 'rewrite_advice')
      .addEdge('rewrite_advice', END)
      .compile();

    return reportAgent.invoke({
      transcriptSegments,
      frameworkName: options.frameworkName,
      customFramework: options.customFramework,
      findings: [],
      frameworkMatches: [],
      reviewScript: '',
      ragReferences: [],
      agentTrace: [],
    });
  }

  private async retrieveRagReferences(
    segments: TranscriptSegmentSummary[],
    findings: ScriptFinding[],
  ): Promise<RagReferenceSummary[]> {
    const query: string = this.buildRagQuery(segments, findings);
    return this.ragKnowledgeProvider.retrieve(query, 6);
  }

  private buildRagQuery(
    segments: TranscriptSegmentSummary[],
    findings: ScriptFinding[],
  ): string {
    const sampleStep: number = Math.max(1, Math.ceil(segments.length / 12));
    const sampledSegments: TranscriptSegmentSummary[] = segments.filter(
      (_segment: TranscriptSegmentSummary, index: number): boolean =>
        index % sampleStep === 0,
    );
    const domainSegments: TranscriptSegmentSummary[] = segments.filter(
      (segment: TranscriptSegmentSummary): boolean =>
        /AI|课程|训练营|权益|价格|交付|陪跑|答疑|案例|学员|宝妈|副业|赚钱|变现|回本|接单|爆款|保证|一定|报名|名额|微信/.test(
          segment.text,
        ),
    );
    const candidates: string[] = [
      ...findings.map((finding: ScriptFinding): string => finding.originalText),
      ...domainSegments.map(
        (segment: TranscriptSegmentSummary): string => segment.text,
      ),
      ...sampledSegments.map(
        (segment: TranscriptSegmentSummary): string => segment.text,
      ),
    ];
    const uniqueTexts: Set<string> = new Set<string>();
    let charCount: number = 0;
    for (const candidate of candidates) {
      const text: string = candidate.trim();
      if (!text || uniqueTexts.has(text)) {
        continue;
      }
      const remainingChars: number = MAX_RAG_QUERY_CHARS - charCount;
      if (remainingChars <= 0) {
        break;
      }
      uniqueTexts.add(text.slice(0, remainingChars));
      charCount += Math.min(text.length, remainingChars);
    }
    return [...uniqueTexts].join('\n');
  }

  private getRagModeLabel(): string {
    return this.ragKnowledgeProvider.getLastRetrievalMode() === 'embedding'
      ? `${this.ragKnowledgeProvider.getEmbeddingModelName()} 向量检索`
      : '关键词兜底检索';
  }

  private async runDeepSeekRiskAnalysis(options: {
    transcriptSegments: TranscriptSegmentSummary[];
    frameworkName: string;
    customFramework?: string;
    frameworkMatches: FrameworkMatchSummary[];
    ragReferences: RagReferenceSummary[];
  }): Promise<{ findings: ScriptFinding[]; statusText: string }> {
    if (!this.deepSeekAnalysisService.isConfigured()) {
      return {
        findings: [],
        statusText: 'DeepSeek 未配置，已使用本地规则兜底',
      };
    }

    try {
      const findings: ScriptFinding[] =
        await this.deepSeekAnalysisService.analyzeTranscript(options);
      return {
        findings,
        statusText: `DeepSeek ${this.deepSeekAnalysisService.getModelName()} 识别 ${findings.length} 个语义风险`,
      };
    } catch {
      return {
        findings: [],
        statusText: 'DeepSeek 调用失败，已使用本地规则兜底',
      };
    }
  }

  private mergeFindings(
    ruleFindings: ScriptFinding[],
    deepSeekFindings: ScriptFinding[],
  ): ScriptFinding[] {
    const findings: ScriptFinding[] = [];
    const seenKeys: Set<string> = new Set<string>();
    for (const finding of [...ruleFindings, ...deepSeekFindings]) {
      const key: string = `${finding.originalText.trim()}-${finding.matchedRule.trim()}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      findings.push(finding);
    }
    return findings;
  }

  private removeContextualFalsePositives(
    findings: ScriptFinding[],
    segments: TranscriptSegmentSummary[],
  ): ScriptFinding[] {
    return findings.filter((finding: ScriptFinding): boolean => {
      const segment: TranscriptSegmentSummary | undefined =
        segments.find(
          (candidate: TranscriptSegmentSummary): boolean =>
            candidate.startSeconds === finding.startSeconds,
        ) ||
        segments.find(
          (candidate: TranscriptSegmentSummary): boolean =>
            candidate.startSeconds <= finding.startSeconds &&
            candidate.endSeconds > finding.startSeconds,
        );
      return !segment || !isWarningOrRefutationContext(segment.text);
    });
  }

  private detectFindings(
    segments: TranscriptSegmentSummary[],
  ): ScriptFinding[] {
    const findings: ScriptFinding[] = [];
    const rules: Array<{
      type: ScriptFinding['type'];
      riskLevel: ScriptFinding['riskLevel'];
      pattern: RegExp;
      ignorePattern?: RegExp;
      matchedRule: string;
      analysis: string;
      suggestion: string;
      replacementScript: string;
    }> = [
      {
        type: 'semantic_risk',
        riskLevel: 'high',
        pattern:
          /(保证|一定|绝对|肯定|百分百|包你|包教会|包会).{0,18}(AI|人工智能|提示词|工具|课程|训练营)?.{0,12}(赚钱|变现|涨粉|起号|成交|回本|拿结果|学会|接单)/,
        ignorePattern: /(不能|不|无法|没法|不会).{0,4}(保证|承诺)/,
        matchedRule: 'AI 变现或学习结果承诺过强',
        analysis:
          'AI 知识付费直播不能把学习结果、涨粉变现、接单回本说成确定结果，否则容易形成收益承诺。',
        suggestion:
          '改成学习目标、适用条件和执行前提，明确结果会因基础和执行情况不同。',
        replacementScript:
          '这套 AI 课程会把工具使用、提示词和实操路径讲清楚，更适合愿意持续练习和落地的人，最终结果会和个人基础、投入时间和执行情况有关。',
      },
      {
        type: 'semantic_risk',
        riskLevel: 'high',
        pattern:
          /(0基础|普通人|小白|宝妈|副业|上班族).{0,18}(三天|七天|一周|一个月|短时间).{0,18}(AI|接单|赚|变现|涨粉|成交|回本)/,
        matchedRule: 'AI 副业案例夸大收益风险',
        analysis:
          '用低门槛人群加短周期 AI 收益来刺激成交，容易被理解为普遍可复制的收益承诺。',
        suggestion:
          '案例必须讲清楚背景、投入和不可保证复制，不要把个例包装成普遍结果。',
        replacementScript:
          '我们会拆 AI 案例背后的动作、工具和执行路径，但案例结果不代表每个人都能复制，大家要结合自己的基础和可投入时间判断。',
      },
      {
        type: 'banned_word',
        riskLevel: 'medium',
        pattern: /(全网第一|行业唯一|最强|最好|顶级|第一名|唯一方法|唯一入口)/,
        matchedRule: 'AI 课程伪权威或极限背书',
        analysis: '极限化权威表达需要充分证明，否则容易变成夸大宣传。',
        suggestion: '改成课程特色、适合人群和具体交付，不做全行业绝对比较。',
        replacementScript:
          '这套 AI 课程的特点是把工具、提示词和落地流程拆得比较细，适合想系统补基础、愿意跟练的人参考。',
      },
      {
        type: 'semantic_risk',
        riskLevel: 'high',
        pattern:
          /(一键|自动|不用学|不用动手|躺着|复制粘贴).{0,18}(爆款|赚钱|变现|接单|涨粉|成交|出单)/,
        matchedRule: 'AI 工具能力夸大',
        analysis:
          '把 AI 工具说成一键赚钱、自动出单或无需学习，会夸大工具能力，也容易误导用户对课程效果的预期。',
        suggestion: '强调 AI 是提效工具，不是替代判断、交付和持续执行的保证。',
        replacementScript:
          'AI 可以帮我们提升内容生产和工作流效率，但仍然需要人来判断选题、修改内容和持续交付。',
      },
      {
        type: 'semantic_risk',
        riskLevel: 'medium',
        pattern:
          /(再不|现在不|不学|错过|不会).{0,16}(AI|人工智能).{0,16}(废了|淘汰|没机会|来不及|赚不到钱|被同行甩开)/,
        matchedRule: 'AI 焦虑式成交',
        analysis: '用恐吓式后果推动下单，会放大用户焦虑，不利于建立长期信任。',
        suggestion: '把焦虑表达改成机会说明、适用人群和理性决策提醒。',
        replacementScript:
          '如果你现在确实想把 AI 用到内容、获客或日常工作里，可以把这套课当成系统补课工具，先判断它是否适合你的阶段。',
      },
      {
        type: 'semantic_risk',
        riskLevel: 'medium',
        pattern:
          /(最后.{0,8}(名额|机会)|只剩.{0,8}(个|位|名)|马上关课|最后一波|错过.{0,8}没有)/,
        matchedRule: '虚假稀缺或过度逼单',
        analysis: '名额、关课和限时表达需要真实依据，否则容易形成虚假紧迫感。',
        suggestion:
          '改成真实活动时间、服务容量或权益截止，不要用无法证明的最后机会。',
        replacementScript:
          '这次直播间权益会按页面显示时间走，如果你觉得课程适合自己，可以在活动期内再做决定。',
      },
      {
        type: 'semantic_risk',
        riskLevel: 'medium',
        pattern: /(不会侵权|百分百原创|原创度).{0,16}(AI|生成|改写|洗稿|搬运)/,
        matchedRule: 'AI 生成内容版权表述过满',
        analysis:
          'AI 生成内容涉及版权、平台规则和人工审核，不能简单承诺百分百原创或一定不侵权。',
        suggestion: '补充人工审核、素材来源和平台规则边界。',
        replacementScript:
          'AI 生成内容需要结合素材来源、平台规则和人工审核来使用，课程会教大家做合规检查和二次修改。',
      },
      {
        type: 'banned_word',
        riskLevel: 'high',
        pattern:
          /(加我|私信|微信|vx|二维码|主页).{0,16}(报名|付款|转账|成交|交钱)/i,
        matchedRule: '站外导流或私下交易风险',
        analysis: '引导用户到站外付款或私下交易，容易触发平台交易规避风险。',
        suggestion: '报名、咨询和支付都应回到平台允许的路径内完成。',
        replacementScript:
          '想了解课程的朋友可以先看直播间页面说明，报名和售后都按平台规则来走。',
      },
    ];

    for (const segment of segments) {
      for (const rule of rules) {
        const match: RegExpMatchArray | null = segment.text.match(rule.pattern);
        const matchedText: string | undefined = match?.[0];
        if (!matchedText) {
          continue;
        }
        const matchIndex: number = match.index ?? 0;
        const contextBeforeMatch: string = segment.text.slice(
          Math.max(0, matchIndex - 6),
          matchIndex,
        );
        if (rule.ignorePattern?.test(`${contextBeforeMatch}${matchedText}`)) {
          continue;
        }
        findings.push({
          id: `finding-${findings.length + 1}`,
          type: rule.type,
          riskLevel: rule.riskLevel,
          startSeconds: segment.startSeconds,
          originalText: matchedText,
          matchedRule: rule.matchedRule,
          analysis: rule.analysis,
          suggestion: rule.suggestion,
          replacementScript: rule.replacementScript,
        });
      }
    }

    return findings;
  }

  private buildFrameworkMatches(
    segments: TranscriptSegmentSummary[],
    customFramework?: string,
  ): FrameworkMatchSummary[] {
    if (customFramework?.trim()) {
      return this.buildCustomFrameworkMatches(segments, customFramework);
    }

    const fullText: string = segments
      .map((segment: TranscriptSegmentSummary): string => segment.text)
      .join(' ');
    const durationMinutes: number =
      Math.max(
        ...segments.map(
          (segment: TranscriptSegmentSummary): number => segment.endSeconds,
        ),
        0,
      ) / 60;
    const stageRules: TimelineStageRule[] = [
      {
        stageName: '集中输出 AI 干货',
        expectedWindow: '0-60 分钟',
        startMinute: 0,
        endMinute: 60,
        keywords: [
          'AI',
          '提示词',
          '工具',
          '模板',
          'SOP',
          '流程',
          '工作流',
          '实操',
          '教程',
          '抖音',
          '剪辑',
          '文案',
          '获客',
          '内容',
        ],
        suggestion:
          '前 60 分钟重点交付可感知价值，让用户觉得直播间真的有东西，不急着强卖课。',
      },
      {
        stageName: '课程承接与权益说明',
        expectedWindow: '60-84 分钟',
        startMinute: 60,
        endMinute: 84,
        keywords: [
          '课程',
          '训练营',
          '陪跑',
          '社群',
          '录播',
          '直播课',
          '作业',
          '点评',
          '答疑',
          '权益',
          '工具包',
          '报名',
        ],
        suggestion:
          '60 分钟后再承接课程，讲清交付、权益、服务周期和报名路径，避免只靠结果承诺促单。',
      },
      {
        stageName: '成功案例与人设强化',
        expectedWindow: '84-90 分钟',
        startMinute: 84,
        endMinute: 90,
        keywords: [
          '案例',
          '学员',
          '实操',
          '结果',
          '经验',
          '带过',
          '成长',
          '反馈',
          '复盘',
          '人设',
          '老师',
        ],
        suggestion:
          '案例要继续立人设，但必须讲清背景、投入和不可保证复制，不能把个例包装成普遍收益。',
      },
      {
        stageName: '持续成交承接',
        expectedWindow: '90 分钟后',
        startMinute: 90,
        keywords: [
          '下单',
          '报名',
          '链接',
          '咨询',
          '名额',
          '活动',
          '权益',
          '截止',
          '最后',
          '现在拍',
          '课程详情',
          '平台规则',
        ],
        suggestion:
          '后续可以持续做成交承接，但要控制逼单风险，所有报名和售后都回到平台允许路径。',
      },
    ];

    return stageRules.map((rule): FrameworkMatchSummary => {
      const matchedKeyword: string | undefined = rule.keywords.find(
        (keyword: string): boolean => fullText.includes(keyword),
      );
      const hasReachedWindow: boolean = durationMinutes >= rule.startMinute;
      const shortClipInCurrentWindow: boolean =
        durationMinutes < 10 && rule.startMinute === 0;
      if (!matchedKeyword && !hasReachedWindow) {
        return {
          stageName: rule.stageName,
          status: 'not_applicable',
          expectedWindow: rule.expectedWindow,
          evidence: `当前录屏时长约 ${Math.max(1, Math.ceil(durationMinutes))} 分钟，尚未进入“${rule.expectedWindow}”窗口，暂不强判缺失。`,
          suggestion: rule.suggestion,
        };
      }
      if (!matchedKeyword && shortClipInCurrentWindow) {
        return {
          stageName: rule.stageName,
          status: 'weak',
          expectedWindow: rule.expectedWindow,
          evidence:
            '当前是短片段，尚未明显识别到 AI 干货关键词，建议录更长片段或上传完整开场段再判断。',
          suggestion: rule.suggestion,
        };
      }
      return {
        stageName: rule.stageName,
        status: matchedKeyword ? 'matched' : 'missing',
        expectedWindow: rule.expectedWindow,
        evidence: matchedKeyword
          ? `在“${rule.expectedWindow}”框架中识别到关键词“${matchedKeyword}”，说明本段覆盖了该环节。`
          : `当前转写内容已进入或覆盖“${rule.expectedWindow}”窗口，但没有明显识别到该环节话术。`,
        suggestion: rule.suggestion,
      };
    });
  }

  private buildCustomFrameworkMatches(
    segments: TranscriptSegmentSummary[],
    customFramework: string,
  ): FrameworkMatchSummary[] {
    const fullText: string = segments
      .map((segment: TranscriptSegmentSummary): string => segment.text)
      .join(' ');
    const durationMinutes: number =
      Math.max(
        ...segments.map(
          (segment: TranscriptSegmentSummary): number => segment.endSeconds,
        ),
        0,
      ) / 60;
    const frameworkItems: string[] = customFramework
      .split(/\n|；|;/)
      .map((item: string): string => item.replace(/^\s*[-*\d.、]+/, '').trim())
      .filter((item: string): boolean => item.length > 0)
      .slice(0, 6);

    if (frameworkItems.length === 0) {
      return this.buildFrameworkMatches(segments);
    }

    return frameworkItems.map(
      (item: string, index: number): FrameworkMatchSummary => {
        const matchedKeyword: string | undefined =
          this.extractFrameworkKeywords(item).find((keyword: string): boolean =>
            fullText.includes(keyword),
          );
        const status: FrameworkMatchSummary['status'] = matchedKeyword
          ? 'matched'
          : durationMinutes < 10
            ? 'weak'
            : 'missing';
        return {
          stageName: `用户框架 ${index + 1}`,
          status,
          expectedWindow: this.extractExpectedWindow(item),
          evidence: matchedKeyword
            ? `自定义框架要求“${item}”，当前转写中识别到关键词“${matchedKeyword}”。`
            : `自定义框架要求“${item}”，当前片段暂未识别到明显对应话术。`,
          suggestion:
            status === 'matched'
              ? '该要求已有基础覆盖，建议继续检查表达边界和案例可信度。'
              : `建议补充能体现“${item}”的具体话术，并避免用保证结果或过度逼单来硬转化。`,
        };
      },
    );
  }

  private extractFrameworkKeywords(text: string): string[] {
    const candidates: string[] = [
      'AI',
      '人工智能',
      '焦虑',
      '干货',
      '案例',
      '手把手',
      '课程',
      '权益',
      '价格',
      '交付',
      '服务',
      '宝妈',
      '服装店',
      '副业',
      '自媒体',
      '结果',
      '逼单',
      '报名',
      '成交',
      '工具',
      '提示词',
      '变现',
      '陪跑',
      '答疑',
    ];
    return candidates.filter((keyword: string): boolean =>
      text.includes(keyword),
    );
  }

  private extractExpectedWindow(text: string): string | undefined {
    return text.match(
      /(\d+\s*[-~—至]\s*\d+\s*分钟|前\s*\d+\s*分钟|\d+\s*分钟后)/,
    )?.[0];
  }

  private inferSegmentStage(text: string): string {
    if (
      /(课程|训练营|陪跑|社群|录播|直播课|作业|点评|答疑|权益|工具包|报名)/.test(
        text,
      )
    ) {
      return '课程承接';
    }
    if (/(案例|学员|结果|经验|带过|成长|反馈|复盘|人设|老师)/.test(text)) {
      return '案例人设';
    }
    if (
      /(下单|链接|咨询|名额|活动|截止|最后|现在拍|课程详情|平台规则)/.test(text)
    ) {
      return '成交承接';
    }
    if (
      /(AI|人工智能|提示词|工具|模板|SOP|流程|工作流|实操|教程|抖音|剪辑|文案|获客|内容)/.test(
        text,
      )
    ) {
      return '干货输出';
    }
    return '互动承接';
  }

  private buildOverallDiagnosis(
    transcriptWordCount: number,
    findings: ScriptFinding[],
    frameworkMatches: FrameworkMatchSummary[],
  ): string {
    const highRiskFindings: number = findings.filter(
      (finding: ScriptFinding): boolean =>
        finding.riskLevel === 'critical' || finding.riskLevel === 'high',
    ).length;
    const missingStages: string[] = frameworkMatches
      .filter(
        (match: FrameworkMatchSummary): boolean => match.status === 'missing',
      )
      .map((match: FrameworkMatchSummary): string => match.stageName);

    if (transcriptWordCount === 0) {
      return '当前录屏没有识别到有效话术，建议换一段人声更清晰的直播录屏重新分析。';
    }
    if (highRiskFindings > 0) {
      return `本段话术已经识别到 ${highRiskFindings} 个高风险表达，核心问题是 AI 变现或学习结果承诺过满。建议把“保证、一定、包会、躺赚”等说法改成适用人群、学习条件和执行边界。`;
    }
    if (missingStages.length > 0) {
      return `本段话术整体风险不高，但 AI 知识付费框架覆盖还不完整，缺少：${missingStages.join('、')}。建议补齐后再进入成交承接。`;
    }
    return '本段话术风险较低，目标人群、AI 痛点、方法路径、课程交付和成交承接都有覆盖，可以继续优化案例边界和表达可信度。';
  }

  private getPrototypeAgentTrace(
    transcriptSegments: TranscriptSegmentSummary[],
    findings: ScriptFinding[],
  ): AgentTraceStep[] {
    return [
      {
        nodeName: '转写整理 Agent',
        status: 'completed',
        output: `读取样例 ASR 文本 ${transcriptSegments.length} 段，保留时间戳和字数。`,
      },
      {
        nodeName: '框架检索 Agent',
        status: 'completed',
        output:
          '检索 AI 知识付费直播全场框架，按 0-60 干货、60-84 课程权益、84-90 案例人设、90 分钟后成交承接判断。',
      },
      {
        nodeName: '节奏诊断 ReAct Agent',
        status: 'completed',
        output: '结合框架时间窗和逐字稿证据，判断阶段覆盖与实际节奏。',
      },
      {
        nodeName: '风险判断 Agent',
        status: 'completed',
        output: `识别 ${findings.length} 个样例风险点，覆盖违禁词、语义风险和框架缺口。`,
      },
      {
        nodeName: '整改话术 ReAct Agent',
        status: 'completed',
        output: `结合风险和节奏生成 ${findings.length} 条可替换话术及整段复盘改稿。`,
      },
    ];
  }

  private getPrototypeTranscript(): TranscriptSegmentSummary[] {
    const stages: string[] = [
      '目标人群',
      'AI 痛点',
      '方法路径',
      '案例边界/成交承接',
    ];
    return this.aliyunAsrService
      .normalizeTranscriptionResult(
        this.aliyunAsrService.buildPrototypeAliyunResult(),
      )
      .map(
        (
          segment: TranscriptSegmentSummary,
          index: number,
        ): TranscriptSegmentSummary => ({
          ...segment,
          matchedStage: stages[index] || 'unknown',
        }),
      );
  }

  private getPrototypeFindings(): ScriptFinding[] {
    return [
      {
        id: 'finding-1',
        type: 'semantic_risk',
        riskLevel: 'high',
        startSeconds: 224,
        originalText: '保证你一个月用AI变现',
        matchedRule: 'AI 变现或学习结果承诺过强',
        analysis:
          '这句话把 AI 学习结果和变现结果说成确定收益，容易形成收益承诺。',
        suggestion: '改成学习目标、适用条件和执行前提，避免保证型表达。',
        replacementScript:
          '这套课会带你拆 AI 工具、提示词和落地流程，适合愿意持续练习的人，具体结果和个人基础、投入时间、执行情况有关。',
      },
      {
        id: 'finding-2',
        type: 'semantic_risk',
        riskLevel: 'high',
        startSeconds: 224,
        originalText: '0基础小白七天接单回本',
        matchedRule: 'AI 副业案例夸大收益风险',
        analysis: '低门槛人群加短周期收益，容易让用户理解为普遍可复制。',
        suggestion: '案例必须说明背景、投入和不可保证复制。',
        replacementScript:
          '我们会拆案例里的工具选择、交付动作和练习路径，但案例结果不代表每个人都能复制。',
      },
      {
        id: 'finding-3',
        type: 'semantic_risk',
        riskLevel: 'high',
        startSeconds: 224,
        originalText: '一键生成爆款内容',
        matchedRule: 'AI 工具能力夸大',
        analysis:
          '把 AI 工具包装成一键赚钱，会夸大工具能力，也会误导用户对课程的预期。',
        suggestion: '强调 AI 是提效工具，仍需要人工判断、修改和持续交付。',
        replacementScript:
          'AI 能提高内容生产效率，但选题判断、内容修改和最终交付仍然需要人来完成。',
      },
      {
        id: 'finding-4',
        type: 'semantic_risk',
        riskLevel: 'medium',
        startSeconds: 0,
        originalText: '想用AI做副业',
        matchedRule: 'AI 副业收益暗示边界',
        analysis:
          '把 AI 和副业结果直接放在一起，可能让用户把课程理解成轻松赚钱的捷径。',
        suggestion:
          '先讲清楚具体应用场景、适用人群和学习投入，不暗示稳定收益。',
        replacementScript:
          '如果你想了解 AI 怎么提升内容和工作效率，今天先跟着我做一个简单案例，再判断这套方法适不适合你。',
      },
    ];
  }

  private getPrototypeFrameworkMatches(): FrameworkMatchSummary[] {
    return [
      {
        stageName: '集中输出 AI 干货',
        status: 'matched',
        expectedWindow: '0-60 分钟',
        actualStartSeconds: 0,
        actualEndSeconds: 224,
        evidenceSegmentIds: ['asr-1', 'asr-2', 'asr-3'],
        timingIssue: 'on_track',
        confidence: 'high',
        evidence: '样例中包含 AI 工具、提示词和实操路径内容。',
        suggestion: '继续保持干货密度，让用户先感知价值，再承接课程。',
      },
      {
        stageName: '课程承接与权益说明',
        status: 'not_applicable',
        expectedWindow: '60-84 分钟',
        evidenceSegmentIds: [],
        timingIssue: 'not_applicable',
        confidence: 'high',
        evidence: '样例片段时长不足 60 分钟，暂不强判课程承接缺失。',
        suggestion: '60 分钟后再集中讲课程交付、权益、服务周期和报名路径。',
      },
      {
        stageName: '成功案例与人设强化',
        status: 'not_applicable',
        expectedWindow: '84-90 分钟',
        evidenceSegmentIds: [],
        timingIssue: 'not_applicable',
        confidence: 'high',
        evidence: '样例片段尚未进入 84-90 分钟窗口，暂不强判案例人设缺失。',
        suggestion: '案例要继续立人设，但必须说明背景、投入和不可保证复制。',
      },
      {
        stageName: '持续成交承接',
        status: 'not_applicable',
        expectedWindow: '90 分钟后',
        evidenceSegmentIds: [],
        timingIssue: 'not_applicable',
        confidence: 'high',
        evidence: '样例片段尚未进入 90 分钟后的成交承接窗口，暂不强判。',
        suggestion:
          '后续可以持续成交承接，但要控制过度逼单、虚假稀缺和站外交易风险。',
      },
    ];
  }
}
