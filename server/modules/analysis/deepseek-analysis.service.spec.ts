import axios from 'axios';

import type { TranscriptSegmentSummary } from '@shared/api.interface';

import { DeepSeekAnalysisService } from './deepseek-analysis.service';

describe('DeepSeekAnalysisService', () => {
  const originalApiKey: string | undefined = process.env.DEEPSEEK_API_KEY;

  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (originalApiKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = originalApiKey;
    }
  });

  it('keeps only findings grounded in ASR text and corrects their timestamp', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                findings: [
                  {
                    type: 'framework_gap',
                    riskLevel: 'high',
                    startSeconds: 999,
                    originalText: '保证一个月用AI赚钱',
                    matchedRule: '收益结果承诺',
                    analysis: '把收益说成确定结果。',
                    suggestion: '补充执行条件。',
                    replacementScript: '保证七天就能回本。',
                  },
                  {
                    type: 'semantic_risk',
                    riskLevel: 'high',
                    startSeconds: 120,
                    originalText: '直播里根本没有的承诺',
                    matchedRule: '虚构风险',
                  },
                ],
              }),
            },
          },
        ],
      },
    });
    const service = new DeepSeekAnalysisService();

    const findings = await service.analyzeTranscript(
      createOptions([
        {
          id: 'segment-risk',
          startSeconds: 120,
          endSeconds: 135,
          text: '课程里说保证一个月用AI赚钱。',
          wordCount: 16,
          matchedStage: '课程承接',
        },
      ]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: 'semantic_risk',
      startSeconds: 120,
      originalText: '保证一个月用AI赚钱',
    });
    expect(findings[0].replacementScript).not.toContain('保证七天');
    expect(findings[0].replacementScript).toContain('实际结果');
  });

  it('splits long transcripts into bounded model requests', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        choices: [{ message: { content: '{"findings":[]}' } }],
      },
    });
    const service = new DeepSeekAnalysisService();
    const segments: TranscriptSegmentSummary[] = Array.from(
      { length: 3 },
      (_value, index: number): TranscriptSegmentSummary => ({
        id: `segment-${index + 1}`,
        startSeconds: index * 60,
        endSeconds: index * 60 + 60,
        text: '正常内容'.repeat(1000),
        wordCount: 4000,
        matchedStage: '干货输出',
      }),
    );

    await service.analyzeTranscript(createOptions(segments));

    expect(post).toHaveBeenCalledTimes(2);
  });
});

function createOptions(transcriptSegments: TranscriptSegmentSummary[]) {
  return {
    transcriptSegments,
    frameworkName: 'AI 知识付费直播全场转化框架',
    frameworkMatches: [],
    ragReferences: [],
  };
}
