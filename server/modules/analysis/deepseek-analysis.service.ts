import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import axios, { type AxiosResponse } from 'axios';

import type {
  FrameworkMatchSummary,
  PrototypeAnalysisReport,
  RagReferenceSummary,
  ReportChatMessage,
  ScriptFinding,
  TranscriptSegmentSummary,
} from '@shared/api.interface';

interface DeepSeekChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface DeepSeekFinding {
  type?: ScriptFinding['type'];
  riskLevel?: ScriptFinding['riskLevel'];
  startSeconds?: number;
  originalText?: string;
  matchedRule?: string;
  analysis?: string;
  suggestion?: string;
  replacementScript?: string;
}

interface DeepSeekAnalysisJson {
  findings?: DeepSeekFinding[];
}

@Injectable()
export class DeepSeekAnalysisService {
  isConfigured(): boolean {
    return Boolean(process.env.DEEPSEEK_API_KEY);
  }

  getModelName(): string {
    return process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  }

  createToolCallingModel(): ChatOpenAI {
    const apiKey: string | undefined = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('DeepSeek API Key 未配置');
    }

    return new ChatOpenAI({
      apiKey,
      model: this.getModelName(),
      temperature: 0.2,
      maxTokens: 1400,
      maxRetries: 1,
      timeout: 45000,
      useResponsesApi: false,
      configuration: {
        baseURL: this.getBaseUrl(),
      },
    });
  }

  async analyzeTranscript(options: {
    transcriptSegments: TranscriptSegmentSummary[];
    frameworkName: string;
    customFramework?: string;
    frameworkMatches: FrameworkMatchSummary[];
    ragReferences: RagReferenceSummary[];
  }): Promise<ScriptFinding[]> {
    if (!this.isConfigured()) {
      return [];
    }

    const response: AxiosResponse<DeepSeekChatResponse> =
      await axios.post<DeepSeekChatResponse>(
        `${this.getBaseUrl()}/chat/completions`,
        {
          model: this.getModelName(),
          messages: [
            {
              role: 'system',
              content:
                '你是一个AI知识付费直播话术合规与转化诊断专家。你只输出JSON，不输出Markdown。你需要识别收益承诺、AI工具能力夸大、虚假案例、焦虑成交、过度逼单、站外导流，以及话术框架缺口。',
            },
            {
              role: 'user',
              content: this.buildPrompt(options),
            },
          ],
          thinking: { type: 'disabled' },
          response_format: { type: 'json_object' },
          max_tokens: 2000,
          temperature: 0.2,
          stream: false,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 45000,
        },
      );

    const content: string | undefined =
      response.data.choices?.[0]?.message?.content;
    if (!content) {
      return [];
    }

    return this.parseFindings(content);
  }

  async answerReportQuestion(options: {
    report: PrototypeAnalysisReport;
    question: string;
    messages: ReportChatMessage[];
    relatedSegments: TranscriptSegmentSummary[];
  }): Promise<string> {
    if (!this.isConfigured()) {
      return '当前问答模型还没有配置好。你可以先查看报告里的时间轴、风险点和推荐话术。';
    }

    const response: AxiosResponse<DeepSeekChatResponse> =
      await axios.post<DeepSeekChatResponse>(
        `${this.getBaseUrl()}/chat/completions`,
        {
          model: this.getModelName(),
          messages: [
            {
              role: 'system',
              content:
                '你是一个AI知识付费直播复盘顾问，只能围绕用户提供的本场直播报告回答。回答要用主播听得懂的大白话，尽量引用时间点、原话、风险点和可直接替换的话术。不要输出Markdown符号，不要用星号加粗，不要编造报告里没有的信息；如果报告里没有依据，就直接说明“这场报告里暂时看不到”。',
            },
            ...options.messages.slice(-6).map((message) => ({
              role: message.role,
              content: message.content,
            })),
            {
              role: 'user',
              content: this.buildReportChatPrompt(options),
            },
          ],
          thinking: { type: 'disabled' },
          max_tokens: 1400,
          temperature: 0.35,
          stream: false,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 45000,
        },
      );

    return (
      response.data.choices?.[0]?.message?.content?.trim() ||
      '这场报告里暂时没有足够信息回答这个问题。'
    );
  }

  private buildPrompt(options: {
    transcriptSegments: TranscriptSegmentSummary[];
    frameworkName: string;
    customFramework?: string;
    frameworkMatches: FrameworkMatchSummary[];
    ragReferences: RagReferenceSummary[];
  }): string {
    return JSON.stringify(
      {
        instruction:
          '请根据transcriptSegments、frameworkMatches、ragReferences判断违禁词、语义风险和话术框架缺口。必须返回json对象：{"findings":[{"type":"banned_word|semantic_risk|framework_gap","riskLevel":"high|medium|low|critical","startSeconds":数字,"originalText":"原话或缺口描述","matchedRule":"规则名或框架环节","analysis":"为什么风险","suggestion":"怎么改","replacementScript":"主播可直接替换的话术"}]}。最多返回6条，低置信度不要返回。',
        frameworkName: options.frameworkName,
        customFramework: options.customFramework,
        transcriptSegments: options.transcriptSegments,
        frameworkMatches: options.frameworkMatches,
        ragReferences: options.ragReferences,
      },
      null,
      2,
    );
  }

  private buildReportChatPrompt(options: {
    report: PrototypeAnalysisReport;
    question: string;
    relatedSegments: TranscriptSegmentSummary[];
  }): string {
    return JSON.stringify(
      {
        instruction:
          '请回答主播对本场直播的追问。优先使用relatedSegments、findings、frameworkMatches；回答结构建议：直接结论、对应时间点/原话、怎么改。不要输出Markdown符号。',
        question: options.question,
        reportSummary: {
          title: options.report.title,
          durationSeconds: options.report.durationSeconds,
          transcriptWordCount: options.report.transcriptWordCount,
          frameworkName: options.report.frameworkName,
          overallDiagnosis: options.report.summary.overallDiagnosis,
        },
        relatedSegments: options.relatedSegments,
        findings: options.report.findings.slice(0, 12),
        frameworkMatches: options.report.frameworkMatches,
        ragReferences: options.report.ragReferences.slice(0, 8),
        transcriptContext: this.buildTranscriptContext(
          options.report.transcriptSegments,
        ),
      },
      null,
      2,
    );
  }

  private buildTranscriptContext(
    transcriptSegments: TranscriptSegmentSummary[],
  ): Array<
    Pick<
      TranscriptSegmentSummary,
      'startSeconds' | 'endSeconds' | 'text' | 'matchedStage'
    >
  > {
    const context: Array<
      Pick<
        TranscriptSegmentSummary,
        'startSeconds' | 'endSeconds' | 'text' | 'matchedStage'
      >
    > = [];
    let charCount = 0;

    for (const segment of transcriptSegments) {
      const nextCharCount: number = charCount + segment.text.length;
      if (nextCharCount > 9000) {
        break;
      }
      context.push({
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        text: segment.text,
        matchedStage: segment.matchedStage,
      });
      charCount = nextCharCount;
    }

    return context;
  }

  private parseFindings(content: string): ScriptFinding[] {
    try {
      const parsed: DeepSeekAnalysisJson = JSON.parse(content);
      return (parsed.findings || [])
        .filter((finding: DeepSeekFinding): boolean =>
          Boolean(finding.originalText?.trim() && finding.matchedRule?.trim()),
        )
        .slice(0, 6)
        .map(
          (finding: DeepSeekFinding, index: number): ScriptFinding => ({
            id: `deepseek-finding-${index + 1}`,
            type: this.normalizeFindingType(finding.type),
            riskLevel: this.normalizeRiskLevel(finding.riskLevel),
            startSeconds: Math.max(0, Math.floor(finding.startSeconds || 0)),
            originalText: finding.originalText?.trim() || '',
            matchedRule: `DeepSeek 语义判断：${finding.matchedRule?.trim() || '语义风险'}`,
            analysis:
              finding.analysis?.trim() || 'DeepSeek 判断该表达存在潜在风险。',
            suggestion:
              finding.suggestion?.trim() ||
              '建议改成条件型、边界清晰、不过度承诺的表达。',
            replacementScript:
              finding.replacementScript?.trim() ||
              '课程会提供方法和练习路径，实际结果会受个人基础、投入时间和执行情况影响。',
          }),
        );
    } catch {
      return [];
    }
  }

  private normalizeFindingType(
    type: DeepSeekFinding['type'],
  ): ScriptFinding['type'] {
    return type === 'banned_word' ||
      type === 'semantic_risk' ||
      type === 'framework_gap'
      ? type
      : 'semantic_risk';
  }

  private normalizeRiskLevel(
    riskLevel: DeepSeekFinding['riskLevel'],
  ): ScriptFinding['riskLevel'] {
    return riskLevel === 'critical' ||
      riskLevel === 'high' ||
      riskLevel === 'medium' ||
      riskLevel === 'low'
      ? riskLevel
      : 'medium';
  }

  private getBaseUrl(): string {
    return (
      process.env.DEEPSEEK_BASE_URL?.replace(/\/$/, '') ||
      'https://api.deepseek.com'
    );
  }
}
