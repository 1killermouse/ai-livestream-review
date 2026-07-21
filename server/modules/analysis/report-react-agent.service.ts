import { Injectable, Logger } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';

import type {
  FrameworkMatchSummary,
  PrototypeAnalysisReport,
  RagReferenceSummary,
  ReportAnswerConfidence,
  ReportChatFallbackReason,
  ReportChatMessage,
  ReportChatResponse,
  ScriptFinding,
  TranscriptSegmentSummary,
} from '@shared/api.interface';

import { DeepSeekAnalysisService } from './deepseek-analysis.service';
import { RagKnowledgeProvider } from './rag-knowledge.provider';
import {
  isWarningOrRefutationContext,
  ReportAnswerEvidenceValidator,
  type ObservedReportEvidence,
  type SubmittedReportAnswer,
} from './report-answer-evidence.validator';
import {
  ReportQuestionIntentRouter,
  type ReportQuestionIntent,
  type ReportQuestionIntentResult,
} from './report-question-intent.router';

interface ReportReactAgentOptions {
  report: PrototypeAnalysisReport;
  question: string;
  messages: ReportChatMessage[];
  fallbackSegments: TranscriptSegmentSummary[];
}

interface ReportToolEvidenceContext extends ObservedReportEvidence {
  segments: Map<string, TranscriptSegmentSummary>;
  findings: Map<string, ScriptFinding>;
}

interface AnswerSubmissionRef {
  value?: SubmittedReportAnswer;
}

interface LocalAnswerResult {
  answer: string;
  relatedSegments: TranscriptSegmentSummary[];
  confidence: ReportAnswerConfidence;
  citationCount: number;
}

@Injectable()
export class ReportReactAgentService {
  private readonly logger = new Logger(ReportReactAgentService.name);

  constructor(
    private readonly deepSeekAnalysisService: DeepSeekAnalysisService,
    private readonly ragKnowledgeProvider: RagKnowledgeProvider,
    private readonly intentRouter: ReportQuestionIntentRouter,
    private readonly evidenceValidator: ReportAnswerEvidenceValidator,
  ) {}

  async answer(options: ReportReactAgentOptions): Promise<ReportChatResponse> {
    const intentResult: ReportQuestionIntentResult = this.intentRouter.classify(
      options.question,
      options.messages,
    );
    if (!this.deepSeekAnalysisService.isConfigured()) {
      return this.answerLocally(options, 'model_not_configured', intentResult);
    }

    const evidenceContext: ReportToolEvidenceContext = {
      segments: new Map(),
      findings: new Map(),
      segmentIds: new Set(),
      findingIds: new Set(),
      frameworkStages: new Set(),
      overviewUsed: false,
    };
    const submissionRef: AnswerSubmissionRef = {};
    const tools = this.createTools(
      options.report,
      evidenceContext,
      submissionRef,
    );
    const agent = createReactAgent({
      llm: this.deepSeekAnalysisService.createToolCallingModel(),
      tools,
      name: 'livestream_report_react_agent',
      version: 'v2',
      prompt: this.buildSystemPrompt(options.report, intentResult),
    });

    try {
      await agent.invoke(
        {
          messages: [
            ...options.messages.slice(-6).map((message: ReportChatMessage) => ({
              role: message.role,
              content: message.content,
            })),
            { role: 'user', content: options.question },
          ],
        },
        { recursionLimit: 12 },
      );
      if (!submissionRef.value) {
        this.logger.warn('ReAct 未通过 submit_report_answer 提交答案');
        return this.answerLocally(options, 'submission_missing', intentResult);
      }

      const validation = this.evidenceValidator.validate({
        report: options.report,
        question: options.question,
        intent: intentResult.intent,
        submission: submissionRef.value,
        observed: evidenceContext,
      });
      if (!validation.valid) {
        this.logger.warn(
          `ReAct 证据校验未通过：${validation.reasons.join('；')}`,
        );
        return this.answerLocally(options, 'validation_failed', intentResult);
      }

      return {
        answer: this.sanitizeAnswer(submissionRef.value.answer),
        relatedSegments: validation.relatedSegments,
        evidence: {
          validated: true,
          confidence: validation.confidence,
          citationCount: validation.citationCount,
          fallbackUsed: false,
          source: 'react_validated',
        },
      };
    } catch (error: unknown) {
      this.logger.warn(
        `ReAct 调用失败，已改用本地报告答案：${error instanceof Error ? error.message : '未知错误'}`,
      );
      return this.answerLocally(options, 'agent_failed', intentResult);
    }
  }

