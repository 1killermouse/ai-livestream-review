import { Injectable, Logger } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';

import type {
  AgentConfidence,
  FrameworkMatchSummary,
  RagReferenceSummary,
  RhythmTimingIssue,
  TranscriptSegmentSummary,
} from '@shared/api.interface';

import { DeepSeekAnalysisService } from './deepseek-analysis.service';

interface RhythmAnalysisOptions {
  transcriptSegments: TranscriptSegmentSummary[];
  frameworkName: string;
  customFramework?: string;
  baselineMatches: FrameworkMatchSummary[];
  ragReferences: RagReferenceSummary[];
}

interface SubmittedRhythmDiagnosis {
  stageName: string;
  status: FrameworkMatchSummary['status'];
  timingIssue: RhythmTimingIssue;
  evidenceSegmentIds: string[];
  diagnosis: string;
  suggestion: string;
  confidence: AgentConfidence;
}

interface RhythmSubmissionRef {
  value?: SubmittedRhythmDiagnosis[];
}

interface RhythmEvidenceContext {
  segmentIds: Set<string>;
  stageNames: Set<string>;
}

export interface RhythmAgentResult {
  frameworkMatches: FrameworkMatchSummary[];
  statusText: string;
  usedAgent: boolean;
}

@Injectable()
export class RhythmAnalysisAgentService {
  private readonly logger = new Logger(RhythmAnalysisAgentService.name);

  constructor(
    private readonly deepSeekAnalysisService: DeepSeekAnalysisService,
  ) {}

  async analyze(options: RhythmAnalysisOptions): Promise<RhythmAgentResult> {
    const fallbackMatches: FrameworkMatchSummary[] = this.enrichBaseline(
      options.baselineMatches,
      options.transcriptSegments,
    );
    if (
      !this.deepSeekAnalysisService.isConfigured() ||
      options.transcriptSegments.length === 0 ||
      options.baselineMatches.length === 0
    ) {
      return {
        frameworkMatches: fallbackMatches,
        statusText: '使用时间戳与框架规则完成节奏诊断',
        usedAgent: false,
      };
    }

    const evidenceContext: RhythmEvidenceContext = {
      segmentIds: new Set(),
      stageNames: new Set(),
    };
    const submissionRef: RhythmSubmissionRef = {};
    const agent = createReactAgent({
      llm: this.deepSeekAnalysisService.createToolCallingModel(),
      tools: this.createTools(options, evidenceContext, submissionRef),
      name: 'livestream_rhythm_react_agent',
      version: 'v2',
      prompt: this.buildPrompt(options),
    });

    try {
      await agent.invoke(
        {
          messages: [
            {
              role: 'user',
              content:
                '请分析这场直播各框架阶段的实际覆盖、先后顺序和时间节奏，并提交结构化诊断。',
            },
          ],
        },
        { recursionLimit: 12 },
      );
      if (!submissionRef.value) {
        await agent.invoke(
          {
            messages: [
              {
                role: 'user',
                content: `必须重新完成工具调用，并以 submit_rhythm_diagnosis 结束。需要提交的阶段只有：${options.baselineMatches
                  .map(
                    (match: FrameworkMatchSummary): string => match.stageName,
                  )
                  .join('、')}。不要直接输出文字答案。`,
              },
            ],
          },
          { recursionLimit: 12 },
        );
      }
      const validated: FrameworkMatchSummary[] | undefined =
        this.validateSubmission(options, evidenceContext, submissionRef.value);
      if (!validated) {
        this.logger.warn(
          `节奏 ReAct 结构化结果未通过校验，使用规则结果：${this.describeValidationState(
            options,
            evidenceContext,
            submissionRef.value,
          )}`,
        );
        return {
          frameworkMatches: fallbackMatches,
          statusText: '节奏 Agent 校验未通过，已使用时间戳规则兜底',
          usedAgent: false,
        };
      }
      return {
        frameworkMatches: validated,
        statusText: `节奏 ReAct Agent 完成 ${validated.length} 个阶段诊断`,
        usedAgent: true,
      };
    } catch (error: unknown) {
      this.logger.warn(
        `节奏 ReAct 调用失败，使用规则结果：${error instanceof Error ? error.message : '未知错误'}`,
      );
      return {
        frameworkMatches: fallbackMatches,
        statusText: '节奏 Agent 调用失败，已使用时间戳规则兜底',
        usedAgent: false,
      };
    }
  }

