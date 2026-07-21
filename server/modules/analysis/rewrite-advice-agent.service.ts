import { Injectable, Logger } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';

import type {
  AgentConfidence,
  FrameworkMatchSummary,
  RagReferenceSummary,
  ScriptFinding,
  TranscriptSegmentSummary,
} from '@shared/api.interface';

import { DeepSeekAnalysisService } from './deepseek-analysis.service';
import { isWarningOrRefutationContext } from './report-answer-evidence.validator';

interface RewriteAgentOptions {
  transcriptSegments: TranscriptSegmentSummary[];
  findings: ScriptFinding[];
  frameworkMatches: FrameworkMatchSummary[];
  ragReferences: RagReferenceSummary[];
}

interface SubmittedRewrite {
  findingId: string;
  evidenceSegmentIds: string[];
  addressedRhythmStage?: string;
  suggestion: string;
  replacementScript: string;
  confidence: AgentConfidence;
}

interface RewriteSubmission {
  rewrites: SubmittedRewrite[];
  reviewScript: string;
}

interface RewriteSubmissionRef {
  value?: RewriteSubmission;
}

interface RewriteEvidenceContext {
  findingIds: Set<string>;
  segmentIds: Set<string>;
  stageNames: Set<string>;
}

export interface RewriteAgentResult {
  findings: ScriptFinding[];
  reviewScript: string;
  statusText: string;
  usedAgent: boolean;
}

@Injectable()
export class RewriteAdviceAgentService {
  private readonly logger = new Logger(RewriteAdviceAgentService.name);

  constructor(
    private readonly deepSeekAnalysisService: DeepSeekAnalysisService,
  ) {}

  async rewrite(options: RewriteAgentOptions): Promise<RewriteAgentResult> {
    const fallbackReviewScript: string = this.buildLocalReviewScript(options);
    if (!this.deepSeekAnalysisService.isConfigured()) {
      return {
        findings: options.findings,
        reviewScript: fallbackReviewScript,
        statusText: '使用风险规则与节奏结果生成可播改稿',
        usedAgent: false,
      };
    }

    const evidenceContext: RewriteEvidenceContext = {
      findingIds: new Set(),
      segmentIds: new Set(),
      stageNames: new Set(),
    };
    const submissionRef: RewriteSubmissionRef = {};
    const agent = createReactAgent({
      llm: this.deepSeekAnalysisService.createToolCallingModel(),
      tools: this.createTools(options, evidenceContext, submissionRef),
      name: 'livestream_rewrite_react_agent',
      version: 'v2',
      prompt: this.buildPrompt(),
    });

    try {
      await agent.invoke(
        {
          messages: [
            {
              role: 'user',
              content:
                '请结合本场风险原话和节奏缺口，生成逐条替换话术和一段主播下一场可直接使用的复盘改稿。',
            },
          ],
        },
        { recursionLimit: 14 },
      );
      if (!submissionRef.value) {
        await agent.invoke(
          {
            messages: [
              {
                role: 'user',
                content:
                  '必须重新调用风险和节奏工具，并以 submit_rewrite_advice 提交逐条改写和整段复盘改稿。不要直接输出文字答案。',
              },
            ],
          },
          { recursionLimit: 14 },
        );
      }
      const validated: RewriteAgentResult | undefined =
        this.validateSubmission(options, evidenceContext, submissionRef.value);
      if (!validated) {
        this.logger.warn(
          `整改 ReAct 结构化结果未通过校验，使用本地改稿：${this.describeValidationState(
            options,
            evidenceContext,
            submissionRef.value,
          )}`,
        );
        return {
          findings: options.findings,
          reviewScript: fallbackReviewScript,
          statusText: '整改 Agent 校验未通过，已使用规则话术兜底',
          usedAgent: false,
        };
      }
      return validated;
    } catch (error: unknown) {
      this.logger.warn(
        `整改 ReAct 调用失败，使用本地改稿：${error instanceof Error ? error.message : '未知错误'}`,
      );
      return {
        findings: options.findings,
        reviewScript: fallbackReviewScript,
        statusText: '整改 Agent 调用失败，已使用规则话术兜底',
        usedAgent: false,
      };
    }
  }