  private createTools(
    report: PrototypeAnalysisReport,
    evidenceContext: ReportToolEvidenceContext,
    submissionRef: AnswerSubmissionRef,
  ) {
    const rememberSegments = (segments: TranscriptSegmentSummary[]): void => {
      for (const segment of segments) {
        evidenceContext.segments.set(segment.id, segment);
        evidenceContext.segmentIds.add(segment.id);
      }
    };
    const rememberFindings = (findings: ScriptFinding[]): void => {
      for (const finding of findings) {
        evidenceContext.findings.set(finding.id, finding);
        evidenceContext.findingIds.add(finding.id);
      }
    };

    const getReportOverview = tool(
      () => {
        evidenceContext.overviewUsed = true;
        return JSON.stringify({
          title: report.title,
          durationSeconds: report.durationSeconds,
          transcriptWordCount: report.transcriptWordCount,
          frameworkName: report.frameworkName,
          summary: report.summary,
        });
      },
      {
        name: 'get_report_overview',
        description:
          '查看本场直播的基本信息、总体诊断和风险数量。回答整体情况时先调用。',
        schema: z.object({}),
      },
    );

    const searchTranscript = tool(
      ({ query, limit }) => {
        const segments: TranscriptSegmentSummary[] = this.searchTranscript(
          report.transcriptSegments,
          query,
          limit,
        );
        rememberSegments(segments);
        return JSON.stringify(
          segments.map((segment: TranscriptSegmentSummary) => ({
            segmentId: segment.id,
            startSeconds: segment.startSeconds,
            endSeconds: segment.endSeconds,
            timeLabel: this.formatSeconds(segment.startSeconds),
            text: segment.text.slice(0, 1200),
            matchedStage: segment.matchedStage,
          })),
        );
      },
      {
        name: 'search_transcript',
        description:
          '按问题或关键词检索本场直播逐字稿，返回原话和时间点。需要引用主播原话时必须调用。',
        schema: z.object({
          query: z.string().min(1).describe('要检索的主题或关键词'),
          limit: z.number().int().min(1).max(8).default(5),
        }),
      },
    );

    const inspectRisks = tool(
      ({ query, riskLevel, limit }) => {
        const findings: ScriptFinding[] = this.searchFindings(
          report.findings,
          query,
          riskLevel,
          limit,
        );
        rememberFindings(findings);
        rememberSegments(
          findings
            .map((finding: ScriptFinding) =>
              this.findSegmentAt(
                report.transcriptSegments,
                finding.startSeconds,
              ),
            )
            .filter(
              (
                segment: TranscriptSegmentSummary | undefined,
              ): segment is TranscriptSegmentSummary => Boolean(segment),
            ),
        );
        return JSON.stringify(
          findings.map((finding: ScriptFinding) => {
            const contextSegment: TranscriptSegmentSummary | undefined =
              this.findSegmentAt(
                report.transcriptSegments,
                finding.startSeconds,
              );
            const warningOrRefutation: boolean = isWarningOrRefutationContext(
              contextSegment?.text || finding.originalText,
            );
            return {
              findingId: finding.id,
              riskLevel: finding.riskLevel,
              timeLabel: this.formatSeconds(finding.startSeconds),
              originalText: finding.originalText,
              contextText: contextSegment?.text,
              speechContext: warningOrRefutation
                ? 'warning_or_refutation'
                : 'speaker_claim_or_unclear',
              contextNote: warningOrRefutation
                ? '这段是在引用、否定或提醒，不应直接归为主播自己的承诺。'
                : undefined,
              matchedRule: finding.matchedRule,
              analysis: finding.analysis,
              suggestion: finding.suggestion,
            };
          }),
        );
      },
      {
        name: 'inspect_risks',
        description:
          '查看本场已识别的违禁词、语义风险、风险等级和判断依据。询问违规、夸大、承诺或逼单时必须调用。',
        schema: z.object({
          query: z.string().optional().describe('风险主题或原话关键词'),
          riskLevel: z.enum(['critical', 'high', 'medium', 'low']).optional(),
          limit: z.number().int().min(1).max(8).default(6),
        }),
      },
    );

    const inspectFramework = tool(
      ({ query }) => {
        const matches: FrameworkMatchSummary[] = this.searchFrameworkMatches(
          report.frameworkMatches,
          query,
        );
        for (const match of matches) {
          evidenceContext.frameworkStages.add(match.stageName);
        }
        return JSON.stringify(matches);
      },
      {
        name: 'inspect_framework',
        description:
          '查看干货、课程承接、案例、成交等环节的覆盖和节奏问题。询问直播节奏或环节缺失时调用。',
        schema: z.object({
          query: z.string().optional().describe('要查看的阶段或问题'),
        }),
      },
    );

    const inspectRewrites = tool(
      ({ query, limit }) => {
        const findings: ScriptFinding[] = this.searchFindings(
          report.findings,
          query,
          undefined,
          limit,
        );
        rememberFindings(findings);
        rememberSegments(
          findings
            .map((finding: ScriptFinding) =>
              this.findSegmentAt(
                report.transcriptSegments,
                finding.startSeconds,
              ),
            )
            .filter(
              (
                segment: TranscriptSegmentSummary | undefined,
              ): segment is TranscriptSegmentSummary => Boolean(segment),
            ),
        );
        return JSON.stringify(
          findings.map((finding: ScriptFinding) => ({
            findingId: finding.id,
            timeLabel: this.formatSeconds(finding.startSeconds),
            originalText: finding.originalText,
            problem: finding.analysis,
            rewriteDirection: finding.suggestion,
            replacementScript: finding.replacementScript,
          })),
        );
      },
      {
        name: 'inspect_rewrite_suggestions',
        description:
          '查看报告中已生成的可直接使用的替换话术。用户要求“怎么改”或“帮我重写”时必须调用。',
        schema: z.object({
          query: z.string().min(1).describe('要改写的风险主题或原话'),
          limit: z.number().int().min(1).max(6).default(3),
        }),
      },
    );

    const retrieveKnowledge = tool(
      async ({ query }) => {
        const references: RagReferenceSummary[] =
          await this.ragKnowledgeProvider.retrieve(query, 4);
        return JSON.stringify(references);
      },
      {
        name: 'retrieve_review_knowledge',
        description:
          '从话术框架、风险规则、案例和改写模板知识库检索依据。需要补充判断标准或生成新话术时调用。',
        schema: z.object({
          query: z.string().min(1).describe('要检索的知识问题'),
        }),
      },
    );

    const submitAnswer = tool(
      ({ answer, segmentIds, findingIds, frameworkStages, confidence }) => {
        submissionRef.value = {
          answer: answer.trim(),
          segmentIds,
          findingIds,
          frameworkStages,
          confidence,
        };
        return JSON.stringify({
          accepted: true,
          instruction: '答案已提交，请直接结束。',
        });
      },
      {
        name: 'submit_report_answer',
        description:
          '提交给主播的最终答案和证据。必须作为最后一个工具调用，所有ID必须来自之前工具返回的本场报告依据。',
        schema: z.object({
          answer: z.string().min(1).max(5000),
          segmentIds: z.array(z.string()).max(8).default([]),
          findingIds: z.array(z.string()).max(8).default([]),
          frameworkStages: z.array(z.string()).max(8).default([]),
          confidence: z.enum(['high', 'medium', 'low']).default('medium'),
        }),
      },
    );

    return [
      getReportOverview,
      searchTranscript,
      inspectRisks,
      inspectFramework,
      inspectRewrites,
      retrieveKnowledge,
      submitAnswer,
    ];
  }

