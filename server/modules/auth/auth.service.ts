import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';

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
  type StandaloneAccountRecord,
  type StandaloneSessionRecord,
} from '@server/modules/standalone-store/standalone-store.service';
import type {
  BootstrapAccountRequest,
  CreateInternalAccountRequest,
  InternalAccountSummary,
  InternalUser,
  LoginRequest,
  UserRole,
} from '@shared/api.interface';

import { AUTH_SESSION_TTL_MS } from './auth.constants';

const ACCOUNT_SOURCE_TYPE = 'internal_account';
const SESSION_SOURCE_TYPE = 'internal_auth_session';

interface AccountDocument {
  username: string;
  displayName: string;
  passwordSalt: string;
  passwordHash: string;
  role: UserRole;
  active: boolean;
}

interface SessionDocument {
  accountId: string;
  expiresAt: string;
}

interface AuthenticatedAccount {
  user: InternalUser;
  token: string;
}

@Injectable()
export class AuthService {
  private readonly logger: Logger = new Logger(AuthService.name);
  private useLocalStore: boolean = false;

  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: PostgresJsDatabase,
    private readonly standaloneStore: StandaloneStoreService,
  ) {}

  async isInitialized(): Promise<boolean> {
    if (this.useLocalStore) {
      return this.standaloneStore.hasAccounts();
    }
    try {
      const rows: Array<{ count: number | string }> = await this.db
        .select({ count: count() })
        .from(ruleDocuments)
        .where(eq(ruleDocuments.sourceType, ACCOUNT_SOURCE_TYPE));
      return Number(rows[0]?.count ?? 0) > 0;
    } catch (error: unknown) {
      if (!this.activateLocalStore(error)) {
        throw error;
      }
      return this.standaloneStore.hasAccounts();
    }
  }

  async bootstrap(
    request: BootstrapAccountRequest,
  ): Promise<AuthenticatedAccount> {
    if (await this.isInitialized()) {
      throw new BusinessException(
        ResponseCode.CONFLICT,
        '系统已经初始化，请直接登录',
      );
    }

    const account: InternalAccountSummary = await this.insertAccount({
      ...request,
      role: 'admin',
    });
    return this.createSession(account);
  }

  async login(request: LoginRequest): Promise<AuthenticatedAccount> {
    const username: string = this.normalizeUsername(request.username);
    if (this.useLocalStore) {
      return this.loginLocally(username, request.password || '');
    }
    const row: typeof ruleDocuments.$inferSelect | undefined =
      await this.findAccountRowByUsername(username);
    if (this.useLocalStore) {
      return this.loginLocally(username, request.password || '');
    }
    const account: AccountDocument | undefined = row
      ? this.parseDocument<AccountDocument>(row.content)
      : undefined;
    const passwordMatches: boolean = account
      ? await this.verifyPassword(
          request.password || '',
          account.passwordSalt,
          account.passwordHash,
        )
      : false;

    if (!row || !account || !account.active || !passwordMatches) {
      throw new BusinessException(
        ResponseCode.UNAUTHORIZED,
        '账号或密码不正确',
      );
    }

    return this.createSession(this.toInternalUser(account, row.id));
  }

  async authenticateToken(token?: string): Promise<InternalUser | undefined> {
    if (!token) {
      return undefined;
    }

    if (this.useLocalStore) {
      return this.authenticateTokenLocally(token);
    }

    try {
      const tokenHash: string = this.hashToken(token);
      const sessionRows: Array<typeof ruleDocuments.$inferSelect> = await this.db
        .select()
        .from(ruleDocuments)
        .where(
          and(
            eq(ruleDocuments.sourceType, SESSION_SOURCE_TYPE),
            eq(ruleDocuments.title, tokenHash),
            eq(ruleDocuments.status, 'active'),
          ),
        )
        .limit(1);
      const sessionRow: typeof ruleDocuments.$inferSelect | undefined =
        sessionRows[0];
      const session: SessionDocument | undefined = sessionRow
        ? this.parseDocument<SessionDocument>(sessionRow.content)
        : undefined;
      if (
        !sessionRow ||
        !session ||
        Date.parse(session.expiresAt) <= Date.now()
      ) {
        if (sessionRow) {
          await this.db
            .delete(ruleDocuments)
            .where(eq(ruleDocuments.id, sessionRow.id));
        }
        return undefined;
      }

      const accountRows: Array<typeof ruleDocuments.$inferSelect> = await this.db
        .select()
        .from(ruleDocuments)
        .where(
          and(
            eq(ruleDocuments.id, session.accountId),
            eq(ruleDocuments.sourceType, ACCOUNT_SOURCE_TYPE),
            eq(ruleDocuments.status, 'active'),
          ),
        )
        .limit(1);
      const accountRow: typeof ruleDocuments.$inferSelect | undefined =
        accountRows[0];
      const account: AccountDocument | undefined = accountRow
        ? this.parseDocument<AccountDocument>(accountRow.content)
        : undefined;
      if (!accountRow || !account?.active) {
        return undefined;
      }

      return this.toInternalUser(account, accountRow.id);
    } catch (error: unknown) {
      if (!this.activateLocalStore(error)) {
        throw error;
      }
      return this.authenticateTokenLocally(token);
    }
  }

  async logout(token?: string): Promise<void> {
    if (!token) {
      return;
    }
    const tokenHash: string = this.hashToken(token);
    if (this.useLocalStore) {
      await this.standaloneStore.deleteSessionsByTokenHash(tokenHash);
      return;
    }
    try {
      await this.db
        .delete(ruleDocuments)
        .where(
          and(
            eq(ruleDocuments.sourceType, SESSION_SOURCE_TYPE),
            eq(ruleDocuments.title, tokenHash),
          ),
        );
    } catch (error: unknown) {
      if (!this.activateLocalStore(error)) {
        throw error;
      }
      await this.standaloneStore.deleteSessionsByTokenHash(tokenHash);
    }
  }

  async createAccount(
    operator: InternalUser,
    request: CreateInternalAccountRequest,
  ): Promise<InternalAccountSummary> {
    if (operator.role !== 'admin') {
      throw new BusinessException(
        ResponseCode.FORBIDDEN,
        '只有管理员可以创建主播账号',
      );
    }
    return this.insertAccount({
      ...request,
      role: request.role === 'admin' ? 'admin' : 'anchor',
    });
  }

  async listAccounts(
    operator: InternalUser,
  ): Promise<InternalAccountSummary[]> {
    if (operator.role !== 'admin') {
      throw new BusinessException(
        ResponseCode.FORBIDDEN,
        '只有管理员可以查看账号',
      );
    }
    if (this.useLocalStore) {
      return this.listAccountsLocally();
    }
    let rows: Array<typeof ruleDocuments.$inferSelect>;
    try {
      rows = await this.db
        .select()
        .from(ruleDocuments)
        .where(eq(ruleDocuments.sourceType, ACCOUNT_SOURCE_TYPE))
        .orderBy(desc(ruleDocuments.createdAt));
    } catch (error: unknown) {
      if (!this.activateLocalStore(error)) {
        throw error;
      }
      return this.listAccountsLocally();
    }

    return rows.flatMap((row: typeof ruleDocuments.$inferSelect) => {
      const account: AccountDocument | undefined =
        this.parseDocument<AccountDocument>(row.content);
      return account ? [this.toAccountSummary(account, row)] : [];
    });
  }

  private async insertAccount(
    request: CreateInternalAccountRequest,
  ): Promise<InternalAccountSummary> {
    const username: string = this.normalizeUsername(request.username);
    const displayName: string = request.displayName?.trim();
    this.validateAccountInput(username, displayName, request.password);
    if (this.useLocalStore) {
      return this.insertAccountLocally({ ...request, username, displayName });
    }
    if (await this.findAccountRowByUsername(username)) {
      throw new BusinessException(
        ResponseCode.CONFLICT,
        '这个登录账号已经被使用',
      );
    }
    if (this.useLocalStore) {
      return this.insertAccountLocally({ ...request, username, displayName });
    }

    const id: string = randomUUID();
    const passwordSalt: string = randomBytes(16).toString('hex');
    const account: AccountDocument = {
      username,
      displayName,
      passwordSalt,
      passwordHash: await this.hashPassword(request.password, passwordSalt),
      role: request.role === 'admin' ? 'admin' : 'anchor',
      active: true,
    };
    const rows: Array<typeof ruleDocuments.$inferSelect> = await this.db
      .insert(ruleDocuments)
      .values({
        id,
        title: username,
        sourceUrl: `internal://accounts/${id}`,
        sourceType: ACCOUNT_SOURCE_TYPE,
        version: '1',
        content: JSON.stringify(account),
        status: 'active',
      })
      .returning();
    return this.toAccountSummary(account, rows[0]);
  }

  private async findAccountRowByUsername(
    username: string,
  ): Promise<typeof ruleDocuments.$inferSelect | undefined> {
    try {
      const rows: Array<typeof ruleDocuments.$inferSelect> = await this.db
        .select()
        .from(ruleDocuments)
        .where(
          and(
            eq(ruleDocuments.sourceType, ACCOUNT_SOURCE_TYPE),
            eq(ruleDocuments.title, username),
          ),
        )
        .limit(1);
      return rows[0];
    } catch (error: unknown) {
      if (!this.activateLocalStore(error)) {
        throw error;
      }
      return undefined;
    }
  }

  private async createSession(
    user: InternalUser,
  ): Promise<AuthenticatedAccount> {
    const sessionUser: InternalUser = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    };
    const id: string = randomUUID();
    const token: string = randomBytes(32).toString('hex');
    const tokenHash: string = this.hashToken(token);
    const session: SessionDocument = {
      accountId: sessionUser.id,
      expiresAt: new Date(Date.now() + AUTH_SESSION_TTL_MS).toISOString(),
    };
    if (this.useLocalStore) {
      await this.standaloneStore.createSession(
        tokenHash,
        session.accountId,
        session.expiresAt,
      );
      return { user: sessionUser, token };
    }
    await this.db.insert(ruleDocuments).values({
      id,
      title: tokenHash,
      sourceUrl: `internal://sessions/${tokenHash}`,
      sourceType: SESSION_SOURCE_TYPE,
      version: '1',
      content: JSON.stringify(session),
      status: 'active',
    });
    return { user: sessionUser, token };
  }

  private async loginLocally(
    username: string,
    password: string,
  ): Promise<AuthenticatedAccount> {
    const account: StandaloneAccountRecord | undefined =
      await this.standaloneStore.findAccountByUsername(username);
    const passwordMatches: boolean = account
      ? await this.verifyPassword(
          password,
          account.passwordSalt,
          account.passwordHash,
        )
      : false;
    if (!account || !account.active || !passwordMatches) {
      throw new BusinessException(
        ResponseCode.UNAUTHORIZED,
        '账号或密码不正确',
      );
    }
    return this.createSession(this.toLocalInternalUser(account));
  }

  private async authenticateTokenLocally(
    token: string,
  ): Promise<InternalUser | undefined> {
    const session: StandaloneSessionRecord | undefined =
      await this.standaloneStore.findSessionByTokenHash(this.hashToken(token));
    if (!session || Date.parse(session.expiresAt) <= Date.now()) {
      if (session) {
        await this.standaloneStore.deleteSession(session.id);
      }
      return undefined;
    }
    const account: StandaloneAccountRecord | undefined =
      await this.standaloneStore.findAccountById(session.accountId);
    return account?.active ? this.toLocalInternalUser(account) : undefined;
  }

  private async insertAccountLocally(
    request: CreateInternalAccountRequest,
  ): Promise<InternalAccountSummary> {
    if (await this.standaloneStore.findAccountByUsername(request.username)) {
      throw new BusinessException(
        ResponseCode.CONFLICT,
        '这个登录账号已经被使用',
      );
    }
    const passwordSalt: string = randomBytes(16).toString('hex');
    const account: StandaloneAccountRecord =
      await this.standaloneStore.insertAccount({
        username: request.username,
        displayName: request.displayName.trim(),
        passwordSalt,
        passwordHash: await this.hashPassword(
          request.password,
          passwordSalt,
        ),
        role: request.role === 'admin' ? 'admin' : 'anchor',
        active: true,
      });
    return this.toLocalAccountSummary(account);
  }

  private async listAccountsLocally(): Promise<InternalAccountSummary[]> {
    return (await this.standaloneStore.listAccounts()).map(
      (account: StandaloneAccountRecord): InternalAccountSummary =>
        this.toLocalAccountSummary(account),
    );
  }

  private activateLocalStore(error: unknown): boolean {
    if (!this.standaloneStore.isEnabled()) {
      return false;
    }
    if (!this.useLocalStore) {
      this.logger.warn(
        `PostgreSQL 当前不可用，本地独立模式已切换到持久化存储：${
          error instanceof Error ? error.name : 'database_error'
        }`,
      );
    }
    this.useLocalStore = true;
    return true;
  }

  private validateAccountInput(
    username: string,
    displayName: string,
    password: string,
  ): void {
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
      throw new BusinessException(
        ResponseCode.VALIDATION_ERROR,
        '登录账号需要 3-32 位，只能使用字母、数字、点、下划线或短横线',
      );
    }
    if (!displayName || displayName.length > 40) {
      throw new BusinessException(
        ResponseCode.VALIDATION_ERROR,
        '主播名称需要 1-40 个字符',
      );
    }
    if (!password || password.length < 8 || password.length > 128) {
      throw new BusinessException(
        ResponseCode.VALIDATION_ERROR,
        '密码需要 8-128 个字符',
      );
    }
  }

  private normalizeUsername(username?: string): string {
    return (username || '').trim().toLowerCase();
  }

  private hashPassword(password: string, salt: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      scrypt(password, salt, 64, (error, derivedKey: Buffer) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey.toString('hex'));
      });
    });
  }

  private async verifyPassword(
    password: string,
    salt: string,
    expectedHash: string,
  ): Promise<boolean> {
    const actual: Buffer = Buffer.from(
      await this.hashPassword(password, salt),
      'hex',
    );
    const expected: Buffer = Buffer.from(expectedHash, 'hex');
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseDocument<T>(content: string): T | undefined {
    try {
      return JSON.parse(content) as T;
    } catch {
      return undefined;
    }
  }

  private toInternalUser(account: AccountDocument, id: string): InternalUser {
    return {
      id,
      username: account.username,
      displayName: account.displayName,
      role: account.role === 'admin' ? 'admin' : 'anchor',
    };
  }

  private toLocalInternalUser(account: StandaloneAccountRecord): InternalUser {
    return {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      role: account.role === 'admin' ? 'admin' : 'anchor',
    };
  }

  private toLocalAccountSummary(
    account: StandaloneAccountRecord,
  ): InternalAccountSummary {
    return {
      ...this.toLocalInternalUser(account),
      active: account.active,
      createdAt: account.createdAt,
    };
  }

  private toAccountSummary(
    account: AccountDocument,
    row: typeof ruleDocuments.$inferSelect,
  ): InternalAccountSummary {
    return {
      ...this.toInternalUser(account, row.id),
      active: account.active,
      createdAt: this.toDate(row.createdAt).toISOString(),
    };
  }

  private toDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
  }
}
