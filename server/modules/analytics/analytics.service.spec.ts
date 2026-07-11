import type { PrototypeAnalysisReport } from '@shared/api.interface';

import { AnalyticsService } from './analytics.service';

const reportFixture: PrototypeAnalysisReport = {
  id: 'report-test',
  title: '测试直播',
  inputSource: 'recording_upload',
  durationSeconds: 600,
  transcriptWordCount: 120,
  frameworkName: 'AI 知识付费直播全场转化框架',
  summary: {
    totalFindings: 1,
    highRiskFindings: 1,
    rewriteSuggestions: 1,
    overallDiagnosis: '存在收益承诺风险。',
  },
  transcriptSegments: [
    {
      id: 'segment-1',
      startSeconds: 0,
      endSeconds: 180,
      text: '今天带大家做一个 AI 案例。',
      wordCount: 14,
      matchedStage: '焦虑唤醒 + AI 干货案例',
    },
    {
      id: 'segment-2',
      startSeconds: 181,
      endSeconds: 600,
      text: '跟着课程学习就能保证拿到结果。',
      wordCount: 18,
      matchedStage: '课程承接 + 权益说明',
    },
  ],
  findings: [
    {
      id: 'finding-1',
      type: 'semantic_risk',
      riskLevel: 'high',
      startSeconds: 260,
      originalText: '跟着课程学习就能保证拿到结果。',
      matchedRule: '结果保证',
      analysis: '容易被理解为确定性收益承诺。',
      suggestion: '补充适用条件和结果边界。',
      replacementScript: '课程提供方法和反馈，实际结果取决于个人基础与执行。',
    },
  ],
  frameworkMatches: [],
  ragReferences: [],
  agentTrace: [],
};

describe('AnalyticsService', () => {
  const service = new AnalyticsService();

  it('keeps mock data clearly labeled and aligned to the report timeline', () => {
    const result = service.createMockLiveDataReplay({
      report: reportFixture,
      provider: 'mock_third_party',
    });

    expect(result.provider).toBe('mock_third_party');
    expect(result.sourceLabel).toBe('示例第三方数据');
    expect(result.points.length).toBeGreaterThan(2);
    expect(result.insights[0]).toMatchObject({
      relatedText: reportFixture.findings[0].originalText,
      severity: 'high',
    });
  });

  it('does not label mock values as a real third-party provider', () => {
    expect(() =>
      service.createMockLiveDataReplay({
        report: reportFixture,
        provider: 'chanmama',
      }),
    ).toThrow('该第三方数据源尚未接入');
  });
});
