import { createReactAgent } from '@langchain/langgraph/prebuilt';

import type {
  FrameworkMatchSummary,
  ScriptFinding,
  TranscriptSegmentSummary,
} from '@shared/api.interface';

import { DeepSeekAnalysisService } from './deepseek-analysis.service';
import { RewriteAdviceAgentService } from './rewrite-advice-agent.service';

jest.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: jest.fn(),
}));

const mockCreateReactAgent = createReactAgent as jest.Mock;

describe('RewriteAdviceAgentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses risk and rhythm evidence to produce validated rewrites', async () => {
    const deepSeek = {
      isConfigured: jest.fn().mockReturnValue(true),
      createToolCallingModel: jest.fn().mockReturnValue({}),
    } as unknown as DeepSeekAnalysisService;
    mockCreateReactAgent.mockImplementation(
      (options: {
        tools: Array<{
          name: string;
          invoke: (input: unknown) => Promise<unknown>;
        }>;
      }) => ({
        invoke: async () => {
          await options.tools
            .find((candidate) => candidate.name === 'inspect_risk_findings')
            ?.invoke({});
          await options.tools
            .find((candidate) => candidate.name === 'inspect_rhythm_diagnosis')
            ?.invoke({});
          await options.tools
            .find((candidate) => candidate.name === 'submit_rewrite_advice')
            ?.invoke({
              rewrites: [
                {
                  findingId: 'finding-1',
                  evidenceSegmentIds: ['segment-risk'],
                  addressedRhythmStage: '课程承接与权益说明',
                  suggestion: '先讲交付内容，再说明结果取决于执行。',
                  replacementScript:
                    '课程会带你完成工具练习和作业反馈，实际效果与个人基础和执行投入有关。',
                  confidence: 'high',
                },
              ],
              reviewScript:
                '前面先把AI案例做完整，再承接课程交付。讲课程时说清练习、反馈和适用人群，最后提醒实际效果与个人执行有关。',
            });
        },
      }),
    );
    const service = new RewriteAdviceAgentService(deepSeek);

    const result = await service.rewrite(createOptions());

    expect(result.usedAgent).toBe(true);
    expect(result.findings[0]).toMatchObject({
      rewriteEvidenceSegmentIds: ['segment-risk'],
      rewriteConfidence: 'high',
      replacementScript: expect.stringContaining('作业反馈'),
    });
    expect(result.reviewScript).toContain('先把AI案例做完整');
  });

  it('returns a usable local script when the model is not configured', async () => {
    const deepSeek = {
      isConfigured: jest.fn().mockReturnValue(false),
    } as unknown as DeepSeekAnalysisService;
    const service = new RewriteAdviceAgentService(deepSeek);

    const result = await service.rewrite(createOptions());

    expect(result.usedAgent).toBe(false);
    expect(result.reviewScript).toContain('课程承接与权益说明');
    expect(result.reviewScript).toContain('实际结果会和个人执行有关');
    expect(mockCreateReactAgent).not.toHaveBeenCalled();
  });

  it('rejects rewrites that introduce a new guaranteed result', async () => {
    const deepSeek = {
      isConfigured: jest.fn().mockReturnValue(true),
      createToolCallingModel: jest.fn().mockReturnValue({}),
    } as unknown as DeepSeekAnalysisService;
    mockCreateReactAgent.mockImplementation(
      (options: {
        tools: Array<{
          name: string;
          invoke: (input: unknown) => Promise<unknown>;
        }>;
      }) => ({
        invoke: async () => {
          await options.tools
            .find((candidate) => candidate.name === 'inspect_risk_findings')
            ?.invoke({});
          await options.tools
            .find((candidate) => candidate.name === 'inspect_rhythm_diagnosis')
            ?.invoke({});
          await options.tools
            .find((candidate) => candidate.name === 'submit_rewrite_advice')
            ?.invoke({
              rewrites: [
                {
                  findingId: 'finding-1',
                  evidenceSegmentIds: ['segment-risk'],
                  suggestion: '强化成交。',
                  replacementScript: '保证一个月用AI赚钱。',
                  confidence: 'high',
                },
              ],
              reviewScript: '保证一个月用AI赚钱。',
            });
        },
      }),
    );
    const service = new RewriteAdviceAgentService(deepSeek);

    const result = await service.rewrite(createOptions());

    expect(result.usedAgent).toBe(false);
    expect(result.statusText).toContain('校验未通过');
    expect(result.findings[0].replacementScript).toBe(
      '课程提供方法和练习，实际结果会和个人执行有关。',
    );
  });

  it('keeps a safe item rewrite and replaces an unsafe review script', async () => {
    const deepSeek = {
      isConfigured: jest.fn().mockReturnValue(true),
      createToolCallingModel: jest.fn().mockReturnValue({}),
    } as unknown as DeepSeekAnalysisService;
    mockCreateReactAgent.mockImplementation(
      (options: {
        tools: Array<{
          name: string;
          invoke: (input: unknown) => Promise<unknown>;
        }>;
      }) => ({
        invoke: async () => {
          await options.tools
            .find((candidate) => candidate.name === 'inspect_risk_findings')
            ?.invoke({});
          await options.tools
            .find((candidate) => candidate.name === 'inspect_rhythm_diagnosis')
            ?.invoke({});
          await options.tools
            .find((candidate) => candidate.name === 'submit_rewrite_advice')
            ?.invoke({
              rewrites: [
                {
                  findingId: 'finding-1',
                  evidenceSegmentIds: ['segment-risk'],
                  addressedRhythmStage: '课程承接与权益说明',
                  suggestion: '说明交付内容和结果边界。',
                  replacementScript:
                    '课程提供练习和反馈，实际结果与个人投入有关。',
                  confidence: 'high',
                },
              ],
              reviewScript: '保证一个月用AI赚钱。',
            });
        },
      }),
    );
    const service = new RewriteAdviceAgentService(deepSeek);

    const result = await service.rewrite(createOptions());

    expect(result.usedAgent).toBe(true);
    expect(result.statusText).toContain('采纳 1 条安全改写');
    expect(result.findings[0].replacementScript).toContain('练习和反馈');
    expect(result.reviewScript).not.toContain('保证一个月');
    expect(result.reviewScript).toContain('实际结果与个人投入有关');
  });
});

