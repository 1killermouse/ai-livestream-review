import { buildDemoLiveDataReplay } from '../../client/src/data/demo-live-data';
import { buildDemoReport } from '../../client/src/data/demo-report';

describe('buildDemoLiveDataReplay', () => {
  it('无需后端即可生成对齐话术时间轴的示例数据', () => {
    const report = buildDemoReport({
      inputSource: 'recording_upload',
      recordingName: '示例直播',
    });
    const replay = buildDemoLiveDataReplay(report);

    expect(replay.provider).toBe('mock_third_party');
    expect(replay.sourceLabel).toBe('示例第三方数据');
    expect(replay.points.length).toBeGreaterThan(2);
    expect(replay.points.at(-1)?.second).toBe(report.durationSeconds);
    expect(replay.insights).toHaveLength(3);
    expect(replay.summary.keyDropCount).toBe(3);
  });
});