  private answerLocally(
    options: ReportReactAgentOptions,
    fallbackReason: ReportChatFallbackReason,
    intentResult: ReportQuestionIntentResult,
  ): ReportChatResponse {
    const localResult: LocalAnswerResult = this.buildLocalAnswer(
      options.report,
      options.question,
      options.fallbackSegments,
      intentResult,
    );
    return {
      answer: this.sanitizeAnswer(localResult.answer),
      relatedSegments: localResult.relatedSegments,
      evidence: {
        validated: true,
        confidence: localResult.confidence,
        citationCount: localResult.citationCount,
        fallbackUsed: true,
        source: 'local_fallback',
        fallbackReason,
      },
    };
  }

  private buildLocalAnswer(
    report: PrototypeAnalysisReport,
    question: string,
    relatedSegments: TranscriptSegmentSummary[],
    intentResult: ReportQuestionIntentResult,
  ): LocalAnswerResult {
    const intent: ReportQuestionIntent = intentResult.intent;
    const evidenceQuery: string = intentResult.searchQuery || question;
    if (intent === 'summary_action') {
      const findings: ScriptFinding[] = this.searchFindings(
        report.findings,
        undefined,
        undefined,
        3,
      );
      const warningSegments: TranscriptSegmentSummary[] = this.uniqueSegments(
        findings
          .map((finding: ScriptFinding) =>
            this.findSegmentAt(report.transcriptSegments, finding.startSeconds),
          )
          .filter(
            (
              segment: TranscriptSegmentSummary | undefined,
            ): segment is TranscriptSegmentSummary =>
              Boolean(segment && isWarningOrRefutationContext(segment.text)),
          ),
      );
      if (findings.length > 0 && warningSegments.length > 0) {
        const firstTime: string = this.formatSeconds(
          warningSegments[0].startSeconds,
        );
        return {
          answer: `报告原本把 ${firstTime} 附近的 ${findings.length} 句话列为风险，但结合完整原文，它们是主播用来提醒用户的反例，不是主播自己的收益承诺，不应该按 ${findings.length} 次承诺来理解。这里真正要改的是表达方式：减少逐字复述这些敏感说法，直接说：“遇到过度保证结果、强调短期回本或夸大工具效果的说法，要先核实交付内容和适用条件。”`,
          relatedSegments: warningSegments,
          confidence: 'high',
          citationCount: findings.length + warningSegments.length,
        };
      }

      if (findings.length > 0) {
        const findingSegments: TranscriptSegmentSummary[] = this.uniqueSegments(
          findings
            .map((finding: ScriptFinding) =>
              this.findSegmentAt(
                report.transcriptSegments,
                finding.startSeconds,
              ),
            )
            .filter(
              (
                segment: TranscriptSegmentSummary | undefined,
              ): segment is TranscriptSegmentSummary => Boolean(segment),
            ),
        );
        return {
          answer: `${report.summary.overallDiagnosis}下一场优先处理：${findings
            .map(
              (finding: ScriptFinding, index: number): string =>
                `${index + 1}. ${this.formatSeconds(finding.startSeconds)} 的“${finding.originalText}”，${finding.suggestion}`,
            )
            .join('；')}`,
          relatedSegments: findingSegments,
          confidence: findingSegments.length > 0 ? 'high' : 'medium',
          citationCount: findings.length + findingSegments.length,
        };
      }
    }

    if (intent === 'rewrite') {
      const findingIndex: number = intentResult.referencedItemIndex || 0;
      const finding: ScriptFinding | undefined = this.searchFindings(
        report.findings,
        intentResult.referencedItemIndex === undefined
          ? evidenceQuery
          : undefined,
        undefined,
        findingIndex + 1,
      )[findingIndex];
      if (finding) {
        const warningAnswer: LocalAnswerResult | undefined =
          this.buildWarningContextAnswer(report, finding, relatedSegments);
        if (warningAnswer) {
          return warningAnswer;
        }
        return this.buildLocalFindingAnswer(
          report,
          finding,
          `${this.formatSeconds(finding.startSeconds)} 这句“${finding.originalText}”建议改成：${finding.replacementScript}`,
          relatedSegments,
        );
      }
    }

    if (intent === 'risk_locate' || intent === 'risk_explain') {
      const finding: ScriptFinding | undefined = this.searchFindings(
        report.findings,
        evidenceQuery,
        undefined,
        1,
      )[0];
      if (finding) {
        const warningAnswer: LocalAnswerResult | undefined =
          this.buildWarningContextAnswer(report, finding, relatedSegments);
        if (warningAnswer) {
          return warningAnswer;
        }
        const answer: string =
          intent === 'risk_explain'
            ? `${this.formatSeconds(finding.startSeconds)} 这句“${finding.originalText}”之所以有风险，是因为${finding.analysis}${finding.suggestion}`
            : `本场最需要先改的是 ${this.formatSeconds(finding.startSeconds)} 的“${finding.originalText}”。${finding.analysis}${finding.suggestion}`;
        return this.buildLocalFindingAnswer(
          report,
          finding,
          answer,
          relatedSegments,
        );
      }
    }

    if (intent === 'rhythm') {
      const matches: FrameworkMatchSummary[] = this.searchFrameworkMatches(
        report.frameworkMatches,
        evidenceQuery,
      );
      const match: FrameworkMatchSummary | undefined =
        matches.find(
          (candidate: FrameworkMatchSummary): boolean =>
            candidate.status !== 'matched',
        ) || matches[0];
      if (match) {
        return {
          answer: `${match.stageName}这一环节当前${match.evidence}。下一场建议：${match.suggestion}`,
          relatedSegments: [],
          confidence: 'medium',
          citationCount: 1,
        };
      }
    }

    const evidence: TranscriptSegmentSummary | undefined = relatedSegments[0];
    return {
      answer: evidence
        ? `${report.summary.overallDiagnosis}可以先回看 ${this.formatSeconds(evidence.startSeconds)} 附近：“${evidence.text}”。`
        : report.summary.overallDiagnosis || '这场报告里暂时看不到。',
      relatedSegments: evidence ? [evidence] : [],
      confidence: 'medium',
      citationCount: 1,
    };
  }

