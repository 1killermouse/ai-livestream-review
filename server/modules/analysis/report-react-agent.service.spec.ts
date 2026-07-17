import { createReactAgent } from '@langchain/langgraph/prebuilt';

import type {
  PrototypeAnalysisReport,
  TranscriptSegmentSummary,
} from '@shared/api.interface';

import { DeepSeekAnalysisService } from './deepseek-analysis.service';
import { RagKnowledgeProvider } from './rag-knowledge.provider';
import { ReportAnswerEvidenceValidator } from './report-answer-evidence.validator';
import { ReportReactAgentService } from './report-react-agent.service';

jest.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: jest.fn(),
}));

const mockCreateReactAgent = createReactAgent as jest.Mock;

describe('ReportReactAgentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses ReAct tools and returns the transcript segments selected by the agent', async () => {
    const deepSeekAnalysisService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createToolCallingModel: jest.fn().mockReturnValue({}),
      answerReportQuestion: jest.fn(),
    } as unknown as DeepSeekAnalysisService;
    const ragKnowledgeProvider = {
      retrieve: jest.fn().mockResolvedValue([]),
    } as unknown as RagKnowledgeProvider;
    mockCreateReactAgent.mockImplementation(
      (options: {
        tools: Array<{
          name: string;
          invoke: (input: unknown) => Promise<unknown>;
        }>;
      }) => ({
        invoke: async () => {
          const transcriptTool = options.tools.find(
            (candidate) => candidate.name === 'search_transcript',
          );
          const riskTool = options.tools.find(
            (candidate) => candidate.name === 'inspect_risks',
          );
          const submitTool = options.tools.find(
            (candidate) => candidate.name === 'submit_report_answer',
          );
          await transcriptTool?.invoke({ query: '赚钱承诺', limit: 5 });
          await riskTool?.invoke({ query: '赚钱承诺', limit: 5 });
          await submitTool?.invoke({
            answer:
              '**00:12** 原话是“保证你一个月用AI赚钱。”，平台抓到可以直接封禁。',
            segmentIds: ['segment-risk'],
            findingIds: ['finding-1'],
            frameworkStages: [],
            confidence: 'high',
          });
          return {
            messages: [],
          };
        },
      }),
    );
    const service = new ReportReactAgentService(
      deepSeekAnalysisService,
      ragKnowledgeProvider,
      new ReportAnswerEvidenceValidator(),
    );
    const report: PrototypeAnalysisReport = createReport();

    const response = await service.answer({
      report,
      question: '哪句赚钱承诺最危险？',
      messages: [],
      fallbackSegments: report.transcriptSegments.slice(1),
    });

    expect(mockCreateReactAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'livestream_report_react_agent',
        version: 'v2',
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'search_transcript' }),
          expect.objectContaining({ name: 'inspect_risks' }),
          expect.objectContaining({ name: 'inspect_rewrite_suggestions' }),
          expect.objectContaining({ name: 'submit_report_answer' }),
        ]),
      }),
    );
    expect(response.answer).toContain('00:12');
    expect(response.answer).not.toContain('**');
    expect(response.answer).not.toContain('直接封禁');
    expect(response.answer).toContain('存在被平台判定为违规的风险');
    expect(response.relatedSegments).toEqual([
      expect.objectContaining({ id: 'segment-risk' }),
    ]);
    expect(response.evidence).toEqual({
      validated: true,
      confidence: 'high',
      citationCount: 2,
      fallbackUsed: false,
      source: 'react_validated',
    });
    expect(deepSeekAnalysisService.answerReportQuestion).not.toHaveBeenCalled();
  });

  it('returns a local evidence-based answer when the model is not configured', async () => {
    const deepSeekAnalysisService = {
      isConfigured: jest.fn().mockReturnValue(false),
      answerReportQuestion: jest.fn(),
    } as unknown as DeepSeekAnalysisService;
    const service = new ReportReactAgentService(
      deepSeekAnalysisService,
      {} as RagKnowledgeProvider,
      new ReportAnswerEvidenceValidator(),
    );
    const report: PrototypeAnalysisReport = createReport();
    const fallbackSegments: TranscriptSegmentSummary[] =
      report.transcriptSegments.slice(0, 1);

    const response = await service.answer({
      report,
      question: '这场有没有讲课程权益？',
      messages: [],
      fallbackSegments,
    });

    expect(response.answer).toContain('课程承接这一环节');
    expect(response.relatedSegments).toEqual([]);
    expect(response.evidence).toEqual(
      expect.objectContaining({
        validated: true,
        citationCount: 1,
        fallbackUsed: true,
      }),
    );
    expect(mockCreateReactAgent).not.toHaveBeenCalled();
    expect(deepSeekAnalysisService.answerReportQuestion).not.toHaveBeenCalled();
  });

  it('keeps warning examples separate from the host own promises in local fallback', async () => {
    const deepSeekAnalysisService = {
      isConfigured: jest.fn().mockReturnValue(false),
    } as unknown as DeepSeekAnalysisService;
    const service = new ReportReactAgentService(
      deepSeekAnalysisService,
      {} as RagKnowledgeProvider,
      new ReportAnswerEvidenceValidator(),
    );
    const report: PrototypeAnalysisReport = createReport();
    report.transcriptSegments[0].text =
      '如果有人跟你说保证一个月赚钱，这种说法就要谨慎。';

    const response = await service.answer({
      report,
      question: '这场直播最该先改哪三处？',
      messages: [],
      fallbackSegments: [],
    });

    expect(response.answer).toContain('不是主播自己的收益承诺');
    expect(response.answer).toContain('真正要改的是表达方式');
    expect(response.relatedSegments).toEqual([
      expect.objectContaining({ id: 'segment-risk' }),
    ]);
    expect(response.evidence.fallbackUsed).toBe(true);
  });

  it('falls back to a local evidence-based answer when the ReAct loop fails', async () => {
    const deepSeekAnalysisService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createToolCallingModel: jest.fn().mockReturnValue({}),
      answerReportQuestion: jest.fn(),
    } as unknown as DeepSeekAnalysisService;
    mockCreateReactAgent.mockReturnValue({
      invoke: jest.fn().mockRejectedValue(new Error('tool calling failed')),
    });
    const service = new ReportReactAgentService(
      deepSeekAnalysisService,
      {} as RagKnowledgeProvider,
      new ReportAnswerEvidenceValidator(),
    );
    const report: PrototypeAnalysisReport = createReport();
    const fallbackSegments: TranscriptSegmentSummary[] =
      report.transcriptSegments.slice(0, 1);

    const response = await service.answer({
      report,
      question: '这场最大的风险是什么？',
      messages: [],
      fallbackSegments,
    });

    expect(response.answer).toContain('保证你一个月用AI赚钱');
    expect(response.evidence).toEqual(
      expect.objectContaining({
        validated: true,
        fallbackUsed: true,
      }),
    );
    expect(deepSeekAnalysisService.answerReportQuestion).not.toHaveBeenCalled();
  });

  it('rejects an answer that submits unobserved evidence', async () => {
    const deepSeekAnalysisService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createToolCallingModel: jest.fn().mockReturnValue({}),
      answerReportQuestion: jest.fn(),
    } as unknown as DeepSeekAnalysisService;
    mockCreateReactAgent.mockImplementation(
      (options: {
        tools: Array<{
          name: string;
          invoke: (input: unknown) => Promise<unknown>;
        }>;
      }) => ({
        invoke: async () => {
          const submitTool = options.tools.find(
            (candidate) => candidate.name === 'submit_report_answer',
          );
          await submitTool?.invoke({
            answer: '01:59 原话是“你肯定能赚钱”。',
            segmentIds: ['segment-missing'],
            findingIds: [],
            frameworkStages: [],
            confidence: 'high',
          });
          return { messages: [] };
        },
      }),
    );
    const service = new ReportReactAgentService(
      deepSeekAnalysisService,
      {} as RagKnowledgeProvider,
      new ReportAnswerEvidenceValidator(),
    );
    const report: PrototypeAnalysisReport = createReport();

    const response = await service.answer({
      report,
      question: '哪句赚钱承诺最危险？',
      messages: [],
      fallbackSegments: report.transcriptSegments.slice(0, 1),
    });

    expect(response.answer).not.toContain('01:59');
    expect(response.evidence.fallbackUsed).toBe(true);
  });
});

