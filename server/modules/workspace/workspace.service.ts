import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { desc, eq } from 'drizzle-orm';

import {
  liveSessions,
  reviewFindings,
  ruleDocuments,
} from '@server/database/schema';
import type {
  AccessProfile,
  CreateSessionRequest,
  FindingType,
  InputSource,
  LiveSessionSummary,
  ReviewFindingSummary,
  RiskLevel,
  SessionStatus,
  WorkspaceOverviewResponse,
} from '@shared/api.interface';

import { AccessService } from '../access/access.service';

interface FindingRow {
  id: string;
  sessionId: string;
  findingType: string;
  riskLevel: string;
  occurredAtSeconds: number;
  originalText: string | null;
  ruleTitle: string | null;
  ruleExcerpt: string | null;
  analysis: string;
  suggestion: string | null;
  confidence: string;
  status: string;
}

@Injectable()
export class WorkspaceService {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: PostgresJsDatabase,
    private readonly accessService: AccessService,
  ) {}

  async getOverview(
    userId: string,
    userName: string,
  ): Promise<WorkspaceOverviewResponse> {
    const access: AccessProfile = await this.accessService.getOrCreateProfile(
      userId,
      userName,
    );
    const sessionRows: Array<typeof liveSessions.$inferSelect> =
      access.role === 'admin'
        ? await this.db
            .select()
            .from(liveSessions)
            .orderBy(desc(liveSessions.createdAt))
            .limit(20)
        : await this.db
            .select()
            .from(liveSessions)
            .where(eq(liveSessions.ownerId, userId))
            .orderBy(desc(liveSessions.createdAt))
            .limit(20);

    const sessionResults: Array<{
      session: LiveSessionSummary;
      findings: ReviewFindingSummary[];
    }> = await Promise.all(
      sessionRows.map(
        async (
          row: typeof liveSessions.$inferSelect,
        ): Promise<{
          session: LiveSessionSummary;
          findings: ReviewFindingSummary[];
        }> => {
          const findings: ReviewFindingSummary[] = await this.loadFindings(
            row.id,
          );
          return {
            session: this.toSessionSummary(row, findings),
            findings,
          };
        },
      ),
    );

    const findings: ReviewFindingSummary[] = sessionResults
      .flatMap(
        (result: {
          session: LiveSessionSummary;
          findings: ReviewFindingSummary[];
        }): ReviewFindingSummary[] => result.findings,
      )
      .slice(0, 8);
    const sessions: LiveSessionSummary[] = sessionResults.map(
      (result: {
        session: LiveSessionSummary;
        findings: ReviewFindingSummary[];
      }): LiveSessionSummary => result.session,
    );

    return {
      access,
      stats: {
        sessions: sessions.length,
        pendingFindings: findings.filter(
          (finding: ReviewFindingSummary): boolean =>
            finding.status === 'pending',
        ).length,
        highRiskFindings: findings.filter(
          (finding: ReviewFindingSummary): boolean =>
            finding.riskLevel === 'critical' || finding.riskLevel === 'high',
        ).length,
        rewriteSuggestions: findings.filter(
          (finding: ReviewFindingSummary): boolean =>
            Boolean(finding.suggestion),
        ).length,
      },
      sessions,
      findings,
    };
  }

  async createSession(
    userId: string,
    request: CreateSessionRequest,
  ): Promise<LiveSessionSummary> {
    const title: string = request.title.trim();
    const liveStartedAt: Date | undefined = request.liveStartedAt
      ? new Date(request.liveStartedAt)
      : undefined;
    const rows: Array<typeof liveSessions.$inferSelect> = await this.db
      .insert(liveSessions)
      .values({
        ownerId: userId,
        title,
        liveStartedAt,
        inputSource: request.inputSource ?? 'live_url',
      })
      .returning();
    return this.toSessionSummary(rows[0], []);
  }

  private async loadFindings(
    sessionId: string,
  ): Promise<ReviewFindingSummary[]> {
    const rows: FindingRow[] = await this.db
      .select({
        id: reviewFindings.id,
        sessionId: reviewFindings.sessionId,
        findingType: reviewFindings.findingType,
        riskLevel: reviewFindings.riskLevel,
        occurredAtSeconds: reviewFindings.occurredAtSeconds,
        originalText: reviewFindings.originalText,
        ruleTitle: ruleDocuments.title,
        ruleExcerpt: reviewFindings.ruleExcerpt,
        analysis: reviewFindings.analysis,
        suggestion: reviewFindings.suggestion,
        confidence: reviewFindings.confidence,
        status: reviewFindings.status,
      })
      .from(reviewFindings)
      .leftJoin(
        ruleDocuments,
        eq(reviewFindings.ruleDocumentId, ruleDocuments.id),
      )
      .where(eq(reviewFindings.sessionId, sessionId))
      .orderBy(desc(reviewFindings.createdAt))
      .limit(20);

    return rows.map(
      (row: FindingRow): ReviewFindingSummary => ({
        id: row.id,
        sessionId: row.sessionId,
        findingType: this.toFindingType(row.findingType),
        riskLevel: this.toRiskLevel(row.riskLevel),
        occurredAtSeconds: row.occurredAtSeconds,
        originalText: row.originalText ?? undefined,
        ruleTitle: row.ruleTitle ?? undefined,
        ruleExcerpt: row.ruleExcerpt ?? undefined,
        analysis: row.analysis,
        suggestion: row.suggestion ?? undefined,
        confidence: Number(row.confidence),
        status:
          row.status === 'confirmed' || row.status === 'dismissed'
            ? row.status
            : 'pending',
      }),
    );
  }

  private toSessionSummary(
    row: typeof liveSessions.$inferSelect,
    findings: ReviewFindingSummary[],
  ): LiveSessionSummary {
    return {
      id: row.id,
      ownerId: row.ownerId,
      title: row.title,
      liveStartedAt: row.liveStartedAt?.toISOString(),
      durationSeconds: row.durationSeconds,
      status: this.toSessionStatus(row.status),
      inputSource: this.toInputSource(row.inputSource),
      findingCount: findings.length,
      highRiskCount: findings.filter(
        (finding: ReviewFindingSummary): boolean =>
          finding.riskLevel === 'critical' || finding.riskLevel === 'high',
      ).length,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toSessionStatus(value: string): SessionStatus {
    if (value === 'processing' || value === 'completed' || value === 'failed') {
      return value;
    }
    return 'draft';
  }

  private toInputSource(value: string): InputSource {
    if (value === 'recording_upload') {
      return 'recording_upload';
    }
    return 'live_url';
  }

  private toFindingType(value: string): FindingType {
    if (value === 'banned_word' || value === 'framework_gap') {
      return value;
    }
    return 'semantic_risk';
  }

  private toRiskLevel(value: string): RiskLevel {
    if (value === 'critical' || value === 'high' || value === 'low') {
      return value;
    }
    return 'medium';
  }
}