  private buildLocalFindingAnswer(
    report: PrototypeAnalysisReport,
    finding: ScriptFinding,
    answer: string,
    fallbackSegments: TranscriptSegmentSummary[],
  ): LocalAnswerResult {
    const segment: TranscriptSegmentSummary | undefined = this.findSegmentAt(
      report.transcriptSegments,
      finding.startSeconds,
    );
    return {
      answer,
      relatedSegments: segment ? [segment] : fallbackSegments.slice(0, 1),
      confidence: segment ? 'high' : 'medium',
      citationCount: segment ? 2 : 1,
    };
  }

  private buildWarningContextAnswer(
    report: PrototypeAnalysisReport,
    finding: ScriptFinding,
    fallbackSegments: TranscriptSegmentSummary[],
  ): LocalAnswerResult | undefined {
    const segment: TranscriptSegmentSummary | undefined = this.findSegmentAt(
      report.transcriptSegments,
      finding.startSeconds,
    );
    if (!segment || !isWarningOrRefutationContext(segment.text)) {
      return undefined;
    }
    return {
      answer: `${this.formatSeconds(finding.startSeconds)} 这段是在提醒用户警惕夸张说法，不是主播自己的收益承诺。为了表达更干净，可以不逐字复述具体承诺，直接改成：“遇到过度保证结果、夸大工具效果的说法，要先核实交付内容和适用条件。”`,
      relatedSegments: [segment],
      confidence: 'high',
      citationCount: 2,
    };
  }

