import type { PrototypeAnalysisReport, RiskLevel } from './api.interface';

export function calculateReportScore(report: PrototypeAnalysisReport): number {
  const riskPenalty: number = report.findings.reduce(
    (total: number, finding): number => {
      const penalty: Record<RiskLevel, number> = {
        critical: 24,
        high: 18,
        medium: 9,
        low: 4,
      };
      return total + penalty[finding.riskLevel];
    },
    0,
  );
  const frameworkPenalty: number = report.frameworkMatches.reduce(
    (total: number, match): number => {
      if (match.status === 'missing') {
        return total + 8;
      }
      if (match.status === 'weak') {
        return total + 4;
      }
      return total;
    },
    0,
  );

  return Math.max(0, Math.min(100, 100 - riskPenalty - frameworkPenalty));
}