  private createTools(
    options: RewriteAgentOptions,
    evidenceContext: RewriteEvidenceContext,
    submissionRef: RewriteSubmissionRef,
  ) {
    const inspectFindings = tool(
      () => {
        const findings: ScriptFinding[] = options.findings.slice(0, 10);
        const rows = findings.map((finding: ScriptFinding) => {
          evidenceContext.findingIds.add(finding.id);
          const contextSegment: TranscriptSegmentSummary | undefined =
            this.findSegmentAt(
              options.transcriptSegments,
              finding.startSeconds,
            );
          if (contextSegment) {
            evidenceContext.segmentIds.add(contextSegment.id);
          }
          return {
            findingId: finding.id,
            type: finding.type,
            riskLevel: finding.riskLevel,
            timeLabel: this.formatSeconds(finding.startSeconds),
            originalText: finding.originalText,
            matchedRule: finding.matchedRule,
            analysis: finding.analysis,
            currentSuggestion: finding.suggestion,
            currentReplacement: finding.replacementScript,
            contextSegmentId: contextSegment?.id,
            contextText: contextSegment?.text,
            speechContext:
              contextSegment && isWarningOrRefutationContext(contextSegment.text)
                ? 'warning_or_refutation'
                : 'speaker_claim_or_unclear',
          };
        });
        return JSON.stringify(rows);
      },
      {
        name: 'inspect_risk_findings',
        description:
          '查看已确认的风险点、完整语境、现有兜底改法和证据ID。生成逐条整改前必须调用。',
        schema: z.object({}),
      },
    );

    const inspectRhythm = tool(
      () => {
        for (const match of options.frameworkMatches) {
          evidenceContext.stageNames.add(match.stageName);
          for (const id of match.evidenceSegmentIds || []) {
            evidenceContext.segmentIds.add(id);
          }
        }
        return JSON.stringify(
          options.frameworkMatches.map((match: FrameworkMatchSummary) => ({
            stageName: match.stageName,
            status: match.status,
            expectedWindow: match.expectedWindow,
            actualStartSeconds: match.actualStartSeconds,
            actualEndSeconds: match.actualEndSeconds,
            timingIssue: match.timingIssue,
            diagnosis: match.evidence,
            suggestion: match.suggestion,
            evidenceSegmentIds: match.evidenceSegmentIds || [],
          })),
        );
      },
      {
        name: 'inspect_rhythm_diagnosis',
        description:
          '查看节奏Agent输出的阶段覆盖、实际时间、节奏问题和调整方向。生成整段复盘改稿前必须调用。',
        schema: z.object({}),
      },
    );

    const inspectContext = tool(
      ({ findingId }) => {
        const finding: ScriptFinding | undefined = options.findings.find(
          (candidate: ScriptFinding): boolean => candidate.id === findingId,
        );
        if (!finding) {
          return JSON.stringify({ error: '风险项不存在' });
        }
        evidenceContext.findingIds.add(finding.id);
        const index: number = options.transcriptSegments.findIndex(
          (segment: TranscriptSegmentSummary): boolean =>
            segment.startSeconds === finding.startSeconds ||
            (segment.startSeconds <= finding.startSeconds &&
              segment.endSeconds > finding.startSeconds),
        );
        const segments: TranscriptSegmentSummary[] =
          index >= 0
            ? options.transcriptSegments.slice(
                Math.max(0, index - 1),
                Math.min(options.transcriptSegments.length, index + 2),
              )
            : [];
        for (const segment of segments) {
          evidenceContext.segmentIds.add(segment.id);
        }
        return JSON.stringify(
          segments.map((segment: TranscriptSegmentSummary) => ({
            segmentId: segment.id,
            startSeconds: segment.startSeconds,
            endSeconds: segment.endSeconds,
            text: segment.text,
            matchedStage: segment.matchedStage,
          })),
        );
      },
      {
        name: 'inspect_finding_context',
        description:
          '查看某个风险点前后相邻逐字稿，避免把引用、否定或提醒语境误写成主播承诺。',
        schema: z.object({ findingId: z.string().min(1) }),
      },
    );

    const inspectKnowledge = tool(
      () => JSON.stringify(options.ragReferences.slice(0, 8)),
      {
        name: 'inspect_rewrite_knowledge',
        description:
          '查看RAG召回的合规规则、框架标准、案例边界和改写模板。',
        schema: z.object({}),
      },
    );

    const submitAdvice = tool(
      ({ rewrites, reviewScript }) => {
        submissionRef.value = {
          rewrites: rewrites.map((rewrite) => ({
            ...rewrite,
            findingId: rewrite.findingId.trim(),
            evidenceSegmentIds: this.unique(rewrite.evidenceSegmentIds),
            addressedRhythmStage: rewrite.addressedRhythmStage?.trim(),
            suggestion: rewrite.suggestion.trim(),
            replacementScript: rewrite.replacementScript.trim(),
            confidence: rewrite.confidence || 'low',
          })),
          reviewScript: reviewScript.trim(),
        };
        return JSON.stringify({ accepted: true, instruction: '改稿已提交，请结束。' });
      },
      {
        name: 'submit_rewrite_advice',
        description:
          '提交逐条整改和整段可播改稿。必须作为最后一个工具调用，所有风险ID、阶段名和证据ID必须来自前面的工具。',
        schema: z.object({
          rewrites: z
            .array(
              z.object({
                findingId: z.string().min(1),
                evidenceSegmentIds: z.array(z.string()).min(1).max(8),
                addressedRhythmStage: z.string().optional(),
                suggestion: z.string().min(1).max(600),
                replacementScript: z.string().min(1).max(1200),
                confidence: z.enum(['high', 'medium', 'low']),
              }),
            )
            .max(10),
          reviewScript: z.string().min(1).max(5000),
        }),
      },
    );

    return [
      inspectFindings,
      inspectRhythm,
      inspectContext,
      inspectKnowledge,
      submitAdvice,
    ];
  }