  private createTools(
    options: RhythmAnalysisOptions,
    evidenceContext: RhythmEvidenceContext,
    submissionRef: RhythmSubmissionRef,
  ) {
    const inspectTimeline = tool(
      () => {
        for (const segment of options.transcriptSegments) {
          evidenceContext.segmentIds.add(segment.id);
        }
        return JSON.stringify(
          this.buildTimelineWindows(options.transcriptSegments),
        );
      },
      {
        name: 'inspect_timeline_windows',
        description:
          '查看按5分钟聚合的直播时间窗、字数密度、已识别环节和逐字稿ID。判断整体节奏时必须调用。',
        schema: z.object({}),
      },
    );

    const inspectFramework = tool(
      () => {
        for (const match of options.baselineMatches) {
          evidenceContext.stageNames.add(match.stageName);
        }
        return JSON.stringify(
          options.baselineMatches.map((match: FrameworkMatchSummary) => ({
            stageName: match.stageName,
            expectedWindow: match.expectedWindow,
            baselineStatus: match.status,
            baselineEvidence: match.evidence,
            baselineSuggestion: match.suggestion,
          })),
        );
      },
      {
        name: 'inspect_framework_stages',
        description:
          '查看当前话术框架的阶段、建议时间窗和规则初判。每次节奏诊断都必须调用。',
        schema: z.object({}),
      },
    );

    const searchStageEvidence = tool(
      ({ query, limit }) => {
        const segments: TranscriptSegmentSummary[] = this.searchSegments(
          options.transcriptSegments,
          query,
          limit,
        );
        for (const segment of segments) {
          evidenceContext.segmentIds.add(segment.id);
        }
        return JSON.stringify(
          segments.map((segment: TranscriptSegmentSummary) => ({
            segmentId: segment.id,
            startSeconds: segment.startSeconds,
            endSeconds: segment.endSeconds,
            timeLabel: this.formatSeconds(segment.startSeconds),
            matchedStage: segment.matchedStage,
            text: segment.text.slice(0, 1000),
          })),
        );
      },
      {
        name: 'search_stage_evidence',
        description:
          '按课程、干货、案例、成交或具体关键词查找带时间戳的逐字稿证据。',
        schema: z.object({
          query: z.string().min(1),
          limit: z.number().int().min(1).max(10).default(6),
        }),
      },
    );

    const inspectKnowledge = tool(
      () =>
        JSON.stringify(
          options.ragReferences
            .filter(
              (reference: RagReferenceSummary): boolean =>
                reference.type === 'framework',
            )
            .slice(0, 6),
        ),
      {
        name: 'inspect_rhythm_knowledge',
        description: '查看RAG召回的话术阶段与节奏标准。',
        schema: z.object({}),
      },
    );

    const submitDiagnosis = tool(
      ({ diagnoses }) => {
        submissionRef.value = diagnoses.map((diagnosis) => ({
          ...diagnosis,
          stageName: diagnosis.stageName.trim(),
          status: diagnosis.status || 'weak',
          timingIssue: diagnosis.timingIssue || 'unclear',
          evidenceSegmentIds: this.unique(diagnosis.evidenceSegmentIds),
          diagnosis: diagnosis.diagnosis.trim(),
          suggestion: diagnosis.suggestion.trim(),
          confidence: diagnosis.confidence || 'low',
        }));
        return JSON.stringify({ accepted: true, instruction: '诊断已提交，请结束。' });
      },
      {
        name: 'submit_rhythm_diagnosis',
        description:
          '提交全部框架阶段的最终节奏诊断。必须作为最后一个工具调用，阶段名和证据ID必须来自前面的工具。',
        schema: z.object({
          diagnoses: z
            .array(
              z.object({
                stageName: z.string().min(1),
                status: z.enum([
                  'matched',
                  'weak',
                  'missing',
                  'not_applicable',
                ]),
                timingIssue: z.enum([
                  'on_track',
                  'early',
                  'late',
                  'too_long',
                  'too_short',
                  'missing',
                  'not_applicable',
                  'unclear',
                ]),
                evidenceSegmentIds: z.array(z.string()).max(12).default([]),
                diagnosis: z.string().min(1).max(800),
                suggestion: z.string().min(1).max(800),
                confidence: z.enum(['high', 'medium', 'low']),
              }),
            )
            .min(1)
            .max(8),
        }),
      },
    );

    return [
      inspectTimeline,
      inspectFramework,
      searchStageEvidence,
      inspectKnowledge,
      submitDiagnosis,
    ];
  }

