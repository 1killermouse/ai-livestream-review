import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { count, eq } from 'drizzle-orm';

import { userRoles } from '@server/database/schema';
import { ResponseCode } from '@server/common/constants/api_response_code';
import { BusinessException } from '@server/common/interfaces/exception.interface';
import type { AccessProfile, UserRole } from '@shared/api.interface';

@Injectable()
export class AccessService {
  private readonly logger: Logger = new Logger(AccessService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: PostgresJsDatabase,
  ) {}

  async getOrCreateProfile(
    userId: string,
    userName: string,
  ): Promise<AccessProfile> {
    const existingRole: UserRole | undefined = await this.findRole(userId);
    if (existingRole) {
      return { userId, userName, role: existingRole };
    }

    const roleCountRows: Array<{ count: number | string }> = await this.db
      .select({ count: count() })
      .from(userRoles);
    const isFirstUser: boolean = Number(roleCountRows[0]?.count ?? 0) === 0;
    const initialRole: UserRole = isFirstUser ? 'admin' : 'anchor';

    try {
      await this.db.insert(userRoles).values({ userId, role: initialRole });
    } catch (error: unknown) {
      this.logger.warn(
        `Role bootstrap raced for user ${userId}: ${String(error)}`,
      );
    }

    const savedRole: UserRole | undefined = await this.findRole(userId);
    return { userId, userName, role: savedRole ?? initialRole };
  }

  async requireAdmin(userId: string, userName: string): Promise<void> {
    const profile: AccessProfile = await this.getOrCreateProfile(
      userId,
      userName,
    );
    if (profile.role === 'admin') {
      return;
    }

    throw new BusinessException(
      ResponseCode.FORBIDDEN,
      '只有管理员可以执行该操作',
    );
  }

  async updateRole(
    operatorId: string,
    operatorName: string,
    targetUserId: string,
    role: UserRole,
  ): Promise<AccessProfile> {
    await this.requireAdmin(operatorId, operatorName);
    const existingRole: UserRole | undefined =
      await this.findRole(targetUserId);

    if (existingRole) {
      await this.db
        .update(userRoles)
        .set({ role, updatedAt: new Date() })
        .where(eq(userRoles.userId, targetUserId));
    } else {
      await this.db.insert(userRoles).values({
        userId: targetUserId,
        role,
      });
    }

    return { userId: targetUserId, userName: '', role };
  }

  private async findRole(userId: string): Promise<UserRole | undefined> {
    const rows: Array<{ role: string }> = await this.db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, userId))
      .limit(1);
    const value: string | undefined = rows[0]?.role;
    return value === 'admin' || value === 'anchor' ? value : undefined;
  }
}
