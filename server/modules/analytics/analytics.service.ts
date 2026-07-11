import { Injectable } from '@nestjs/common';

import type {
  LiveDataInsight,
  LiveDataProvider,
  LiveDataReplayRequest,
  LiveDataReplayResult,
  LiveMetricPoint,
  PrototypeAnalysisReport,
  RiskLevel,
  ScriptFinding,
  TranscriptSegmentSummary,
} from '@shared/api.interface';

@Injectable()
export class AnalyticsService {
  createMockLiveDataReplay(
    request: LiveDataReplayRequest,
  ): LiveDataReplayResult {
    if (!request.report) {
      throw new Error('请先生成本场直播体检报告');
    }

    if (request.provider && request.provider !== 'mock_third_party') {
      throw new Error('该第三方数据源尚未接入，请先使用示例数据');
    }
    const provider: LiveDataProvider = 'mock_third_party';
    const points: LiveMetricPoint[] = this.buildMockPoints(request.report);
    const insights: LiveDataInsight[] = this.buildInsights(
      request.report,
      points,
    );
    const totalInteractions: number = points.reduce(
      (sum: number, point: LiveMetricPoint): number => sum + point.interactions,
      0,
    );
    const totalProductClicks: number = points.reduce(
      (sum: number, point: LiveMetricPoint): number =>
        sum + point.productClicks,
      0,
    );
    const totalOrders: number = points.reduce(
      (sum: number, point: LiveMetricPoint): number => sum + point.orders,
      0,
    );
    const peakOnlineUsers: number = Math.max(
      ...points.map((point: LiveMetricPoint): number => point.onlineUsers),
    );
    const averageOnlineUsers: number = Math.round(
      points.reduce(
        (sum: number, point: LiveMetricPoint): number =>
          sum + point.onlineUsers,
        0,
      ) / points.length,
    );
    const keyDropCount: number = insights.filter(
      (insight: LiveDataInsight): boolean =>
        insight.severity === 'critical' || insight.severity === 'high',
    ).length;

    return {
      provider,
      sourceLabel: this.getSourceLabel(provider),
      generatedAt: new Date().toISOString(),
      points,
      insights,
      summary: {
        peakOnlineUsers,
        averageOnlineUsers,
        totalInteractions,
        totalProductClicks,
        totalOrders,
        conversionRate:
          totalProductClicks > 0
            ? Number(((totalOrders / totalProductClicks) * 100).toFixed(1))
            : 0,
        keyDropCount,
        overallDiagnosis: this.buildOverallDiagnosis(request.report, insights),
      },
    };
  }