  private validateSubmission(
    options: RhythmAnalysisOptions,
    evidenceContext: RhythmEvidenceContext,
    submitted: SubmittedRhythmDiagnosis[] | undefined,
  ): FrameworkMatchSummary[] | undefined {
    if (!submitted || submitted.length !== options.baselineMatches.length) {
      return undefined;
    }
    const segmentById: Map<string, TranscriptSegmentSummary> = new Map(
      options.transcriptSegments.map((segment: TranscriptSegmentSummary) => [
        segment.id,
        segment,
      ]),
    );
    const baselineByStage: Map<string, FrameworkMatchSummary> = new Map(
      options.baselineMatches.map((match: FrameworkMatchSummary) => [
        match.stageName,
        match,
      ]),
    );
    const stageNames: string[] = submitted.map(
      (diagnosis: SubmittedRhythmDiagnosis): string => diagnosis.stageName,
    );
    if (new Set(stageNames).size !== options.baselineMatches.length) {
      return undefined;
    }

    const validated: FrameworkMatchSummary[] = [];
    for (const diagnosis of submitted) {
      const baseline: FrameworkMatchSummary | undefined = baselineByStage.get(
        diagnosis.stageName,
      );
      if (!baseline || !evidenceContext.stageNames.has(diagnosis.stageName)) {
        return undefined;
      }
      const evidenceIds: string[] = this.unique(diagnosis.evidenceSegmentIds);
      if (
        evidenceIds.some(
          (id: string): boolean =>
            !evidenceContext.segmentIds.has(id) || !segmentById.has(id),
        )
      ) {
        return undefined;
      }
      if (
        (diagnosis.status === 'matched' || diagnosis.status === 'weak') &&
        evidenceIds.length === 0
      ) {
        return undefined;
      }
      if (
        baseline.status === 'not_applicable' &&
        diagnosis.status === 'missing' &&
        evidenceIds.length === 0
      ) {
        return undefined;
      }
      const evidenceSegments: TranscriptSegmentSummary[] = evidenceIds
        .map((id: string) => segmentById.get(id))
        .filter(
          (
            segment: TranscriptSegmentSummary | undefined,
          ): segment is TranscriptSegmentSummary => Boolean(segment),
        );
      const actualStartSeconds: number | undefined =
        evidenceSegments.length > 0
          ? Math.min(
              ...evidenceSegments.map(
                (segment: TranscriptSegmentSummary): number =>
                  segment.startSeconds,
              ),
            )
          : undefined;
      const actualEndSeconds: number | undefined =
        evidenceSegments.length > 0
          ? Math.max(
              ...evidenceSegments.map(
                (segment: TranscriptSegmentSummary): number =>
                  segment.endSeconds,
              ),
            )
          : undefined;
      const suggestionIsUnsafe: boolean = this.containsUnsafeRecommendation(
        diagnosis.suggestion,
      );
      validated.push({
        stageName: baseline.stageName,
        status: diagnosis.status,
        expectedWindow: baseline.expectedWindow,
        actualStartSeconds,
        actualEndSeconds,
        evidenceSegmentIds: evidenceIds,
        timingIssue: diagnosis.timingIssue,
        confidence: suggestionIsUnsafe
          ? this.limitConfidence(diagnosis.confidence, 'medium')
          : diagnosis.confidence,
        evidence: this.sanitize(diagnosis.diagnosis),
        suggestion: suggestionIsUnsafe
          ? baseline.suggestion
          : this.sanitize(diagnosis.suggestion),
      });
    }
    return validated;
  }

  private enrichBaseline(
    baselineMatches: FrameworkMatchSummary[],
    segments: TranscriptSegmentSummary[],
  ): FrameworkMatchSummary[] {
    return baselineMatches.map((match: FrameworkMatchSummary) => {
      const evidenceSegments: TranscriptSegmentSummary[] =
        match.status === 'matched' || match.status === 'weak'
          ? this.findBaselineEvidence(match, segments)
          : [];
      const actualStartSeconds: number | undefined = evidenceSegments.length
        ? Math.min(
            ...evidenceSegments.map(
              (segment: TranscriptSegmentSummary): number =>
                segment.startSeconds,
            ),
          )
        : undefined;
      const actualEndSeconds: number | undefined = evidenceSegments.length
        ? Math.max(
            ...evidenceSegments.map(
              (segment: TranscriptSegmentSummary): number => segment.endSeconds,
            ),
          )
        : undefined;
      return {
        ...match,
        actualStartSeconds,
        actualEndSeconds,
        evidenceSegmentIds: evidenceSegments.map(
          (segment: TranscriptSegmentSummary): string => segment.id,
        ),
        timingIssue: this.inferFallbackTimingIssue(match, actualStartSeconds),
        confidence: evidenceSegments.length > 0 ? 'medium' : 'low',
      };
    });
  }

