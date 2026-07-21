import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';

import { StandaloneStoreService } from '@server/modules/standalone-store/standalone-store.service';

import { AuthService } from './auth.service';

describe('AuthService standalone fallback', () => {
  const storePath: string = path.resolve(
    process.cwd(),
    `.local/auth-service-test-${process.pid}.json`,
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

  it('keeps login usable when PostgreSQL is unavailable', async () => {
    const db = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.reject(new Error('expired link'))),
        })),
      })),
    } as unknown as PostgresJsDatabase;
    const service = new AuthService(db, new StandaloneStoreService());

    expect(await service.isInitialized()).toBe(false);
    const authenticated = await service.bootstrap({
      username: 'local.admin',
      displayName: '本地管理员',
      password: 'test-password',
    });

    expect(authenticated.user).toMatchObject({
      username: 'local.admin',
      role: 'admin',
    });
    expect(await service.authenticateToken(authenticated.token)).toEqual(
      authenticated.user,
    );
    expect(
      (await service.login({
        username: 'local.admin',
        password: 'test-password',
      })).user,
    ).toEqual(authenticated.user);
  });
});