function createReport(): PrototypeAnalysisReport {
  return {
    id: 'report-1',
    title: '测试直播',
    inputSource: 'recording_upload',
    durationSeconds: 120,
    transcriptWordCount: 40,
    frameworkName: 'AI 知识付费直播全场转化框架',
    summary: {
      totalFindings: 1,
      highRiskFindings: 1,
      rewriteSuggestions: 1,
      overallDiagnosis: '存在收益承诺。',
    },
    transcriptSegments: [
      {
        id: 'segment-risk',
        startSeconds: 12,
        endSeconds: 20,
        text: '保证你一个月用AI赚钱。',
        wordCount: 15,
        matchedStage: '干货输出',
      },
      {
        id: 'segment-course',
        startSeconds: 60,
        endSeconds: 72,
        text: '下面讲课程权益和服务。',
        wordCount: 12,
        matchedStage: '课程承接',
      },
    ],
    findings: [
      {
        id: 'finding-1',
        type: 'semantic_risk',
        riskLevel: 'high',
        startSeconds: 12,
        originalText: '保证你一个月用AI赚钱。',
        matchedRule: '收益结果承诺',
        analysis: '把收益说成了确定结果。',
        suggestion: '说清适用条件和结果差异。',
        replacementScript: '课程会提供实操路径，实际结果与基础和执行有关。',
      },
    ],
    frameworkMatches: [
      {
        stageName: '课程承接',
        status: 'matched',
        expectedWindow: '60-84分钟',
        evidence: '已讲课程权益。',
        suggestion: '继续讲清交付边界。',
      },
    ],
    ragReferences: [],
    agentTrace: [],
  };
}
