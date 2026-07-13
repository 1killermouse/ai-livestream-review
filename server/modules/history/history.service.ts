import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, count, desc, eq } from 'drizzle-orm';

import { ResponseCode } from '@server/common/constants/api_response_code';
import { BusinessException } from '@server/common/interfaces/exception.interface';
import { ruleDocuments } from '@server/database/schema';
import type {
  HistoryReportDetail,
  HistoryReportListResponse,
  HistoryReportSummary,
  InternalUser,
  PrototypeAnalysisReport,
} from '@shared/api.interface';
import { calculateReportScore } from '@shared/report-score';

const ACCOUNT_SOURCE_TYPE = 'internal_account';
const REPORT_SOURCE_TYPE = 'analysis_report';

interface AccountIdentityDocument {
  username: string;
  displayName: string;
}

interface ReportOwner {
  id: string;
  username: string;
  displayName: string;
}

@Injectable()
export class HistoryService {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: PostgresJsDatabase,
  ) {}

  async saveReport(
    ownerId: string,
    report: PrototypeAnalysisReport,
  ): Promise<PrototypeAnalysisReport> {
    const id: string = randomUUID();
    const snapshot: PrototypeAnalysisReport = { ...report, id };
    await this.db.insert(ruleDocuments).values({
      id,
      title: snapshot.title.slice(0, 240),
      sourceUrl: `internal://reports/${id}`,
      sourceType: REPORT_SOURCE_TYPE,
      version: ownerId,
      content: JSON.stringify(snapshot),
      status: 'active',
    });
    return snapshot;
  }

  async listReports(user: InternalUser): Promise<HistoryReportListResponse> {
    const reportFilter =
      user.role === 'admin'
        ? eq(ruleDocuments.sourceType, REPORT_SOURCE_TYPE)
        : and(
            eq(ruleDocuments.sourceType, REPORT_SOURCE_TYPE),
            eq(ruleDocuments.version, user.id),
          );
    const rows: Array<typeof ruleDocuments.$inferSelect> = await this.db
      .select()
      .from(ruleDocuments)
      .where(reportFilter)
      .orderBy(desc(ruleDocuments.createdAt))
      .limit(100);
    const totalRows: Array<{ count: number | string }> = await this.db
      .select({ count: count() })
      .from(ruleDocuments)
      .where(reportFilter);
    const owners: Map<string, ReportOwner> = await this.loadOwners();
    const items: HistoryReportSummary[] = rows.flatMap(
      (row: typeof ruleDocuments.$inferSelect) => {
        const report: PrototypeAnalysisReport | undefined =
          this.parseDocument<PrototypeAnalysisReport>(row.content);
        if (!report) {
          return [];
        }
        const ownerId: string = row.version || '';
        const owner: ReportOwner = owners.get(ownerId) || {
          id: ownerId,
          username: '未知账号',
          displayName: '未知主播',
        };
        return [
          {
            id: row.id,
            title: report.title,
            inputSource: report.inputSource,
            durationSeconds: report.durationSeconds,
            transcriptWordCount: report.transcriptWordCount,
            frameworkName: report.frameworkName,
            score: calculateReportScore(report),
            totalFindings: report.summary.totalFindings,
            highRiskFindings: report.summary.highRiskFindings,
            createdAt: this.toDate(row.createdAt).toISOString(),
            owner,
          },
        ];
      },
    );

    return {
      items,
      total: Number(totalRows[0]?.count ?? 0),
    };
  }

  async getReport(user: InternalUser, id: string): Promise<HistoryReportDetail> {
    const rows: Array<typeof ruleDocuments.$inferSelect> = await this.db
      .select()
      .from(ruleDocuments)
      .where(
        and(
          eq(ruleDocuments.id, id),
          eq(ruleDocuments.sourceType, REPORT_SOURCE_TYPE),
        ),
      )
      .limit(1);
    const row: typeof ruleDocuments.$inferSelect | undefined = rows[0];
    const ownerId: string = row?.version || '';
    if (!row || (user.role !== 'admin' && ownerId !== user.id)) {
      throw new BusinessException(
        ResponseCode.NOT_FOUND,
        '没有找到这份历史复盘',
      );
    }
    const report: PrototypeAnalysisReport | undefined =
      this.parseDocument<PrototypeAnalysisReport>(row.content);
    if (!report) {
      throw new BusinessException(
        ResponseCode.NOT_FOUND,
        '这份历史复盘暂时无法读取',
      );
    }
    const owners: Map<string, ReportOwner> = await this.loadOwners();
    return {
      report: { ...report, id: row.id },
      createdAt: this.toDate(row.createdAt).toISOString(),
      owner: owners.get(ownerId) || {
        id: ownerId,
        username: '未知账号',
        displayName: '未知主播',
      },
    };
  }

  private async loadOwners(): Promise<Map<string, ReportOwner>> {
    const accountRows: Array<typeof ruleDocuments.$inferSelect> = await this.db
      .select()
      .from(ruleDocuments)
      .where(eq(ruleDocuments.sourceType, ACCOUNT_SOURCE_TYPE));
    const owners: Map<string, ReportOwner> = new Map<string, ReportOwner>();
    for (const row of accountRows) {
      const account: AccountIdentityDocument | undefined =
        this.parseDocument<AccountIdentityDocument>(row.content);
      if (account) {
        owners.set(row.id, {
          id: row.id,
          username: account.username,
          displayName: account.displayName,
        });
      }
    }
    return owners;
  }

  private parseDocument<T>(content: string): T | undefined {
    try {
      return JSON.parse(content) as T;
    } catch {
      return undefined;
    }
  }

  private toDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
  }
}