  private uniqueSegments(
    segments: TranscriptSegmentSummary[],
  ): TranscriptSegmentSummary[] {
    return [
      ...new Map(
        segments.map((segment: TranscriptSegmentSummary) => [
          segment.id,
          segment,
        ]),
      ).values(),
    ].slice(0, 8);
  }

  private buildSystemPrompt(
    report: PrototypeAnalysisReport,
    intentResult: ReportQuestionIntentResult,
  ): string {
    const intentLabels: Record<ReportQuestionIntent, string> = {
      risk_locate: '定位风险原话和时间点',
      risk_explain: '解释风险原因和判断依据',
      rewrite: '生成可直接使用的整改话术',
      rhythm: '分析直播阶段和节奏',
      summary_action: '总结本场并给出行动优先级',
      unknown: '意图暂不明确',
    };
    return [
      '你是AI知识付费直播播后复盘顾问，需要用ReAct方式先理解问题、调用工具查证，再给结论。',
      `意图路由结果：${intentLabels[intentResult.intent]}，置信度：${intentResult.confidence}。`,
      `当前检索主题：${intentResult.searchQuery.slice(0, 300)}。`,
      intentResult.referencedItemIndex === undefined
        ? '用户没有指定列表序号。'
        : `用户指的是列表中的第 ${intentResult.referencedItemIndex + 1} 条，查询风险或改写建议时要按工具返回顺序定位这一条。`,
      `建议优先调用：${intentResult.recommendedTools.join('、')}。意图只是查证路线建议，证据不足时可以继续调用其他工具。`,
      '涉及本场的原话、时间点、风险、节奏或改写时，必须调用对应工具，不能凭常识猜测。',
      '只围绕这场报告回答；报告没有依据时，明确说“这场报告里暂时看不到”。',
      '回答用主播听得懂的大白话，优先给直接结论、对应时间点和能直接开播的改法。',
      '不要暴露思考过程、工具名称或技术架构，不要编造数据，不要使用Markdown符号。',
      '风险结论是本项目的复盘建议，不是平台官方审核结果；不得声称一定会处罚或封禁。',
      '必须先区分主播是在做承诺，还是在引用、否定或提醒。若工具标记 speechContext=warning_or_refutation，不得把原话直接写成主播自己的承诺；先说明语境，再给更简洁的表达建议。',
      '不得断言引用或复述风险词一定触发平台审核、限流或处罚。',
      '完成查证后必须调用 submit_report_answer 提交最终答案，不得直接在最终消息中回答。',
      'segmentIds、findingIds 和 frameworkStages 只能使用工具返回的真实ID或阶段名。',
      `报告身份：${JSON.stringify({
        id: report.id,
        title: report.title,
        frameworkName: report.frameworkName,
        durationSeconds: report.durationSeconds,
      })}`,
    ].join('\n');
  }

