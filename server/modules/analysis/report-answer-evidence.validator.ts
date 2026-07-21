import { Injectable } from '@nestjs/common';

import type {
  FrameworkMatchSummary,
  PrototypeAnalysisReport,
  ReportAnswerConfidence,
  ScriptFinding,
  TranscriptSegmentSummary,
} from '@shared/api.interface';

import type { ReportQuestionIntent } from './report-question-intent.router';

export interface SubmittedReportAnswer {
  answer: string;
  segmentIds: string[];
  findingIds: string[];
  frameworkStages: string[];
  confidence: ReportAnswerConfidence;
}

export interface ObservedReportEvidence {
  segmentIds: Set<string>;
  findingIds: Set<string>;
  frameworkStages: Set<string>;
  overviewUsed: boolean;
}

export interface EvidenceValidationResult {
  valid: boolean;
  confidence: ReportAnswerConfidence;
  citationCount: number;
  relatedSegments: TranscriptSegmentSummary[];
  reasons: string[];
}

export function isWarningOrRefutationContext(text: string): boolean {
  const normalized: string = text.replace(/\s+/g, '');
  return [
    /如果(?:有人|别人|商家|老师)?.{0,24}(?:说|告诉|承诺|保证).{0,100}(?:谨慎|警惕|不要信|别信|不可信|不靠谱)/,
    /(?:不能|无法|不可能|不会).{0,12}(?:保证|承诺).{0,40}(?:赚钱|收益|结果|变现)/,
    /(?:不代表|并不代表).{0,50}(?:都能|一定|结果|收益|赚钱|变现)/,
    /(?:反例|错误说法|不建议这样说|不要这样说)/,
  ].some((pattern: RegExp): boolean => pattern.test(normalized));
}

