import { Injectable } from '@nestjs/common';
import type { BaseMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';

import type {
  FrameworkMatchSummary,
  PrototypeAnalysisReport,
  RagReferenceSummary,
  ReportChatMessage,
  ReportChatResponse,
  ScriptFinding,
  TranscriptSegmentSummary,
} from '@shared/api.interface';

import { DeepSeekAnalysisService } from './deepseek-analysis.service';
import { RagKnowledgeProvider } from './rag-knowledge.provider';

interface ReportReactAgentOptions {
  report: PrototypeAnalysisReport;
  question: string;
  messages: ReportChatMessage[];
  fallbackSegments: TranscriptSegmentSummary[];
}

@Injectable()
export class ReportReactAgentService {
  constructor(
    private readonly deepSeekAnalysisService: DeepSeekAnalysisService,
    private readonly ragKnowledgeProvider: RagKnowledgeProvider,
  ) {}

  async answer(options: ReportReactAgentOptions): Promise<ReportChatResponse> {
    if (!this.deepSeekAnalysisService.isConfigured()) {
      return this.answerLocally(options);
    }

    const selectedSegments: Map<string, TranscriptSegmentSummary> = new Map();
    const tools = this.createTools(options.report, selectedSegments);
    const agent = createReactAgent({
      llm: this.deepSeekAnalysisService.createToolCallingModel(),
      tools,
      name: 'livestream_report_react_agent',
      version: 'v2',
      prompt: this.buildSystemPrompt(options.report),
    });

    try {
      const result = await agent.invoke(
        {
          messages: [
            ...options.messages.slice(-6).map((message: ReportChatMessage) => ({
              role: message.role,
              content: message.content,
            })),
            { role: 'user', content: options.question },
          ],
        },
        { recursionLimit: 10 },
      );
      const answer: string = this.extractFinalAnswer(result.messages);
      if (!answer) {
        return this.answerWithFallback(options);
      }

      return {
        answer: this.sanitizeAnswer(answer),
        relatedSegments:
          selectedSegments.size > 0
            ? [...selectedSegments.values()].slice(0, 8)
            : options.fallbackSegments,
      };
    } catch {
      return this.answerWithFallback(options);
    }
  }

  private createTools(
    report: PrototypeAnalysisReport,
    selectedSegments: Map<string, TranscriptSegmentSummary>,
  ) {
    const rememberSegments = (segments: TranscriptSegmentSummary[]): void => {
      for (const segment of segments) {
        selectedSegments.set(segment.id, segment);
      }
    };

    const getReportOverview = tool(
      () =>
        JSON.stringify({
          title: report.title,
          durationSeconds: report.durationSeconds,
          transcriptWordCount: report.transcriptWordCount,
          frameworkName: report.frameworkName,
          summary: report.summary,
        }),
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
            riskLevel: finding.riskLevel,
            timeLabel: this.formatSeconds(finding.startSeconds),
            originalText: finding.originalText,
            matchedRule: finding.matchedRule,
            analysis: finding.analysis,
            suggestion: finding.suggestion,
          })),
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

    return [
      getReportOverview,
      searchTranscript,
      inspectRisks,
      inspectFramework,
      inspectRewrites,
      retrieveKnowledge,
    ];
  }

  private async answerWithFallback(
    options: ReportReactAgentOptions,
  ): Promise<ReportChatResponse> {
    try {
      const answer: string =
        await this.deepSeekAnalysisService.answerReportQuestion({
          report: options.report,
          question: options.question,
          messages: options.messages,
          relatedSegments: options.fallbackSegments,
        });
      return {
        answer: this.sanitizeAnswer(answer),
        relatedSegments: options.fallbackSegments,
      };
    } catch {
      return this.answerLocally(options);
    }
  }

  private answerLocally(options: ReportReactAgentOptions): ReportChatResponse {
    return {
      answer: this.buildLocalAnswer(
        options.report,
        options.question,
        options.fallbackSegments,
      ),
      relatedSegments: options.fallbackSegments,
    };
  }

  private buildLocalAnswer(
    report: PrototypeAnalysisReport,
    question: string,
    relatedSegments: TranscriptSegmentSummary[],
  ): string {
    if (/怎么改|改写|重写|替换|话术/.test(question)) {
      const finding: ScriptFinding | undefined = this.searchFindings(
        report.findings,
        question,
        undefined,
        1,
      )[0];
      if (finding) {
        return `${this.formatSeconds(finding.startSeconds)} 这句“${finding.originalText}”建议改成：${finding.replacementScript}`;
      }
    }

    if (/违规|风险|违禁|承诺|夸大|赚钱|逼单/.test(question)) {
      const finding: ScriptFinding | undefined = this.searchFindings(
        report.findings,
        question,
        undefined,
        1,
      )[0];
      if (finding) {
        return `本场最需要先改的是 ${this.formatSeconds(finding.startSeconds)} 的“${finding.originalText}”。${finding.analysis}${finding.suggestion}`;
      }
    }

    if (/节奏|框架|环节|干货|课程|案例|成交/.test(question)) {
      const matches: FrameworkMatchSummary[] = this.searchFrameworkMatches(
        report.frameworkMatches,
        question,
      );
      const match: FrameworkMatchSummary | undefined =
        matches.find(
          (candidate: FrameworkMatchSummary): boolean =>
            candidate.status !== 'matched',
        ) || matches[0];
      if (match) {
        return `${match.stageName}这一环节当前${match.evidence}。下一场建议：${match.suggestion}`;
      }
    }

    const evidence: TranscriptSegmentSummary | undefined = relatedSegments[0];
    return evidence
      ? `${report.summary.overallDiagnosis}可以先回看 ${this.formatSeconds(evidence.startSeconds)} 附近：“${evidence.text}”。`
      : report.summary.overallDiagnosis || '这场报告里暂时看不到。';
  }

  private buildSystemPrompt(report: PrototypeAnalysisReport): string {
    return [
      '你是AI知识付费直播播后复盘顾问，需要用ReAct方式先理解问题、调用工具查证，再给结论。',
      '涉及本场的原话、时间点、风险、节奏或改写时，必须调用对应工具，不能凭常识猜测。',
      '只围绕这场报告回答；报告没有依据时，明确说“这场报告里暂时看不到”。',
      '回答用主播听得懂的大白话，优先给直接结论、对应时间点和能直接开播的改法。',
      '不要暴露思考过程、工具名称或技术架构，不要编造数据，不要使用Markdown符号。',
      '风险结论是本项目的复盘建议，不是平台官方审核结果；不得声称一定会处罚或封禁。',
      `报告身份：${JSON.stringify({
        id: report.id,
        title: report.title,
        frameworkName: report.frameworkName,
        durationSeconds: report.durationSeconds,
      })}`,
    ].join('\n');
  }

  private extractFinalAnswer(messages: BaseMessage[]): string {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message: BaseMessage = messages[index];
      if (message.getType() !== 'ai') {
        continue;
      }
      if (typeof message.content === 'string') {
        return message.content.trim();
      }
      if (Array.isArray(message.content)) {
        return message.content
          .map((block: unknown): string => {
            if (typeof block === 'string') {
              return block;
            }
            if (
              typeof block === 'object' &&
              block !== null &&
              'text' in block &&
              typeof block.text === 'string'
            ) {
              return block.text;
            }
            return '';
          })
          .join('')
          .trim();
      }
    }
    return '';
  }

  private sanitizeAnswer(answer: string): string {
    return answer
      .replace(/^\s*```[^\n]*$/gm, '')
      .replace(/^\s*```\s*$/gm, '')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*-{3,}\s*$/gm, '')
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
          segment.startSeconds <= startSeconds &&
          segment.endSeconds >= startSeconds,
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