  private buildTimelineWindows(segments: TranscriptSegmentSummary[]) {
    const windows: Map<
      number,
      {
        startSeconds: number;
        endSeconds: number;
        wordCount: number;
        stages: Set<string>;
        segmentIds: string[];
      }
    > = new Map();
    for (const segment of segments) {
      const index: number = Math.floor(segment.startSeconds / 300);
      const current = windows.get(index) || {
        startSeconds: index * 300,
        endSeconds: Math.max((index + 1) * 300, segment.endSeconds),
        wordCount: 0,
        stages: new Set<string>(),
        segmentIds: [],
      };
      current.endSeconds = Math.max(current.endSeconds, segment.endSeconds);
      current.wordCount += segment.wordCount;
      current.stages.add(segment.matchedStage);
      current.segmentIds.push(segment.id);
      windows.set(index, current);
    }
    return [...windows.values()].slice(0, 48).map((window) => ({
      startSeconds: window.startSeconds,
      endSeconds: window.endSeconds,
      timeWindow: `${this.formatSeconds(window.startSeconds)}-${this.formatSeconds(window.endSeconds)}`,
      wordCount: window.wordCount,
      wordsPerMinute: Math.round(
        window.wordCount /
          Math.max(1, (window.endSeconds - window.startSeconds) / 60),
      ),
      stages: [...window.stages],
      segmentIds: window.segmentIds,
    }));
  }

  private searchSegments(
    segments: TranscriptSegmentSummary[],
    query: string,
    limit: number,
  ): TranscriptSegmentSummary[] {
    const terms: string[] = query
      .split(/[，。！？、,.!?：:\s]+/)
      .map((term: string): string => term.trim().toLowerCase())
      .filter((term: string): boolean => term.length > 0);
    const scored = segments
      .map((segment: TranscriptSegmentSummary) => ({
        segment,
        score: terms.reduce(
          (score: number, term: string): number =>
            score +
            (`${segment.matchedStage} ${segment.text}`
              .toLowerCase()
              .includes(term)
              ? 1
              : 0),
          0,
        ),
      }))
      .filter((item): boolean => item.score > 0)
      .sort((left, right): number =>
        right.score === left.score
          ? left.segment.startSeconds - right.segment.startSeconds
          : right.score - left.score,
      )
      .slice(0, limit)
      .map((item): TranscriptSegmentSummary => item.segment);
    return scored.length > 0 ? scored : segments.slice(0, limit);
  }

  private findBaselineEvidence(
    match: FrameworkMatchSummary,
    segments: TranscriptSegmentSummary[],
  ): TranscriptSegmentSummary[] {
    const keyword: string | undefined = match.evidence.match(/关键词“([^”]+)”/)?.[1];
    return segments
      .filter((segment: TranscriptSegmentSummary): boolean => {
        if (keyword && segment.text.includes(keyword)) {
          return true;
        }
        if (/干货/.test(match.stageName)) {
          if (/课程承接|案例人设|成交承接/.test(segment.matchedStage)) {
            return false;
          }
          return /干货|AI|工具|提示词|实操|案例拆解/.test(
            `${segment.matchedStage} ${segment.text}`,
          );
        }
        if (/课程|权益/.test(match.stageName)) {
          return /课程|训练营|权益|价格|交付|陪跑|答疑|作业/.test(
            `${segment.matchedStage} ${segment.text}`,
          );
        }
        if (/案例|人设/.test(match.stageName)) {
          return /案例|学员|宝妈|老板|结果|反馈|人设/.test(
            `${segment.matchedStage} ${segment.text}`,
          );
        }
        if (/成交/.test(match.stageName)) {
          return /成交|下单|报名|链接|名额|活动|权益/.test(
            `${segment.matchedStage} ${segment.text}`,
          );
        }
        return segment.matchedStage.includes(match.stageName);
      })
      .slice(0, 12);
  }