@Injectable()
export class ReportAnswerEvidenceValidator {
  validate(options: {
    report: PrototypeAnalysisReport;
    question: string;
    intent?: ReportQuestionIntent;
    submission: SubmittedReportAnswer;
    observed: ObservedReportEvidence;
  }): EvidenceValidationResult {
    const reasons: string[] = [];
    const segmentIds: string[] = this.unique(options.submission.segmentIds);
    const findingIds: string[] = this.unique(options.submission.findingIds);
    const frameworkStages: string[] = this.unique(
      options.submission.frameworkStages,
    );
    const segmentById: Map<string, TranscriptSegmentSummary> = new Map(
      options.report.transcriptSegments.map(
        (segment: TranscriptSegmentSummary) => [segment.id, segment],
      ),
    );
    const findingById: Map<string, ScriptFinding> = new Map(
      options.report.findings.map((finding: ScriptFinding) => [
        finding.id,
        finding,
      ]),
    );
    const frameworkByStage: Map<string, FrameworkMatchSummary> = new Map(
      options.report.frameworkMatches.map((match: FrameworkMatchSummary) => [
        match.stageName,
        match,
      ]),
    );

    const segments: TranscriptSegmentSummary[] = segmentIds
      .map((id: string) => segmentById.get(id))
      .filter(
        (
          segment: TranscriptSegmentSummary | undefined,
        ): segment is TranscriptSegmentSummary => Boolean(segment),
      );
    const findings: ScriptFinding[] = findingIds
      .map((id: string) => findingById.get(id))
      .filter((finding: ScriptFinding | undefined): finding is ScriptFinding =>
        Boolean(finding),
      );
    const frameworks: FrameworkMatchSummary[] = frameworkStages
      .map((stageName: string) => frameworkByStage.get(stageName))
      .filter(
        (
          match: FrameworkMatchSummary | undefined,
        ): match is FrameworkMatchSummary => Boolean(match),
      );

    this.checkSubmittedIds(
      segmentIds,
      segmentById,
      options.observed.segmentIds,
      '逐字稿',
      reasons,
    );
    this.checkSubmittedIds(
      findingIds,
      findingById,
      options.observed.findingIds,
      '风险项',
      reasons,
    );
    this.checkSubmittedIds(
      frameworkStages,
      frameworkByStage,
      options.observed.frameworkStages,
      '框架阶段',
      reasons,
    );

    const hasDetailedEvidence: boolean =
      segments.length > 0 || findings.length > 0;
    const hasReportEvidence: boolean =
      hasDetailedEvidence ||
      frameworks.length > 0 ||
      options.observed.overviewUsed;
    if (!hasReportEvidence) {
      reasons.push('答案没有引用本场报告依据');
    }

    const asksForDetailedEvidence: boolean = options.intent
      ? ['risk_locate', 'risk_explain', 'rewrite'].includes(options.intent)
      : /原话|哪句|时间|几分钟|风险|违规|违禁|承诺|夸大|赚钱|逼单|怎么改|改写|重写|替换/.test(
          options.question,
        );
    if (asksForDetailedEvidence && !hasDetailedEvidence) {
      reasons.push('具体问题缺少原话或风险项依据');
    }

    if (
      options.intent &&
      ['risk_locate', 'risk_explain', 'rewrite'].includes(options.intent) &&
      findings.length === 0
    ) {
      reasons.push('当前意图缺少经过查证的风险项依据');
    }

    const asksForFramework: boolean = options.intent
      ? options.intent === 'rhythm'
      : /节奏|框架|环节|干货|课程承接|成交环节/.test(options.question);
    if (
      asksForFramework &&
      frameworks.length === 0 &&
      (options.intent === 'rhythm' || !hasDetailedEvidence)
    ) {
      reasons.push('节奏问题缺少框架阶段依据');
    }

    const relatedSegments: TranscriptSegmentSummary[] =
      this.resolveRelatedSegments(
        options.report.transcriptSegments,
        segments,
        findings,
      );
    this.validateTimeLabels(
      options.submission.answer,
      relatedSegments,
      findings,
      reasons,
    );
    this.validateClaimedOriginalText(
      options.submission.answer,
      relatedSegments,
      findings,
      reasons,
    );
    this.validateRiskSpeechContext(
      options.submission.answer,
      relatedSegments,
      reasons,
    );

    const citationCount: number =
      segments.length + findings.length + frameworks.length;
    const confidence: ReportAnswerConfidence =
      reasons.length > 0
        ? 'low'
        : this.limitConfidence(
            options.submission.confidence,
            hasDetailedEvidence ? 'high' : 'medium',
          );

    return {
      valid: reasons.length === 0,
      confidence,
      citationCount:
        citationCount > 0
          ? citationCount
          : options.observed.overviewUsed
            ? 1
            : 0,
      relatedSegments,
      reasons,
    };
  }

  private checkSubmittedIds<T>(
    ids: string[],
    reportItems: Map<string, T>,
    observedIds: Set<string>,
    label: string,
    reasons: string[],
  ): void {
    for (const id of ids) {
      if (!reportItems.has(id)) {
        reasons.push(`${label} ${id} 不存在`);
      } else if (!observedIds.has(id)) {
        reasons.push(`${label} ${id} 未经工具查证`);
      }
    }
  }

  private resolveRelatedSegments(
    allSegments: TranscriptSegmentSummary[],
    submittedSegments: TranscriptSegmentSummary[],
    findings: ScriptFinding[],
  ): TranscriptSegmentSummary[] {
    const resolved: Map<string, TranscriptSegmentSummary> = new Map(
      submittedSegments.map((segment: TranscriptSegmentSummary) => [
        segment.id,
        segment,
      ]),
    );
    for (const finding of findings) {
      const segment: TranscriptSegmentSummary | undefined =
        allSegments.find(
          (candidate: TranscriptSegmentSummary): boolean =>
            candidate.startSeconds === finding.startSeconds,
        ) ||
        allSegments.find(
          (candidate: TranscriptSegmentSummary): boolean =>
            candidate.startSeconds <= finding.startSeconds &&
            candidate.endSeconds > finding.startSeconds,
        );
      if (segment) {
        resolved.set(segment.id, segment);
      }
    }
    return [...resolved.values()].slice(0, 8);
  }