  private sanitizeAnswer(answer: string): string {
    return answer
      .replace(/^\s*```[^\n]*$/gm, '')
      .replace(/^\s*```\s*$/gm, '')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*-{3,}\s*$/gm, '')
      .replace(/^\s*[-*]\s+/gm, '')
      .replace(/\*\*/g, '')
      .replace(
        /平台(?:抓到|识别到)?(?:就)?(?:可以|会)?直接(?:限流|中断直播|封禁|处罚)(?:或(?:限流|中断直播|封禁|处罚))*[。.]?/g,
        '存在被平台判定为违规的风险。',
      )
      .replace(/很容易被判定为/g, '可能被理解为')
      .replace(/直播间最怕碰的红线/g, '需要优先修改的高风险表达')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private searchTranscript(
    segments: TranscriptSegmentSummary[],
    query: string,
    limit: number,
  ): TranscriptSegmentSummary[] {
    const terms: string[] = this.getSearchTerms(query);
    const scored = segments
      .map((segment: TranscriptSegmentSummary) => ({
        segment,
        score: this.scoreText(`${segment.text} ${segment.matchedStage}`, terms),
      }))
      .filter((item): boolean => item.score > 0)
      .sort((left, right): number =>
        right.score === left.score
          ? left.segment.startSeconds - right.segment.startSeconds
          : right.score - left.score,
      );
    const matches: TranscriptSegmentSummary[] = scored
      .slice(0, limit)
      .map((item): TranscriptSegmentSummary => item.segment);
    return matches.length > 0 ? matches : segments.slice(0, limit);
  }

