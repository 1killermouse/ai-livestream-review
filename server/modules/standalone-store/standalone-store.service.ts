import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { Injectable } from '@nestjs/common';

import type { PrototypeAnalysisReport, UserRole } from '@shared/api.interface';

export interface StandaloneAccountRecord {
  id: string;
  username: string;
  displayName: string;
  passwordSalt: string;
  passwordHash: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
}

export interface StandaloneSessionRecord {
  id: string;
  tokenHash: string;
  accountId: string;
  expiresAt: string;
}

export interface StandaloneReportRecord {
  id: string;
  ownerId: string;
  report: PrototypeAnalysisReport;
  createdAt: string;
}

interface StandaloneData {
  version: 1;
  accounts: StandaloneAccountRecord[];
  sessions: StandaloneSessionRecord[];
  reports: StandaloneReportRecord[];
}

@Injectable()
export class StandaloneStoreService {
  private writeQueue: Promise<void> = Promise.resolve();

  isEnabled(): boolean {
    return process.env.STANDALONE_LOCAL_DEV === '1';
  }

  async hasAccounts(): Promise<boolean> {
    return (await this.read()).accounts.length > 0;
  }

  async findAccountByUsername(
    username: string,
  ): Promise<StandaloneAccountRecord | undefined> {
    return (await this.read()).accounts.find(
      (account: StandaloneAccountRecord): boolean =>
        account.username === username,
    );
  }

  async findAccountById(
    id: string,
  ): Promise<StandaloneAccountRecord | undefined> {
    return (await this.read()).accounts.find(
      (account: StandaloneAccountRecord): boolean => account.id === id,
    );
  }

  async listAccounts(): Promise<StandaloneAccountRecord[]> {
    return (await this.read()).accounts.sort(
      (
        left: StandaloneAccountRecord,
        right: StandaloneAccountRecord,
      ): number => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    );
  }

  async insertAccount(
    account: Omit<StandaloneAccountRecord, 'id' | 'createdAt'>,
  ): Promise<StandaloneAccountRecord> {
    return this.mutate((data: StandaloneData): StandaloneAccountRecord => {
      if (
        data.accounts.some(
          (candidate: StandaloneAccountRecord): boolean =>
            candidate.username === account.username,
        )
      ) {
        throw new Error('duplicate_account');
      }
      const stored: StandaloneAccountRecord = {
        ...account,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      data.accounts.push(stored);
      return stored;
    });
  }

  async createSession(
    tokenHash: string,
    accountId: string,
    expiresAt: string,
  ): Promise<void> {
    await this.mutate((data: StandaloneData): void => {
      data.sessions = data.sessions.filter(
        (session: StandaloneSessionRecord): boolean =>
          Date.parse(session.expiresAt) > Date.now(),
      );
      data.sessions.push({
        id: randomUUID(),
        tokenHash,
        accountId,
        expiresAt,
      });
    });
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<StandaloneSessionRecord | undefined> {
    return (await this.read()).sessions.find(
      (session: StandaloneSessionRecord): boolean =>
        session.tokenHash === tokenHash,
    );
  }

  async deleteSessionsByTokenHash(tokenHash: string): Promise<void> {
    await this.mutate((data: StandaloneData): void => {
      data.sessions = data.sessions.filter(
        (session: StandaloneSessionRecord): boolean =>
          session.tokenHash !== tokenHash,
      );
    });
  }

  async deleteSession(id: string): Promise<void> {
    await this.mutate((data: StandaloneData): void => {
      data.sessions = data.sessions.filter(
        (session: StandaloneSessionRecord): boolean => session.id !== id,
      );
    });
  }

  async saveReport(
    ownerId: string,
    report: PrototypeAnalysisReport,
  ): Promise<PrototypeAnalysisReport> {
    return this.mutate((data: StandaloneData): PrototypeAnalysisReport => {
      const id: string = randomUUID();
      const snapshot: PrototypeAnalysisReport = { ...report, id };
      data.reports.push({
        id,
        ownerId,
        report: snapshot,
        createdAt: new Date().toISOString(),
      });
      return snapshot;
    });
  }

  async listReports(): Promise<StandaloneReportRecord[]> {
    return (await this.read()).reports.sort(
      (
        left: StandaloneReportRecord,
        right: StandaloneReportRecord,
      ): number => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    );
  }

  async findReport(id: string): Promise<StandaloneReportRecord | undefined> {
    return (await this.read()).reports.find(
      (report: StandaloneReportRecord): boolean => report.id === id,
    );
  }

  private async read(): Promise<StandaloneData> {
    await this.writeQueue;
    return this.readFile();
  }

  private async mutate<T>(
    mutation: (data: StandaloneData) => T,
  ): Promise<T> {
    let result: T | undefined;
    let mutationError: unknown;
    this.writeQueue = this.writeQueue.then(async (): Promise<void> => {
      try {
        const data: StandaloneData = await this.readFile();
        result = mutation(data);
        await this.writeFile(data);
      } catch (error: unknown) {
        mutationError = error;
      }
    });
    await this.writeQueue;
    if (mutationError) {
      throw mutationError;
    }
    return result as T;
  }

  private async readFile(): Promise<StandaloneData> {
    try {
      const content: string = await fs.readFile(this.getFilePath(), 'utf8');
      const parsed = JSON.parse(content) as Partial<StandaloneData>;
      return {
        version: 1,
        accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        reports: Array.isArray(parsed.reports) ? parsed.reports : [],
      };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return this.emptyData();
      }
      throw error;
    }
  }

  private async writeFile(data: StandaloneData): Promise<void> {
    const filePath: string = this.getFilePath();
    const temporaryPath: string = `${filePath}.tmp`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(temporaryPath, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(temporaryPath, filePath);
  }

  private getFilePath(): string {
    return path.resolve(
      process.cwd(),
      process.env.STANDALONE_STORE_PATH || '.local/standalone-data.json',
    );
  }

  private emptyData(): StandaloneData {
    return { version: 1, accounts: [], sessions: [], reports: [] };
  }
}