  private validateTimeLabels(
    answer: string,
    segments: TranscriptSegmentSummary[],
    findings: ScriptFinding[],
    reasons: string[],
  ): void {
    const timeLabels: number[] = [
      ...answer.matchAll(/(^|[^\d])(\d{1,3}):([0-5]\d)(?!\d)/g),
    ].map(
      (match: RegExpMatchArray): number =>
        Number(match[2]) * 60 + Number(match[3]),
    );
    for (const timeSeconds of timeLabels) {
      const supported: boolean =
        segments.some(
          (segment: TranscriptSegmentSummary): boolean =>
            timeSeconds >= segment.startSeconds - 1 &&
            timeSeconds <= segment.endSeconds + 1,
        ) ||
        findings.some(
          (finding: ScriptFinding): boolean =>
            Math.abs(finding.startSeconds - timeSeconds) <= 2,
        );
      if (!supported) {
        reasons.push(`时间点 ${this.formatSeconds(timeSeconds)} 没有对应证据`);
      }
    }
  }

  private validateClaimedOriginalText(
    answer: string,
    segments: TranscriptSegmentSummary[],
    findings: ScriptFinding[],
    reasons: string[],
  ): void {
    const claimedOriginals: string[] = [];
    const patterns: RegExp[] = [
      /原话(?:是|为)?[：:\s]*[“"「]([^”"」\n]{2,})[”"」]/g,
      /这句[：:\s]*[“"「]([^”"」\n]{2,})[”"」]/g,
    ];
    for (const pattern of patterns) {
      for (const match of answer.matchAll(pattern)) {
        claimedOriginals.push(match[1]);
      }
    }
    const sourceTexts: string[] = [
      ...segments.map(
        (segment: TranscriptSegmentSummary): string => segment.text,
      ),
      ...findings.map((finding: ScriptFinding): string => finding.originalText),
    ].map((text: string): string => this.normalizeEvidenceText(text));

    for (const original of this.unique(claimedOriginals)) {
      const normalizedOriginal: string = this.normalizeEvidenceText(original);
      if (
        normalizedOriginal.length >= 4 &&
        !sourceTexts.some((source: string): boolean =>
          source.includes(normalizedOriginal),
        )
      ) {
        reasons.push(`引用的原话“${original}”与逐字稿不一致`);
      }
    }
  }

  private validateRiskSpeechContext(
    answer: string,
    segments: TranscriptSegmentSummary[],
    reasons: string[],
  ): void {
    if (
      !segments.some((segment: TranscriptSegmentSummary): boolean =>
        isWarningOrRefutationContext(segment.text),
      )
    ) {
      return;
    }

    const contextFramingIndex: number = answer.search(
      /(?:这段|这里|原文|主播).{0,18}(?:提醒|警惕|反例|否定|引用)|不是主播(?:自己)?(?:在)?(?:承诺|保证)/,
    );
    const directRiskClaimIndex: number = answer.search(
      /(?:这是|属于|构成)(?:个|一项|高风险)?(?:收益|结果)?承诺(?:风险)?|主播.{0,10}(?:承诺|保证)|把.{0,30}(?:说成|包装成)(?:了)?确定/,
    );
    if (
      directRiskClaimIndex >= 0 &&
      (contextFramingIndex < 0 || contextFramingIndex > directRiskClaimIndex)
    ) {
      reasons.push('引用或否定语境被误写成主播自己的承诺');
    }

    if (
      /(?:复述|引用).{0,24}(?:一定|必然|会)(?:触发|导致).{0,12}(?:审核|处罚|限流|封禁)/.test(
        answer,
      )
    ) {
      reasons.push('不能断言复述风险词一定触发平台审核或处罚');
    }
  }

  private limitConfidence(
    requested: ReportAnswerConfidence,
    maximum: ReportAnswerConfidence,
  ): ReportAnswerConfidence {
    const rank: Record<ReportAnswerConfidence, number> = {
      low: 1,
      medium: 2,
      high: 3,
    };
    return rank[requested] <= rank[maximum] ? requested : maximum;
  }

  private normalizeEvidenceText(text: string): string {
    return text
      .replace(/\s+/g, '')
      .replace(/[，。！？、,.!?：:“”「」"'‘’]/g, '')
      .toLowerCase();
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