  private inferFallbackTimingIssue(
    match: FrameworkMatchSummary,
    actualStartSeconds: number | undefined,
  ): RhythmTimingIssue {
    if (match.status === 'not_applicable') {
      return 'not_applicable';
    }
    if (match.status === 'missing') {
      return 'missing';
    }
    if (actualStartSeconds === undefined) {
      return 'unclear';
    }
    const expectedStart: number | undefined = this.getExpectedStartSeconds(
      match.expectedWindow,
    );
    if (expectedStart === undefined || expectedStart === 0) {
      return match.status === 'weak' ? 'too_short' : 'on_track';
    }
    if (actualStartSeconds < expectedStart - 300) {
      return 'early';
    }
    if (actualStartSeconds > expectedStart + 300) {
      return 'late';
    }
    return match.status === 'weak' ? 'too_short' : 'on_track';
  }

  private getExpectedStartSeconds(expectedWindow?: string): number | undefined {
    if (!expectedWindow) {
      return undefined;
    }
    if (/前\s*\d+\s*分钟/.test(expectedWindow)) {
      return 0;
    }
    const match: RegExpMatchArray | null = expectedWindow.match(/(\d+)\s*(?:[-~—至]|分钟后)/);
    return match ? Number(match[1]) * 60 : undefined;
  }

  private buildPrompt(options: RhythmAnalysisOptions): string {
    return [
      '你是AI知识付费直播节奏诊断Agent，必须使用ReAct方式先查证再提交结果。',
      '先调用 inspect_framework_stages 和 inspect_timeline_windows；需要判断具体阶段时调用 search_stage_evidence。',
      '必须根据ASR真实时间戳判断时间，不得用文字数量代替直播时长；字数只用于判断信息密度。',
      '短录屏尚未进入后续时间窗时必须标记 not_applicable，不得强判 missing。',
      '每个 matched 或 weak 阶段必须提供真实 evidenceSegmentIds。',
      '诊断要指出阶段是否提前、偏晚、过短、过长、缺失或基本合理，并给主播能执行的调整建议。',
      '不得编造字数密度基准、学员结果、涨粉收益、限时优惠或倒计时；建议只能来自本场证据、框架和RAG依据。',
      '最后必须调用 submit_rhythm_diagnosis，一次提交全部阶段；不得直接输出最终文本。',
      `框架名称：${options.frameworkName}`,
      options.customFramework
        ? `用户自定义框架：${options.customFramework.slice(0, 4000)}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private describeValidationState(
    options: RhythmAnalysisOptions,
    evidenceContext: RhythmEvidenceContext,
    submitted: SubmittedRhythmDiagnosis[] | undefined,
  ): string {
    return JSON.stringify({
      expectedStages: options.baselineMatches.map(
        (match: FrameworkMatchSummary): string => match.stageName,
      ),
      observedStages: [...evidenceContext.stageNames],
      observedSegmentCount: evidenceContext.segmentIds.size,
      submitted:
        submitted?.map((diagnosis: SubmittedRhythmDiagnosis) => ({
          stageName: diagnosis.stageName,
          status: diagnosis.status,
          evidenceSegmentIds: diagnosis.evidenceSegmentIds,
        })) || null,
    });
  }

  private containsUnsafeRecommendation(text: string): boolean {
    const normalized: string = text.replace(/\s+/g, '');
    return [
      /(?:保证|包你|一定能|百分百).{0,16}(?:赚钱|变现|回本|涨粉|成交|结果)/,
      /(?:一键|\d+分钟).{0,16}(?:爆款|赚钱|变现|出单)/,
      /(?:三天|七天|一周|一个月|上期学员).{0,20}(?:涨粉|赚钱|变现|回本|接单)/,
      /(?:限时优惠|倒计时|最后名额|制造.{0,8}紧迫)/,
      /信息密度.{0,20}(?:提升|达到|控制).{0,8}\d+字\/分/,
      /\d+(?:-\d+)?(?:字\/分钟|字\/分)/,
    ].some((pattern: RegExp): boolean => pattern.test(normalized));
  }

  private limitConfidence(
    requested: AgentConfidence,
    maximum: AgentConfidence,
  ): AgentConfidence {
    const rank: Record<AgentConfidence, number> = {
      low: 1,
      medium: 2,
      high: 3,
    };
    return rank[requested] <= rank[maximum] ? requested : maximum;
  }

  private sanitize(text: string): string {
    return text
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
