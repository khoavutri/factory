import { db } from '../db/database';
import { newId } from '../utils/ids';
import { nowIso } from '../utils/format';
import type { Actor, ActivityLog, OperationReceipt } from '../types';
import { assertPermission, type Action } from './permissions';
import { BusinessError } from './errors';

/** Tiền tố mã chứng từ theo loại */
export const DOC_PREFIX: Record<string, string> = {
  SALES_ORDER: 'DH',
  WORK_ORDER: 'LSX',
  PRODUCTION_LOG: 'SL',
  QC_CHECK: 'QC',
  MATERIAL_RECEIPT: 'PN',
  MATERIAL_ISSUE: 'PX',
  DELIVERY: 'GH',
  PAYROLL_PERIOD: 'LK',
};

export function assertAction(actor: Actor, action: Action, message?: string): void {
  assertPermission(actor.role, action, message);
}

/**
 * Cấp số chứng từ kế tiếp theo loại và kỳ (mặc định là năm hiện tại).
 * Phải được gọi bên trong transaction cùng thao tác ghi.
 */
export async function nextCode(documentType: string, period?: string): Promise<string> {
  const p = period ?? String(new Date().getFullYear());
  const id = `${documentType}::${p}`;
  const existing = await db.documentSequences.get(id);
  const next = existing?.nextValue ?? 1;
  await db.documentSequences.put({ id, documentType, period: p, nextValue: next + 1 });
  const prefix = DOC_PREFIX[documentType] ?? documentType;
  return `${prefix}-${p}-${String(next).padStart(4, '0')}`;
}

/** Đọc kết quả thao tác trước đó theo operationId (chống ghi trùng) */
export async function getOperationReceipt(operationId?: string): Promise<OperationReceipt | undefined> {
  if (!operationId) return undefined;
  return db.operationReceipts.get(operationId);
}

export async function saveOperationReceipt(
  operationId: string | undefined,
  operationType: string,
  resultEntityIds: string[],
  summary?: string,
): Promise<void> {
  if (!operationId) return;
  const receipt: OperationReceipt = {
    id: operationId,
    operationType,
    resultEntityIds,
    completedAt: nowIso(),
    summary,
  };
  await db.operationReceipts.put(receipt);
}

export interface LogInput {
  entityType: string;
  entityId: string;
  action: string;
  actor?: Actor;
  summary: string;
  changes?: Record<string, unknown>;
  operationId?: string;
  at?: string;
  id?: string;
}

export async function logActivity(input: LogInput): Promise<void> {
  const record: ActivityLog = {
    id: input.id ?? newId(),
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actorId: input.actor?.employeeId,
    actorName: input.actor?.name,
    at: input.at ?? nowIso(),
    summary: input.summary,
    changes: input.changes,
    operationId: input.operationId,
  };
  await db.activityLogs.add(record);
}

/** So khớp phiên bản để phát hiện ghi đè khi mở nhiều tab */
export function assertRevision(current: number | undefined, expected: number | undefined, message?: string): void {
  if (expected == null || current == null) return;
  if (current !== expected) {
    throw new BusinessError(
      message ?? 'Bản ghi đã được thay đổi ở nơi khác trong lúc bạn đang mở. Hãy tải lại dữ liệu trước khi ghi để tránh ghi đè.',
      'STALE_REVISION',
    );
  }
}

export function registerSeedFlag(flag: 'seeding') {
  // Cờ trong localStorage giúp tránh seed trùng khi nhiều tab mở cùng lúc.
  localStorage.setItem(`factory.${flag}`, '1');
}

export function clearSeedFlag(flag: 'seeding') {
  localStorage.removeItem(`factory.${flag}`);
}