  private searchFindings(
    findings: ScriptFinding[],
    query: string | undefined,
    riskLevel: ScriptFinding['riskLevel'] | undefined,
    limit: number,
  ): ScriptFinding[] {
    const terms: string[] = this.getSearchTerms(query || '');
    const severityRank: Record<ScriptFinding['riskLevel'], number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };
    return findings
      .filter((finding: ScriptFinding): boolean =>
        riskLevel ? finding.riskLevel === riskLevel : true,
      )
      .map((finding: ScriptFinding) => ({
        finding,
        score:
          this.scoreText(
            [
              finding.originalText,
              finding.matchedRule,
              finding.analysis,
              finding.suggestion,
            ].join(' '),
            terms,
          ) + severityRank[finding.riskLevel],
      }))
      .filter(
        (item): boolean =>
          terms.length === 0 ||
          item.score > severityRank[item.finding.riskLevel],
      )
      .sort((left, right): number => right.score - left.score)
      .slice(0, limit)
      .map((item): ScriptFinding => item.finding);
  }

  private searchFrameworkMatches(
    matches: FrameworkMatchSummary[],
    query?: string,
  ): FrameworkMatchSummary[] {
    const terms: string[] = this.getSearchTerms(query || '');
    if (terms.length === 0) {
      return matches;
    }
    const filtered: FrameworkMatchSummary[] = matches.filter(
      (match: FrameworkMatchSummary): boolean =>
        this.scoreText(
          [
            match.stageName,
            match.expectedWindow || '',
            match.evidence,
            match.suggestion,
          ].join(' '),
          terms,
        ) > 0,
    );
    return filtered.length > 0 ? filtered : matches;
  }

  private findSegmentAt(
    segments: TranscriptSegmentSummary[],
    startSeconds: number,
  ): TranscriptSegmentSummary | undefined {
    return (
      segments.find(
        (segment: TranscriptSegmentSummary): boolean =>
          segment.startSeconds === startSeconds,
      ) ||
      segments.find(
        (segment: TranscriptSegmentSummary): boolean =>
          segment.startSeconds <= startSeconds &&
          segment.endSeconds > startSeconds,
      ) ||
      [...segments].sort(
        (left: TranscriptSegmentSummary, right: TranscriptSegmentSummary) =>
          Math.abs(left.startSeconds - startSeconds) -
          Math.abs(right.startSeconds - startSeconds),
      )[0]
    );
  }

  private getSearchTerms(query: string): string[] {
    const normalized: string = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }
    const terms: string[] = normalized
      .split(/[，。！？、,.!?：:\s]+/)
      .map((term: string): string => term.trim())
      .filter((term: string): boolean => term.length >= 2);
    const cjkBigrams: string[] = terms.flatMap((term: string): string[] => {
      if (!/^[\u3400-\u9fff]+$/.test(term) || term.length < 4) {
        return [];
      }
      return Array.from(
        { length: term.length - 1 },
        (_value: unknown, index: number): string =>
          term.slice(index, index + 2),
      );
    });
    const intentTerms: string[] = [];
    const intentMap: Array<{ pattern: RegExp; terms: string[] }> = [
      { pattern: /违规|风险|违禁/, terms: ['保证', '承诺', '绝对', '赚钱'] },
      { pattern: /案例|人设/, terms: ['案例', '宝妈', '老板', '结果'] },
      { pattern: /成交|逼单/, terms: ['成交', '名额', '价格', '下单'] },
      { pattern: /课程|权益/, terms: ['课程', '权益', '交付', '服务'] },
      { pattern: /节奏|框架/, terms: ['干货', '课程', '案例', '成交'] },
    ];
    for (const intent of intentMap) {
      if (intent.pattern.test(normalized)) {
        intentTerms.push(...intent.terms);
      }
    }
    return [...new Set([...terms, ...cjkBigrams, ...intentTerms])].slice(0, 16);
  }

  private scoreText(text: string, terms: string[]): number {
    const normalized: string = text.toLowerCase();
    return terms.reduce(
      (score: number, term: string): number =>
        score + (normalized.includes(term) ? Math.max(1, term.length) : 0),
      0,
    );
  }

  private formatSeconds(totalSeconds: number): string {
    const seconds: number = Math.max(0, Math.floor(totalSeconds));
    const minutes: number = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
}
