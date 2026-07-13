/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, numeric, pgTable, text, uniqueIndex, uuid, varchar, customType } from "drizzle-orm/pg-core"

export const customTimestamptz = customType<{
  data: Date;
  driverData: string;
  config: { precision?: number };
}>({
  dataType(config) {
    const precision = typeof config?.precision !== 'undefined'
      ? ` (${config.precision})`
      : '';
    return `timestamptz${precision}`;
  },
  toDriver(value: Date | string | number) {
    if (value == null) return value as any;
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    throw new Error('Invalid timestamp value');
  },
  fromDriver(value: string | Date): Date {
    if (value instanceof Date) return value;
    return new Date(value);
  },
});

export const userProfile = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'user_profile';
  },
  toDriver(value: string) {
    return sql`ROW(${value})::user_profile`;
  },
  fromDriver(value: string) {
    const [userId] = value.slice(1, -1).split(',');
    return userId.trim();
  },
});

export type FileAttachment = {
  bucket_id: string;
  file_path: string;
};

export const fileAttachment = customType<{
  data: FileAttachment;
  driverData: string;
}>({
  dataType() {
    return 'file_attachment';
  },
  toDriver(value: FileAttachment) {
    return sql`ROW(${value.bucket_id},${value.file_path})::file_attachment`;
  },
  fromDriver(value: string): FileAttachment {
    const [bucketId, filePath] = value.slice(1, -1).split(',');
    return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
  },
});

export function escapeLiteral(str: string): string {
  return "'" + str.replace(/'/g, "''") + "'";
}

export const userProfileArray = customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'user_profile[]';
  },
  toDriver(value: string[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::user_profile[]`;
    }
    const elements = value.map(id => `ROW(${escapeLiteral(id)})::user_profile`).join(',');
    return sql.raw(`ARRAY[${elements}]::user_profile[]`);
  },
  fromDriver(value: string): string[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => m.slice(1, -1).split(',')[0].trim());
  },
});

export const fileAttachmentArray = customType<{
  data: FileAttachment[];
  driverData: string;
}>({
  dataType() {
    return 'file_attachment[]';
  },
  toDriver(value: FileAttachment[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::file_attachment[]`;
    }
    const elements = value.map(f =>
      `ROW(${escapeLiteral(f.bucket_id)},${escapeLiteral(f.file_path)})::file_attachment`
    ).join(',');
    return sql.raw(`ARRAY[${elements}]::file_attachment[]`);
  },
  fromDriver(value: string): FileAttachment[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => {
      const [bucketId, filePath] = m.slice(1, -1).split(',');
      return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
    });
  },
});

export const reviewFindings = pgTable("review_findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull(),
  segmentId: uuid("segment_id"),
  findingType: varchar("finding_type", { length: 24 }).notNull(),
  riskLevel: varchar("risk_level", { length: 16 }).notNull().default('medium'),
  occurredAtSeconds: integer("occurred_at_seconds").notNull(),
  originalText: text("original_text"),
  ruleDocumentId: uuid("rule_document_id"),
  ruleExcerpt: text("rule_excerpt"),
  analysis: text("analysis").notNull(),
  suggestion: text("suggestion"),
  confidence: numeric("confidence").notNull().default('0'),
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  createdAt: customTimestamptz("created_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("review_findings_session_time_idx").on(table.sessionId, table.occurredAtSeconds),
  foreignKey({
    columns: [table.sessionId],
    foreignColumns: [liveSessions.id],
    name: "review_findings_session_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.segmentId],
    foreignColumns: [transcriptSegments.id],
    name: "review_findings_segment_id_fkey",
  }).onDelete("set null"),
  foreignKey({
    columns: [table.ruleDocumentId],
    foreignColumns: [ruleDocuments.id],
    name: "review_findings_rule_document_id_fkey",
  }).onDelete("set null"),
]);

export const ruleDocuments = pgTable("rule_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 240 }).notNull(),
  sourceUrl: text("source_url"),
  sourceType: varchar("source_type", { length: 32 }).notNull().default('script_framework'),
  version: varchar("version", { length: 64 }),
  effectiveAt: customTimestamptz("effective_at", { precision: 6 }),
  content: text("content").notNull(),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  createdAt: customTimestamptz("created_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("updated_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const transcriptSegments = pgTable("transcript_segments", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull(),
  startSeconds: integer("start_seconds").notNull(),
  endSeconds: integer("end_seconds").notNull(),
  phase: varchar("phase", { length: 24 }).notNull().default('unknown'),
  content: text("content").notNull(),
  createdAt: customTimestamptz("created_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("transcript_segments_session_time_idx").on(table.sessionId, table.startSeconds),
  foreignKey({
    columns: [table.sessionId],
    foreignColumns: [liveSessions.id],
    name: "transcript_segments_session_id_fkey",
  }).onDelete("cascade"),
]);

export const liveSessions = pgTable("live_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: userProfile("owner_id").notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  liveStartedAt: customTimestamptz("live_started_at", { precision: 6 }),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  status: varchar("status", { length: 24 }).notNull().default('draft'),
  inputSource: varchar("traffic_source", { length: 24 }).notNull().default('live_url'),
  createdAt: customTimestamptz("created_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("updated_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("live_sessions_owner_idx").on(table.ownerId, table.createdAt),
]);

export const userRoles = pgTable("user_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userProfile("user_id").notNull().unique(),
  role: varchar("role", { length: 20 }).notNull().default('anchor'),
  createdAt: customTimestamptz("created_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("updated_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("user_roles_user_id_key").on(table.userId),
]);

// table aliases
export const liveSessionsTable = liveSessions;
export const reviewFindingsTable = reviewFindings;
export const ruleDocumentsTable = ruleDocuments;
export const transcriptSegmentsTable = transcriptSegments;
export const userRolesTable = userRoles;
