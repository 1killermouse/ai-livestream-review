import type { PrototypeAnalysisReport } from '@shared/api.interface';

import { ReportAnswerEvidenceValidator } from './report-answer-evidence.validator';

describe('ReportAnswerEvidenceValidator', () => {
  const validator = new ReportAnswerEvidenceValidator();

  it('accepts a time point and original quote supported by observed evidence', () => {
    const result = validator.validate({
      report: createReport(),
      question: '哪句收益承诺最危险？',
      submission: {
        answer: '00:12 原话是：「保证你一个月用AI赚钱。」',
        segmentIds: ['segment-risk'],
        findingIds: ['finding-1'],
        frameworkStages: [],
        confidence: 'high',
      },
      observed: {
        segmentIds: new Set(['segment-risk']),
        findingIds: new Set(['finding-1']),
        frameworkStages: new Set(),
        overviewUsed: false,
      },
    });

    expect(result).toMatchObject({
      valid: true,
      confidence: 'high',
      citationCount: 2,
      relatedSegments: [expect.objectContaining({ id: 'segment-risk' })],
      reasons: [],
    });
  });

  it('rejects a fabricated time point and original quote', () => {
    const result = validator.validate({
      report: createReport(),
      question: '哪句收益承诺最危险？',
      submission: {
        answer: '01:59 原话是“你肯定能赚钱”。',
        segmentIds: ['segment-risk'],
        findingIds: ['finding-1'],
        frameworkStages: [],
        confidence: 'high',
      },
      observed: {
        segmentIds: new Set(['segment-risk']),
        findingIds: new Set(['finding-1']),
        frameworkStages: new Set(),
        overviewUsed: false,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.confidence).toBe('low');
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('01:59'),
        expect.stringContaining('与逐字稿不一致'),
      ]),
    );
  });

  it('rejects evidence ids that were not returned by report tools', () => {
    const result = validator.validate({
      report: createReport(),
      question: '这场最大的风险是什么？',
      submission: {
        answer: '最大风险是收益承诺。',
        segmentIds: [],
        findingIds: ['finding-1'],
        frameworkStages: [],
        confidence: 'high',
      },
      observed: {
        segmentIds: new Set(),
        findingIds: new Set(),
        frameworkStages: new Set(),
        overviewUsed: false,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('风险项 finding-1 未经工具查证');
  });

  it('prefers the segment starting exactly at a finding boundary', () => {
    const report: PrototypeAnalysisReport = createReport();
    report.transcriptSegments.unshift({
      id: 'segment-before',
      startSeconds: 0,
      endSeconds: 12,
      text: '这是上一段。',
      wordCount: 7,
      matchedStage: '干货输出',
    });
    const result = validator.validate({
      report,
      question: '哪句收益承诺最危险？',
      submission: {
        answer: '00:12 是高风险收益承诺。',
        segmentIds: [],
        findingIds: ['finding-1'],
        frameworkStages: [],
        confidence: 'high',
      },
      observed: {
        segmentIds: new Set(),
        findingIds: new Set(['finding-1']),
        frameworkStages: new Set(),
        overviewUsed: false,
      },
    });

    expect(result.valid).toBe(true);
    expect(result.relatedSegments).toEqual([
      expect.objectContaining({ id: 'segment-risk' }),
    ]);
  });

  it('rejects treating a warning example as the host own promise', () => {
    const report: PrototypeAnalysisReport = createReport();
    report.transcriptSegments[0].text =
      '如果有人跟你说保证一个月赚钱，这种说法就要谨慎。';
    const result = validator.validate({
      report,
      question: '这场最大的风险是什么？',
      submission: {
        answer:
          '这是收益承诺风险。主播把赚钱说成确定结果。最后补充，这是在提醒用户。',
        segmentIds: ['segment-risk'],
        findingIds: ['finding-1'],
        frameworkStages: [],
        confidence: 'high',
      },
      observed: {
        segmentIds: new Set(['segment-risk']),
        findingIds: new Set(['finding-1']),
        frameworkStages: new Set(),
        overviewUsed: false,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('引用或否定语境被误写成主播自己的承诺');
  });

  it('accepts a warning example when the answer explains the context first', () => {
    const report: PrototypeAnalysisReport = createReport();
    report.transcriptSegments[0].text =
      '如果有人跟你说保证一个月赚钱，这种说法就要谨慎。';
    const result = validator.validate({
      report,
      question: '这场最大的风险是什么？',
      submission: {
        answer:
          '这段是在提醒用户，不是主播自己的承诺。建议减少逐字复述，直接提醒用户警惕夸张结果。',
        segmentIds: ['segment-risk'],
        findingIds: ['finding-1'],
        frameworkStages: [],
        confidence: 'high',
      },
      observed: {
        segmentIds: new Set(['segment-risk']),
        findingIds: new Set(['finding-1']),
        frameworkStages: new Set(),
        overviewUsed: false,
      },
    });

    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
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
