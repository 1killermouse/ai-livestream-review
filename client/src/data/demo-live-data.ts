import type {
  LiveDataInsight,
  LiveDataReplayResult,
  LiveMetricPoint,
  PrototypeAnalysisReport,
  ScriptFinding,
  TranscriptSegmentSummary,
} from '@shared/api.interface';

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function findNearbyRisk(
  report: PrototypeAnalysisReport,
  second: number,
): ScriptFinding | undefined {
  return report.findings.find(
    (finding: ScriptFinding): boolean =>
      Math.abs(finding.startSeconds - second) <= 45,
  );
}

function buildPoints(report: PrototypeAnalysisReport): LiveMetricPoint[] {
  const durationSeconds = Math.max(report.durationSeconds, 300);
  const seconds = Array.from(
    new Set(
      [
        0,
        ...report.transcriptSegments.flatMap(
          (segment: TranscriptSegmentSummary): number[] => [
            segment.startSeconds,
            segment.endSeconds,
          ],
        ),
        durationSeconds,
      ]
        .map((second: number): number =>
          Math.max(0, Math.min(durationSeconds, Math.round(second))),
        )
        .sort((left: number, right: number): number => left - right),
    ),
  );

  return seconds.map((second: number, index: number): LiveMetricPoint => {
    const phase = second / durationSeconds;
    const nearbyRisk = findNearbyRisk(report, second);
    const riskPenalty = nearbyRisk
      ? nearbyRisk.riskLevel === 'critical'
        ? 96
        : nearbyRisk.riskLevel === 'high'
          ? 72
          : nearbyRisk.riskLevel === 'medium'
            ? 34
            : 12
      : 0;
    const contentLift = index % 3 === 0 ? 32 : index % 3 === 1 ? 14 : 24;
    const onlineUsers = Math.max(
      80,
      Math.round(
        360 + Math.sin(phase * Math.PI * 1.8) * 90 + contentLift - riskPenalty,
      ),
    );
    const interactions = Math.max(
      18,
      Math.round(
        onlineUsers * (0.13 + phase * 0.08) -
          riskPenalty * 0.22 +
          (index % 2 === 0 ? 12 : 0),
      ),
    );
    const productClicks = Math.max(
      0,
      Math.round(onlineUsers * Math.max(0, phase - 0.22) * 0.2),
    );
    const orders = Math.max(
      0,
      Math.round(productClicks * (nearbyRisk ? 0.035 : 0.07)),
    );

    return {
      second,
      timeLabel: formatTime(second),
      onlineUsers,
      interactions,
      productClicks,
      orders,
      conversionRate:
        productClicks > 0
          ? Number(((orders / productClicks) * 100).toFixed(1))
          : 0,
      note: nearbyRisk?.matchedRule,
    };
  });
}

function buildInsights(
  report: PrototypeAnalysisReport,
  points: LiveMetricPoint[],
): LiveDataInsight[] {
  const findings = report.findings
    .filter(
      (finding: ScriptFinding): boolean =>
        finding.riskLevel === 'critical' || finding.riskLevel === 'high',
    )
    .slice(0, 3);

  if (findings.length === 0) {
    const segment = report.transcriptSegments[0];
    return [
      {
        id: 'rhythm-watch-1',
        startSeconds: segment?.startSeconds || 0,
        endSeconds: segment?.endSeconds || 60,
        title: '数据平稳，重点看承接',
        severity: 'medium',
        metricChange: '互动增长较慢',
        relatedText: segment?.text || report.summary.overallDiagnosis,
        diagnosis:
          '示例数据没有明显断崖下滑，但课程承接和权益说明还可以说得更清楚。',
        suggestion:
          '在转课程前先总结用户刚刚学到的内容，再自然过渡到课程能继续解决什么问题。',
      },
    ];
  }

  return findings.map(
    (finding: ScriptFinding, index: number): LiveDataInsight => {
      const segment = report.transcriptSegments.find(
        (item: TranscriptSegmentSummary): boolean =>
          finding.startSeconds >= item.startSeconds &&
          finding.startSeconds <= item.endSeconds,
      );
      const currentPoint = points.reduce(
        (nearest: LiveMetricPoint, point: LiveMetricPoint): LiveMetricPoint =>
          Math.abs(point.second - finding.startSeconds) <
          Math.abs(nearest.second - finding.startSeconds)
            ? point
            : nearest,
        points[0],
      );
      const previousPoint = points
        .filter(
          (point: LiveMetricPoint): boolean =>
            point.second < finding.startSeconds,
        )
        .at(-1);

      return {
        id: `risk-drop-${index + 1}`,
        startSeconds: segment?.startSeconds ?? finding.startSeconds,
        endSeconds: segment?.endSeconds ?? finding.startSeconds + 60,
        title: '话术风险与数据下滑重叠',
        severity: finding.riskLevel,
        metricChange: previousPoint
          ? `在线人数 ${previousPoint.onlineUsers} -> ${currentPoint.onlineUsers}`
          : '在线人数出现波动',
        relatedText: finding.originalText || segment?.text || '',
        diagnosis: `${finding.matchedRule.replace(/^DeepSeek 语义判断：/, '')} 附近出现数据承压，用户可能对收益承诺、案例边界或课程效果产生疑虑。`,
        suggestion:
          finding.replacementScript ||
          '把确定性收益表达改成学习路径、交付内容和适合人群说明。',
      };
    },
  );
}

export function buildDemoLiveDataReplay(
  report: PrototypeAnalysisReport,
): LiveDataReplayResult {
  const points = buildPoints(report);
  const insights = buildInsights(report, points);
  const totalInteractions = points.reduce(
    (total: number, point: LiveMetricPoint): number =>
      total + point.interactions,
    0,
  );
  const totalProductClicks = points.reduce(
    (total: number, point: LiveMetricPoint): number =>
      total + point.productClicks,
    0,
  );
  const totalOrders = points.reduce(
    (total: number, point: LiveMetricPoint): number => total + point.orders,
    0,
  );
  const highRiskCount = insights.filter(
    (insight: LiveDataInsight): boolean =>
      insight.severity === 'critical' || insight.severity === 'high',
  ).length;

  return {
    provider: 'mock_third_party',
    sourceLabel: '示例第三方数据',
    generatedAt: new Date().toISOString(),
    points,
    insights,
    summary: {
      peakOnlineUsers: Math.max(
        ...points.map((point: LiveMetricPoint): number => point.onlineUsers),
      ),
      averageOnlineUsers: Math.round(
        points.reduce(
          (total: number, point: LiveMetricPoint): number =>
            total + point.onlineUsers,
          0,
        ) / points.length,
      ),
      totalInteractions,
      totalProductClicks,
      totalOrders,
      conversionRate:
        totalProductClicks > 0
          ? Number(((totalOrders / totalProductClicks) * 100).toFixed(1))
          : 0,
      keyDropCount: highRiskCount,
      overallDiagnosis: `示例数据把直播指标和话术时间轴对齐后，识别到 ${insights.length} 个重点复盘点，其中 ${highRiskCount} 个和高风险话术或承接节点有关。建议优先把这些时间点的话术换成更稳的表达。`,
    },
  };
}