function createOptions(): {
  transcriptSegments: TranscriptSegmentSummary[];
  findings: ScriptFinding[];
  frameworkMatches: FrameworkMatchSummary[];
  ragReferences: [];
} {
  return {
    transcriptSegments: [
      {
        id: 'segment-risk',
        startSeconds: 3600,
        endSeconds: 3630,
        text: '这个课程保证一个月用AI赚钱。',
        wordCount: 18,
        matchedStage: '课程承接',
      },
    ],
    findings: [
      {
        id: 'finding-1',
        type: 'semantic_risk',
        riskLevel: 'high',
        startSeconds: 3600,
        originalText: '保证一个月用AI赚钱',
        matchedRule: '收益结果承诺',
        analysis: '把收益说成确定结果。',
        suggestion: '改成条件型表达。',
        replacementScript:
          '课程提供方法和练习，实际结果会和个人执行有关。',
      },
    ],
    frameworkMatches: [
      {
        stageName: '课程承接与权益说明',
        status: 'weak',
        expectedWindow: '60-84 分钟',
        actualStartSeconds: 3600,
        actualEndSeconds: 3630,
        evidenceSegmentIds: ['segment-risk'],
        timingIssue: 'too_short',
        confidence: 'high',
        evidence: '课程承接只有一句结果承诺，交付内容不足。',
        suggestion: '补充课程交付、练习和反馈机制。',
      },
    ],
    ragReferences: [],
  };
}