  private validateSubmission(
    options: RewriteAgentOptions,
    evidenceContext: RewriteEvidenceContext,
    submitted: RewriteSubmission | undefined,
  ): RewriteAgentResult | undefined {
    if (!submitted || !submitted.reviewScript.trim()) {
      return undefined;
    }
    if (
      options.findings.length > 0 &&
      (evidenceContext.findingIds.size === 0 || submitted.rewrites.length === 0)
    ) {
      return undefined;
    }
    if (evidenceContext.stageNames.size === 0 && options.frameworkMatches.length) {
      return undefined;
    }
    const findingById: Map<string, ScriptFinding> = new Map(
      options.findings.map((finding: ScriptFinding) => [finding.id, finding]),
    );
    const rewritesById: Map<string, SubmittedRewrite> = new Map();
    for (const rewrite of submitted.rewrites) {
      if (
        rewritesById.has(rewrite.findingId) ||
        !findingById.has(rewrite.findingId) ||
        !evidenceContext.findingIds.has(rewrite.findingId) ||
        rewrite.evidenceSegmentIds.some(
          (id: string): boolean => !evidenceContext.segmentIds.has(id),
        ) ||
        (rewrite.addressedRhythmStage &&
          !evidenceContext.stageNames.has(rewrite.addressedRhythmStage)) ||
        this.containsUnsafePromise(rewrite.replacementScript)
      ) {
        continue;
      }
      rewritesById.set(rewrite.findingId, rewrite);
    }

    const safeModelReviewScript: boolean = !this.containsUnsafePromise(
      submitted.reviewScript,
    );
    if (rewritesById.size === 0 && !safeModelReviewScript) {
      return undefined;
    }

    const findings: ScriptFinding[] = options.findings.map(
      (finding: ScriptFinding): ScriptFinding => {
        const rewrite: SubmittedRewrite | undefined = rewritesById.get(
          finding.id,
        );
        if (!rewrite) {
          return finding;
        }
        return {
          ...finding,
          suggestion: this.sanitize(rewrite.suggestion),
          replacementScript: this.sanitize(rewrite.replacementScript),
          rewriteEvidenceSegmentIds: this.unique(
            rewrite.evidenceSegmentIds,
          ),
          rewriteConfidence: rewrite.confidence,
        };
      },
    );
    const reviewScript: string = safeModelReviewScript
      ? this.sanitize(submitted.reviewScript)
      : this.buildLocalReviewScript({ ...options, findings });
    const fallbackCount: number =
      submitted.rewrites.length - rewritesById.size +
      (safeModelReviewScript ? 0 : 1);
    return {
      findings,
      reviewScript,
      statusText:
        fallbackCount > 0
          ? `整改 ReAct Agent 采纳 ${rewritesById.size} 条安全改写，其余内容已自动兜底`
          : `整改 ReAct Agent 完成 ${rewritesById.size} 条逐句改写和整段复盘话术`,
      usedAgent: true,
    };
  }

  private describeValidationState(
    options: RewriteAgentOptions,
    evidenceContext: RewriteEvidenceContext,
    submitted: RewriteSubmission | undefined,
  ): string {
    return JSON.stringify({
      expectedFindingIds: options.findings.map(
        (finding: ScriptFinding): string => finding.id,
      ),
      observedFindingIds: [...evidenceContext.findingIds],
      observedStages: [...evidenceContext.stageNames],
      observedSegmentCount: evidenceContext.segmentIds.size,
      submitted: submitted
        ? {
            rewrites: submitted.rewrites.map((rewrite: SubmittedRewrite) => ({
              findingId: rewrite.findingId,
              evidenceSegmentIds: rewrite.evidenceSegmentIds,
              addressedRhythmStage: rewrite.addressedRhythmStage,
              unsafe: this.containsUnsafePromise(rewrite.replacementScript),
            })),
            reviewScriptPresent: Boolean(submitted.reviewScript.trim()),
            reviewScriptUnsafe: this.containsUnsafePromise(
              submitted.reviewScript,
            ),
          }
        : null,
    });
  }

