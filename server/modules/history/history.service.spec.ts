import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';

import { StandaloneStoreService } from '@server/modules/standalone-store/standalone-store.service';
import type { InternalUser, PrototypeAnalysisReport } from '@shared/api.interface';

import { HistoryService } from './history.service';

describe('HistoryService standalone fallback', () => {
  const storePath: string = path.resolve(
    process.cwd(),
    `.local/history-service-test-${process.pid}.json`,
  );
  const originalStandaloneMode: string | undefined =
    process.env.STANDALONE_LOCAL_DEV;
  const originalStorePath: string | undefined =
    process.env.STANDALONE_STORE_PATH;

  beforeEach(async () => {
    process.env.STANDALONE_LOCAL_DEV = '1';
    process.env.STANDALONE_STORE_PATH = storePath;
    await fs.rm(storePath, { force: true });
  });

  afterAll(async () => {
    await fs.rm(storePath, { force: true });
    if (originalStandaloneMode === undefined) {
      delete process.env.STANDALONE_LOCAL_DEV;
    } else {
      process.env.STANDALONE_LOCAL_DEV = originalStandaloneMode;
    }
    if (originalStorePath === undefined) {
      delete process.env.STANDALONE_STORE_PATH;
    } else {
      process.env.STANDALONE_STORE_PATH = originalStorePath;
    }
  });

  it('persists and authorizes report history when PostgreSQL is unavailable', async () => {
    const store = new StandaloneStoreService();
    const account = await store.insertAccount({
      username: 'anchor.one',
      displayName: '主播一号',
      passwordSalt: 'salt',
      passwordHash: 'hash',
      role: 'anchor',
      active: true,
    });
    const db = {
      insert: jest.fn(() => ({
        values: jest.fn(() => Promise.reject(new Error('expired link'))),
      })),
    } as unknown as PostgresJsDatabase;
    const service = new HistoryService(db, store);
    const owner: InternalUser = {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      role: 'anchor',
    };

    const saved = await service.saveReport(owner.id, createReport());
    const list = await service.listReports(owner);
    const detail = await service.getReport(owner, saved.id);

    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({
      id: saved.id,
      owner: { displayName: '主播一号' },
    });
    expect(detail.report.id).toBe(saved.id);
    await expect(
      service.getReport(
        {
          id: 'another-anchor',
          username: 'anchor.two',
          displayName: '主播二号',
          role: 'anchor',
        },
        saved.id,
      ),
    ).rejects.toThrow('没有找到这份历史复盘');
  });
});

function createReport(): PrototypeAnalysisReport {
  return {
    id: 'draft-report',
    title: '本地历史报告',
    inputSource: 'recording_upload',
    durationSeconds: 120,
    transcriptWordCount: 80,
    frameworkName: 'AI 知识付费直播全场转化框架',
    summary: {
      totalFindings: 0,
      highRiskFindings: 0,
      rewriteSuggestions: 0,
      overallDiagnosis: '整体表达清楚。',
    },
    transcriptSegments: [],
    findings: [],
    frameworkMatches: [],
    reviewScript: '保留真实方法，说明执行边界。',
    ragReferences: [],
    agentTrace: [],
  };
}
