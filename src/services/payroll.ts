import { db } from '../db/database';
import { newId } from '../utils/ids';
import { nowIso, toDateKey } from '../utils/format';
import type { Actor, PayrollLine, PayrollPeriod, ProductionLog } from '../types';
import { NotFoundError, assertRule } from './errors';
import { assertAction, getOperationReceipt, logActivity, nextCode, saveOperationReceipt } from './core';

export interface PayrollStageDetail {
  stageId: string;
  stageName: string;
  teamId: string;
  pieceRateVnd: number;
  quantityGood: number;
  quantityBad: number;
  amountVnd: number;
}

export interface PayrollRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  teamId?: string;
  quantityGood: number;
  quantityBad: number;
  logCount: number;
  amountVnd: number;
  details: PayrollStageDetail[];
}

export interface PayrollComputation {
  from: string;
  to: string;
  rows: PayrollRow[];
  totalVnd: number;
  totalGood: number;
  totalBad: number;
  logCount: number;
}

function logDateKey(log: ProductionLog): string {
  return log.date;
}

/** Tính lương khoán theo kỳ: Σ SL tốt theo từng công đoạn × đơn giá công đoạn */
export async function computePayroll(fromIso: string, toIso: string): Promise<PayrollComputation> {
  const fromKey = toDateKey(fromIso);
  const toKey = toDateKey(toIso);
  const [logs, employees, stages] = await Promise.all([
    db.productionLogs.toArray(),
    db.employees.toArray(),
    db.workOrderStages.toArray(),
  ]);
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const inRange = logs.filter((l) => logDateKey(l) >= fromKey && logDateKey(l) <= toKey);

  const byEmployee = new Map<string, PayrollRow>();
  for (const log of inRange) {
    const employee = employeeById.get(log.employeeId);
    const stage = stageById.get(log.stageId);
    if (!employee) continue;
    const row =
      byEmployee.get(employee.id) ??
      ({
        employeeId: employee.id,
        employeeCode: employee.code,
        employeeName: employee.name,
        teamId: employee.teamId,
        quantityGood: 0,
        quantityBad: 0,
        logCount: 0,
        amountVnd: 0,
        details: [],
      } satisfies PayrollRow);
    row.quantityGood += log.quantityGood;
    row.quantityBad += log.quantityBad;
    row.logCount += 1;
    row.amountVnd += log.amountVnd;
    const stageName = stage?.name ?? 'Không xác định';
    const detail =
      row.details.find((d) => d.stageId === log.stageId) ??
      ({
        stageId: log.stageId,
        stageName,
        teamId: log.teamId,
        pieceRateVnd: stage?.pieceRateVnd ?? 0,
        quantityGood: 0,
        quantityBad: 0,
        amountVnd: 0,
      } satisfies PayrollStageDetail);
    detail.quantityGood += log.quantityGood;
    detail.quantityBad += log.quantityBad;
    detail.amountVnd += log.amountVnd;
    if (!row.details.includes(detail)) row.details.push(detail);
    byEmployee.set(employee.id, row);
  }
  const rows = [...byEmployee.values()].sort((a, b) => b.amountVnd - a.amountVnd);
  for (const row of rows) row.details.sort((a, b) => b.amountVnd - a.amountVnd);
  return {
    from: fromIso,
    to: toIso,
    rows,
    totalVnd: rows.reduce((s, r) => s + r.amountVnd, 0),
    totalGood: rows.reduce((s, r) => s + r.quantityGood, 0),
    totalBad: rows.reduce((s, r) => s + r.quantityBad, 0),
    logCount: inRange.length,
  };
}

export async function listPayrollPeriods(): Promise<PayrollPeriod[]> {
  const periods = await db.payrollPeriods.toArray();
  return periods.sort((a, b) => b.periodKey.localeCompare(a.periodKey));
}

export async function findPayrollPeriod(periodKey: string): Promise<PayrollPeriod | undefined> {
  return db.payrollPeriods.where('periodKey').equals(periodKey).first();
}

export async function listPayrollLines(periodId: string): Promise<PayrollLine[]> {
  const lines = await db.payrollLines.where('periodId').equals(periodId).toArray();
  return lines.sort((a, b) => b.amountVnd - a.amountVnd);
}

