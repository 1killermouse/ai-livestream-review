import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, count, desc, eq } from 'drizzle-orm';

import { ResponseCode } from '@server/common/constants/api_response_code';
import { BusinessException } from '@server/common/interfaces/exception.interface';
import { ruleDocuments } from '@server/database/schema';
import {
  StandaloneStoreService,
  type StandaloneReportRecord,
} from '@server/modules/standalone-store/standalone-store.service';
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
  private readonly logger: Logger = new Logger(HistoryService.name);
  private useLocalStore: boolean = false;

  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: PostgresJsDatabase,
    private readonly standaloneStore: StandaloneStoreService,
  ) {}

  async saveReport(
    ownerId: string,
    report: PrototypeAnalysisReport,
  ): Promise<PrototypeAnalysisReport> {
    if (this.useLocalStore) {
      return this.standaloneStore.saveReport(ownerId, report);
    }
    const id: string = randomUUID();
    const snapshot: PrototypeAnalysisReport = { ...report, id };
    try {
      await this.db.insert(ruleDocuments).values({
        id,
        title: snapshot.title.slice(0, 240),
        sourceUrl: `internal://reports/${id}`,
        sourceType: REPORT_SOURCE_TYPE,
        version: ownerId,
        content: JSON.stringify(snapshot),
        status: 'active',
      });
    } catch (error: unknown) {
      if (!this.activateLocalStore(error)) {
        throw error;
      }
      return this.standaloneStore.saveReport(ownerId, report);
    }
    return snapshot;
  }

  async listReports(user: InternalUser): Promise<HistoryReportListResponse> {
    if (this.useLocalStore) {
      return this.listReportsLocally(user);
    }
    const reportFilter =
      user.role === 'admin'
        ? eq(ruleDocuments.sourceType, REPORT_SOURCE_TYPE)
        : and(
            eq(ruleDocuments.sourceType, REPORT_SOURCE_TYPE),
            eq(ruleDocuments.version, user.id),
          );
    let rows: Array<typeof ruleDocuments.$inferSelect>;
    let totalRows: Array<{ count: number | string }>;
    let owners: Map<string, ReportOwner>;
    try {
      rows = await this.db
        .select()
        .from(ruleDocuments)
        .where(reportFilter)
        .orderBy(desc(ruleDocuments.createdAt))
        .limit(100);
      totalRows = await this.db
        .select({ count: count() })
        .from(ruleDocuments)
        .where(reportFilter);
      owners = await this.loadOwners();
    } catch (error: unknown) {
      if (!this.activateLocalStore(error)) {
        throw error;
      }
      return this.listReportsLocally(user);
    }
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
    if (this.useLocalStore) {
      return this.getReportLocally(user, id);
    }
    let rows: Array<typeof ruleDocuments.$inferSelect>;
    try {
      rows = await this.db
        .select()
        .from(ruleDocuments)
        .where(
          and(
            eq(ruleDocuments.id, id),
            eq(ruleDocuments.sourceType, REPORT_SOURCE_TYPE),
          ),
        )
        .limit(1);
    } catch (error: unknown) {
      if (!this.activateLocalStore(error)) {
        throw error;
      }
      return this.getReportLocally(user, id);
    }
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

  private async listReportsLocally(
    user: InternalUser,
  ): Promise<HistoryReportListResponse> {
    const reports: StandaloneReportRecord[] = (
      await this.standaloneStore.listReports()
    ).filter(
      (record: StandaloneReportRecord): boolean =>
        user.role === 'admin' || record.ownerId === user.id,
    );
    const owners: Map<string, ReportOwner> = await this.loadLocalOwners();
    return {
      items: reports.slice(0, 100).map(
        (record: StandaloneReportRecord): HistoryReportSummary => ({
          id: record.id,
          title: record.report.title,
          inputSource: record.report.inputSource,
          durationSeconds: record.report.durationSeconds,
          transcriptWordCount: record.report.transcriptWordCount,
          frameworkName: record.report.frameworkName,
          score: calculateReportScore(record.report),
          totalFindings: record.report.summary.totalFindings,
          highRiskFindings: record.report.summary.highRiskFindings,
          createdAt: record.createdAt,
          owner: owners.get(record.ownerId) || {
            id: record.ownerId,
            username: '未知账号',
            displayName: '未知主播',
          },
        }),
      ),
      total: reports.length,
    };
  }

  private async getReportLocally(
    user: InternalUser,
    id: string,
  ): Promise<HistoryReportDetail> {
    const record: StandaloneReportRecord | undefined =
      await this.standaloneStore.findReport(id);
    if (
      !record ||
      (user.role !== 'admin' && record.ownerId !== user.id)
    ) {
      throw new BusinessException(
        ResponseCode.NOT_FOUND,
        '没有找到这份历史复盘',
      );
    }
    const owners: Map<string, ReportOwner> = await this.loadLocalOwners();
    return {
      report: { ...record.report, id: record.id },
      createdAt: record.createdAt,
      owner: owners.get(record.ownerId) || {
        id: record.ownerId,
        username: '未知账号',
        displayName: '未知主播',
      },
    };
  }

  private async loadLocalOwners(): Promise<Map<string, ReportOwner>> {
    const owners: Map<string, ReportOwner> = new Map<string, ReportOwner>();
    for (const account of await this.standaloneStore.listAccounts()) {
      owners.set(account.id, {
        id: account.id,
        username: account.username,
        displayName: account.displayName,
      });
    }
    return owners;
  }

  private activateLocalStore(error: unknown): boolean {
    if (!this.standaloneStore.isEnabled()) {
      return false;
    }
    if (!this.useLocalStore) {
      this.logger.warn(
        `PostgreSQL 当前不可用，历史报告已切换到本地持久化：${
          error instanceof Error ? error.name : 'database_error'
        }`,
      );
    }
    this.useLocalStore = true;
    return true;
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
