import { createReactAgent } from '@langchain/langgraph/prebuilt';

import type {
  FrameworkMatchSummary,
  TranscriptSegmentSummary,
} from '@shared/api.interface';

import { DeepSeekAnalysisService } from './deepseek-analysis.service';
import { RhythmAnalysisAgentService } from './rhythm-analysis-agent.service';

jest.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: jest.fn(),
}));

const mockCreateReactAgent = createReactAgent as jest.Mock;

describe('RhythmAnalysisAgentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses ReAct tools and returns evidence-bound stage timing', async () => {
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
            .find((candidate) => candidate.name === 'inspect_framework_stages')
            ?.invoke({});
          await options.tools
            .find((candidate) => candidate.name === 'inspect_timeline_windows')
            ?.invoke({});
          await options.tools
            .find((candidate) => candidate.name === 'submit_rhythm_diagnosis')
            ?.invoke({
              diagnoses: [
                {
                  stageName: '集中输出 AI 干货',
                  status: 'matched',
                  timingIssue: 'on_track',
                  evidenceSegmentIds: ['segment-content'],
                  diagnosis: '开场已经进入干货案例，时间位置合理。',
                  suggestion: '继续保持先讲方法再承接课程。',
                  confidence: 'high',
                },
                {
                  stageName: '课程承接与权益说明',
                  status: 'not_applicable',
                  timingIssue: 'not_applicable',
                  evidenceSegmentIds: [],
                  diagnosis: '当前录屏尚未进入60分钟后的课程承接窗口。',
                  suggestion: '上期学员3天涨粉2000，建议设置限时优惠倒计时。',
                  confidence: 'high',
                },
              ],
            });
        },
      }),
    );
    const service = new RhythmAnalysisAgentService(deepSeek);

    const result = await service.analyze(createOptions());

    expect(result.usedAgent).toBe(true);
    expect(result.frameworkMatches[0]).toMatchObject({
      stageName: '集中输出 AI 干货',
      actualStartSeconds: 0,
      actualEndSeconds: 120,
      evidenceSegmentIds: ['segment-content'],
      timingIssue: 'on_track',
      confidence: 'high',
    });
    expect(result.frameworkMatches[1]).toMatchObject({
      status: 'not_applicable',
      actualStartSeconds: undefined,
      suggestion: '后续讲清课程权益。',
      confidence: 'medium',
    });
  });

  it('falls back to timestamp rules when the model is not configured', async () => {
    const deepSeek = {
      isConfigured: jest.fn().mockReturnValue(false),
    } as unknown as DeepSeekAnalysisService;
    const service = new RhythmAnalysisAgentService(deepSeek);

    const result = await service.analyze(createOptions());

    expect(result.usedAgent).toBe(false);
    expect(result.frameworkMatches[0]).toMatchObject({
      actualStartSeconds: 0,
      actualEndSeconds: 120,
      timingIssue: 'on_track',
      confidence: 'medium',
    });
    expect(mockCreateReactAgent).not.toHaveBeenCalled();
  });

  it('rejects a diagnosis with fabricated segment ids', async () => {
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
            .find((candidate) => candidate.name === 'inspect_framework_stages')
            ?.invoke({});
          await options.tools
            .find((candidate) => candidate.name === 'inspect_timeline_windows')
            ?.invoke({});
          await options.tools
            .find((candidate) => candidate.name === 'submit_rhythm_diagnosis')
            ?.invoke({
              diagnoses: [
                {
                  stageName: '集中输出 AI 干货',
                  status: 'matched',
                  timingIssue: 'on_track',
                  evidenceSegmentIds: ['fabricated-segment'],
                  diagnosis: '有干货。',
                  suggestion: '继续保持。',
                  confidence: 'high',
                },
                {
                  stageName: '课程承接与权益说明',
                  status: 'not_applicable',
                  timingIssue: 'not_applicable',
                  evidenceSegmentIds: [],
                  diagnosis: '尚未进入对应时间窗。',
                  suggestion: '后续再判断。',
                  confidence: 'high',
                },
              ],
            });
        },
      }),
    );
    const service = new RhythmAnalysisAgentService(deepSeek);

    const result = await service.analyze(createOptions());

    expect(result.usedAgent).toBe(false);
    expect(result.statusText).toContain('校验未通过');
  });
});

function createOptions(): {
  transcriptSegments: TranscriptSegmentSummary[];
  frameworkName: string;
  baselineMatches: FrameworkMatchSummary[];
  ragReferences: [];
} {
  return {
    transcriptSegments: [
      {
        id: 'segment-content',
        startSeconds: 0,
        endSeconds: 120,
        text: '先带大家做一个AI提示词案例，讲清楚具体步骤。',
        wordCount: 25,
        matchedStage: '干货输出',
      },
    ],
    frameworkName: 'AI 知识付费直播全场转化框架',
    baselineMatches: [
      {
        stageName: '集中输出 AI 干货',
        status: 'matched',
        expectedWindow: '0-60 分钟',
        evidence: '识别到关键词“AI”。',
        suggestion: '继续保持干货密度。',
      },
      {
        stageName: '课程承接与权益说明',
        status: 'not_applicable',
        expectedWindow: '60-84 分钟',
        evidence: '当前录屏尚未进入该时段。',
        suggestion: '后续讲清课程权益。',
      },
    ],
    ragReferences: [],
  };
}