  private buildMockPoints(report: PrototypeAnalysisReport): LiveMetricPoint[] {
    const durationSeconds: number = Math.max(report.durationSeconds, 300);
    const rawSeconds: number[] = [
      0,
      ...report.transcriptSegments.flatMap(
        (segment: TranscriptSegmentSummary): number[] => [
          segment.startSeconds,
          segment.endSeconds,
        ],
      ),
      durationSeconds,
    ];
    const timelineSeconds: number[] = Array.from(
      new Set(
        rawSeconds
          .map((second: number): number =>
            Math.max(0, Math.min(durationSeconds, Math.round(second))),
          )
          .sort((a: number, b: number): number => a - b),
      ),
    );

    return timelineSeconds.map(
      (second: number, index: number): LiveMetricPoint => {
        const phase: number = second / durationSeconds;
        const nearbyRisk: ScriptFinding | undefined = this.findNearbyRisk(
          report,
          second,
        );
        const riskPenalty: number = nearbyRisk
          ? nearbyRisk.riskLevel === 'critical'
            ? 96
            : nearbyRisk.riskLevel === 'high'
              ? 72
              : nearbyRisk.riskLevel === 'medium'
                ? 34
                : 12
          : 0;
        const contentLift: number =
          index % 3 === 0 ? 32 : index % 3 === 1 ? 14 : 24;
        const onlineUsers: number = Math.max(
          80,
          Math.round(
            360 +
              Math.sin(phase * Math.PI * 1.8) * 90 +
              contentLift -
              riskPenalty,
          ),
        );
        const interactions: number = Math.max(
          18,
          Math.round(
            onlineUsers * (0.13 + phase * 0.08) -
              riskPenalty * 0.22 +
              (index % 2 === 0 ? 12 : 0),
          ),
        );
        const productClicks: number = Math.max(
          0,
          Math.round(onlineUsers * Math.max(0, phase - 0.22) * 0.2),
        );
        const orders: number = Math.max(
          0,
          Math.round(productClicks * (nearbyRisk ? 0.035 : 0.07)),
        );

        return {
          second,
          timeLabel: this.formatTime(second),
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
      },
    );
  }

  private buildInsights(
    report: PrototypeAnalysisReport,
    points: LiveMetricPoint[],
  ): LiveDataInsight[] {
    const highRiskFindings: ScriptFinding[] = report.findings.filter(
      (finding: ScriptFinding): boolean =>
        finding.riskLevel === 'critical' || finding.riskLevel === 'high',
    );
    const riskInsights: LiveDataInsight[] = highRiskFindings
      .slice(0, 3)
      .map((finding: ScriptFinding, index: number): LiveDataInsight => {
        const segment: TranscriptSegmentSummary =
          this.findSegment(report, finding.startSeconds) ||
          report.transcriptSegments[0];
        const previousPoint: LiveMetricPoint | undefined =
          this.findPreviousPoint(points, finding.startSeconds);
        const currentPoint: LiveMetricPoint | undefined = this.findNearestPoint(
          points,
          finding.startSeconds,
        );
        const dropText: string =
          previousPoint && currentPoint
            ? `在线人数 ${previousPoint.onlineUsers} -> ${currentPoint.onlineUsers}`
            : '在线人数出现波动';

        return {
          id: `risk-drop-${index + 1}`,
          startSeconds: segment?.startSeconds || finding.startSeconds,
          endSeconds: segment?.endSeconds || finding.startSeconds + 60,
          title: '话术风险与数据下滑重叠',
          severity: finding.riskLevel,
          metricChange: dropText,
          relatedText: finding.originalText || segment?.text || '',
          diagnosis: `${this.cleanRule(finding.matchedRule)} 附近出现数据承压，用户可能对收益承诺、案例边界或课程效果产生疑虑。`,
          suggestion:
            finding.replacementScript ||
            '把确定性收益表达改成学习路径、交付内容和适合人群说明。',
        };
      });

    if (riskInsights.length > 0) {
      return riskInsights;
    }

    const weakestSegment: TranscriptSegmentSummary | undefined =
      report.transcriptSegments[0];
    return [
      {
        id: 'rhythm-watch-1',
        startSeconds: weakestSegment?.startSeconds || 0,
        endSeconds: weakestSegment?.endSeconds || 60,
        title: '数据平稳，重点看承接',
        severity: 'medium',
        metricChange: '互动增长较慢',
        relatedText: weakestSegment?.text || report.summary.overallDiagnosis,
        diagnosis:
          '示例数据没有明显断崖下滑，但课程承接和权益说明还可以说得更清楚。',
        suggestion:
          '在转课程前先总结用户刚刚学到的内容，再自然过渡到课程能继续解决什么问题。',
      },
    ];
  }

  private buildOverallDiagnosis(
    report: PrototypeAnalysisReport,
    insights: LiveDataInsight[],
  ): string {
    if (insights.length === 0) {
      return '本场示例数据整体平稳，后续接入真实第三方数据后，可以按时间轴继续追踪在线、互动和转化变化。';
    }

    const highRiskCount: number = insights.filter(
      (insight: LiveDataInsight): boolean =>
        insight.severity === 'critical' || insight.severity === 'high',
    ).length;
    return `示例数据把直播指标和话术时间轴对齐后，识别到 ${insights.length} 个重点复盘点，其中 ${highRiskCount} 个和高风险话术或承接节点有关。建议优先把这些时间点的话术换成更稳的表达。`;
  }

  private findNearbyRisk(
    report: PrototypeAnalysisReport,
    second: number,
  ): ScriptFinding | undefined {
    return report.findings.find(
      (finding: ScriptFinding): boolean =>
        Math.abs(finding.startSeconds - second) <= 45,
    );
  }

  private findSegment(
    report: PrototypeAnalysisReport,
    second: number,
  ): TranscriptSegmentSummary | undefined {
    return report.transcriptSegments.find(
      (segment: TranscriptSegmentSummary): boolean =>
        second >= segment.startSeconds && second <= segment.endSeconds,
    );
  }

  private findNearestPoint(
    points: LiveMetricPoint[],
    second: number,
  ): LiveMetricPoint | undefined {
    return points.reduce(
      (
        nearest: LiveMetricPoint | undefined,
        point: LiveMetricPoint,
      ): LiveMetricPoint =>
        !nearest ||
        Math.abs(point.second - second) < Math.abs(nearest.second - second)
          ? point
          : nearest,
      undefined,
    );
  }

  private findPreviousPoint(
    points: LiveMetricPoint[],
    second: number,
  ): LiveMetricPoint | undefined {
    return points
      .filter((point: LiveMetricPoint): boolean => point.second < second)
      .at(-1);
  }

  private cleanRule(rule: string): string {
    return rule.replace(/^DeepSeek 语义判断：/, '');
  }

  private getSourceLabel(provider: LiveDataProvider): string {
    const labels: Record<LiveDataProvider, string> = {
      mock_third_party: '示例第三方数据',
      chanmama: '蝉妈妈',
      kaogujia: '考古加',
      custom_csv: '自定义数据表',
    };
    return labels[provider];
  }

  private formatTime(seconds: number): string {
    const minutes: number = Math.floor(seconds / 60);
    const remainder: number = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }
}