  private buildLocalReviewScript(options: RewriteAgentOptions): string {
    const keepStages: string[] = options.frameworkMatches
      .filter(
        (match: FrameworkMatchSummary): boolean => match.status === 'matched',
      )
      .map((match: FrameworkMatchSummary): string => match.stageName)
      .slice(0, 3);
    const gapStages: string[] = options.frameworkMatches
      .filter(
        (match: FrameworkMatchSummary): boolean =>
          match.status === 'missing' || match.status === 'weak',
      )
      .map((match: FrameworkMatchSummary): string => match.stageName)
      .slice(0, 3);
    const replacements: string[] = options.findings
      .slice(0, 3)
      .map(
        (finding: ScriptFinding): string => finding.replacementScript.trim(),
      )
      .filter(Boolean);

    return [
      keepStages.length > 0
        ? `这场可以继续保留：${keepStages.join('、')}。`
        : '这场先保留已经讲清楚的真实方法和交付内容。',
      gapStages.length > 0
        ? `下一场节奏上优先补强：${gapStages.join('、')}。先让用户听懂价值，再自然承接课程、案例和报名。`
        : '主要直播环节已经覆盖，下一场重点让各环节之间的转场更自然。',
      replacements.length > 0
        ? `涉及风险表达时，可以直接换成：${replacements.join(' ')}`
        : '成交时讲清适合人群、交付内容和执行边界，不承诺确定结果。',
    ].join('\n\n');
  }

  private containsUnsafePromise(text: string): boolean {
    const clauses: string[] = text
      .replace(/\s+/g, '')
      .split(/[，。！？；,;\n]|但是|不过|但|却/)
      .filter(Boolean);
    const unsafePatterns: RegExp[] = [
      /(?:保证|包你|包会|一定|百分百|肯定).{0,16}(?:赚钱|变现|回本|接单|涨粉|成交|结果|学会)/,
      /(?:一键|自动|躺着|复制粘贴).{0,16}(?:赚钱|变现|爆款|出单|接单)/,
      /(?:三天|七天|一周|一个月).{0,16}(?:赚钱|变现|回本|接单)/,
    ];
    return clauses.some((clause: string): boolean => {
      if (
        isWarningOrRefutationContext(clause) ||
        /(?:不保证|不承诺|无法保证|不能保证|不会保证|并不代表|不代表).{0,24}(?:赚钱|变现|回本|接单|涨粉|成交|结果|学会|爆款|出单)/.test(
          clause,
        )
      ) {
        return false;
      }
      return unsafePatterns.some((pattern: RegExp): boolean =>
        pattern.test(clause),
      );
    });
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
      )
    );
  }

  private buildPrompt(): string {
    return [
      '你是AI知识付费直播整改话术Agent，必须使用ReAct方式先查本场证据，再生成主播可直接说的话术。',
      '先调用 inspect_risk_findings 和 inspect_rhythm_diagnosis；需要确认语境时调用 inspect_finding_context，需要规则依据时调用 inspect_rewrite_knowledge。',
      '逐句改写必须保留主播原意，但要去掉收益保证、结果保证、案例可复制暗示、工具能力夸大和虚假稀缺。',
      '必须区分主播自己的承诺与引用、否定、提醒语境；如果 speechContext=warning_or_refutation，不能把它写成主播自己的承诺。',
      '整段复盘改稿必须同时吸收风险整改和节奏调整，内容要能直接开播，不要写技术解释。',
      '不得编造价格、收益、人数、案例结果或平台处罚，不得使用Markdown符号。',
      '最后必须调用 submit_rewrite_advice 提交结果，不得直接输出最终文本。',
    ].join('\n');
  }

  private sanitize(text: string): string {
    return text
      .replace(/^\s*```[^\n]*$/gm, '')
      .replace(/^\s*```\s*$/gm, '')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/^\s*[-*]\s+/gm, '')
      .replace(/\*\*/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private unique(values: string[]): string[] {
    return [...new Set(values.map((value: string): string => value.trim()))]
      .filter(Boolean)
      .slice(0, 12);
  }

  private formatSeconds(totalSeconds: number): string {
    const seconds: number = Math.max(0, Math.floor(totalSeconds));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
}