/** Chốt kỳ lương: lưu snapshot vào payrollLines, kỳ đã chốt không chốt lại */
export async function lockPayrollPeriod(
  actor: Actor,
  input: { periodKey: string; from: string; to: string },
  options: { operationId?: string } = {},
): Promise<PayrollPeriod> {
  assertAction(actor, 'payroll.lock');
  return db.transaction(
    'rw',
    [db.payrollPeriods, db.payrollLines, db.productionLogs, db.employees, db.workOrderStages, db.documentSequences, db.activityLogs, db.operationReceipts],
    async () => {
      const receipt = await getOperationReceipt(options.operationId);
      if (receipt) {
        const found = await db.payrollPeriods.get(receipt.resultEntityIds[0]);
        if (found) return found;
      }
      const existing = await findPayrollPeriod(input.periodKey);
      assertRule(
        !existing || existing.status === 'OPEN',
        `Kỳ lương ${input.periodKey} đã được chốt trước đó (${existing?.code}). Không chốt lại để tránh ghi trùng.`,
        'PERIOD_LOCKED',
      );
      const computation = await computePayroll(input.from, input.to);
      assertRule(computation.rows.length > 0, 'Kỳ này chưa có phiếu sản lượng nào để chốt lương.', 'NO_DATA');
      const now = nowIso();
      const period: PayrollPeriod = existing
        ? { ...existing, status: 'LOCKED', totalVnd: computation.totalVnd, lockedAt: now, revision: existing.revision + 1 }
        : {
            id: newId(),
            code: await nextCode('PAYROLL_PERIOD', input.periodKey),
            periodKey: input.periodKey,
            from: input.from,
            to: input.to,
            status: 'LOCKED',
            totalVnd: computation.totalVnd,
            lockedAt: now,
            createdAt: now,
            createdBy: actor.employeeId,
            revision: 1,
          };
      if (existing) {
        await db.payrollPeriods.put(period);
        const oldLines = await db.payrollLines.where('periodId').equals(period.id).toArray();
        if (oldLines.length > 0) await db.payrollLines.bulkDelete(oldLines.map((l) => l.id));
      } else {
        await db.payrollPeriods.add(period);
      }
      const lines: PayrollLine[] = computation.rows.map((row) => ({
        id: newId(),
        periodId: period.id,
        employeeId: row.employeeId,
        employeeCodeSnapshot: row.employeeCode,
        employeeNameSnapshot: row.employeeName,
        teamIdSnapshot: row.teamId,
        quantityGood: row.quantityGood,
        quantityBad: row.quantityBad,
        amountVnd: row.amountVnd,
      }));
      await db.payrollLines.bulkAdd(lines);
      await logActivity({
        entityType: 'PAYROLL_PERIOD',
        entityId: period.id,
        action: 'LOCKED',
        actor,
        summary: `Chốt lương kỳ ${input.periodKey} (${period.code}) — ${lines.length} nhân viên, tổng ${computation.totalVnd.toLocaleString('vi-VN')} đ`,
        operationId: options.operationId,
      });
      await saveOperationReceipt(options.operationId, 'lockPayrollPeriod', [period.id]);
      return period;
    },
  );
}

/** Chi tiết dòng lương đã chốt (đọc lại snapshot phiếu sản lượng của kỳ) */
export async function lockedLineDetails(period: PayrollPeriod): Promise<Map<string, PayrollStageDetail[]>> {
  const computation = await computePayroll(period.from, period.to);
  return new Map(computation.rows.map((row) => [row.employeeId, row.details]));
}

export async function findPayrollLine(periodId: string, employeeId: string): Promise<PayrollLine | undefined> {
  const lines = await db.payrollLines.where('periodId').equals(periodId).filter((l) => l.employeeId === employeeId).toArray();
  if (lines.length === 0) {
    const period = await db.payrollPeriods.get(periodId);
    if (!period) throw new NotFoundError('Không tìm thấy kỳ lương.');
    throw new NotFoundError(`Không có dòng lương của nhân viên này trong kỳ ${period.periodKey}.`);
  }
  return lines[0];
}
