import { buildDemoReport } from '../../client/src/data/demo-report';

describe('buildDemoReport', () => {
  it('在没有后端时也能生成完整示例报告', () => {
    const report = buildDemoReport({
      inputSource: 'recording_upload',
      recordingName: '示例直播',
      frameworkName: '自定义分析框架',
    });

    expect(report.title).toBe('示例直播');
    expect(report.frameworkName).toBe('自定义分析框架');
    expect(report.durationSeconds).toBe(326);
    expect(report.transcriptSegments).toHaveLength(4);
    expect(report.findings).toHaveLength(4);
    expect(report.summary.highRiskFindings).toBe(3);
    expect(report.agentTrace).toHaveLength(5);
    expect(report.frameworkMatches[0]).toMatchObject({
      actualStartSeconds: 0,
      timingIssue: 'on_track',
    });
    expect(report.reviewScript).toContain('作业反馈');
  });
});
