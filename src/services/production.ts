import { db } from '../db/database';
import { newId } from '../utils/ids';
import { nowIso, todayKey } from '../utils/format';
import { lineAmountVnd, roundQty } from '../utils/money';
import type {
  Actor,
  DefectType,
  ProductionLog,
  QcCheck,
  QcResult,
  ShiftId,
  WorkOrder,
  WorkOrderStage,
} from '../types';
import { NotFoundError, assertRule } from './errors';
import { assertAction, getOperationReceipt, logActivity, nextCode, saveOperationReceipt } from './core';
import { increaseProductStock } from './inventory';
import { recalcSalesOrderStatus } from './salesOrders';

// ---------- Công đoạn của lệnh sản xuất ----------

export async function listWorkOrderStages(workOrderId: string): Promise<WorkOrderStage[]> {
  const stages = await db.workOrderStages.where('workOrderId').equals(workOrderId).toArray();
  return stages.sort((a, b) => a.seq - b.seq);
}

/** Công đoạn đang chạy (hoặc bước kế tiếp nếu chưa bắt đầu bước nào) */
export async function currentStage(workOrderId: string): Promise<WorkOrderStage | undefined> {
  const stages = await listWorkOrderStages(workOrderId);
  return stages.find((s) => s.status === 'IN_PROGRESS') ?? stages.find((s) => s.status === 'PENDING') ?? stages[stages.length - 1];
}

export async function startWorkOrderStage(
  actor: Actor,
  workOrderId: string,
  stageId: string,
  options: { operationId?: string } = {},
): Promise<WorkOrderStage> {
  assertAction(actor, 'workorder.update');
  return db.transaction('rw', [db.workOrders, db.workOrderStages, db.activityLogs, db.operationReceipts], async () => {
    const receipt = await getOperationReceipt(options.operationId);
    if (receipt) {
      const found = await db.workOrderStages.get(receipt.resultEntityIds[0]);
      if (found) return found;
    }
    const workOrder = await db.workOrders.get(workOrderId);
    if (!workOrder) throw new NotFoundError('Không tìm thấy lệnh sản xuất.');
    assertRule(
      workOrder.status === 'WAITING' || workOrder.status === 'IN_PROGRESS',
      'Lệnh đang chờ QC, đã hoàn thành hoặc đã huỷ — không thể bắt đầu công đoạn.',
      'INVALID_STATE',
    );
    const stages = await listWorkOrderStages(workOrderId);
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) throw new NotFoundError('Không tìm thấy công đoạn của lệnh.');
    assertRule(stage.status === 'PENDING', `Công đoạn "${stage.name}" đã bắt đầu hoặc đã xong.`, 'INVALID_STATE');
    const previous = stages.filter((s) => s.seq < stage.seq);
    assertRule(
      previous.every((s) => s.status === 'DONE'),
      `Còn công đoạn trước chưa xong (${previous.filter((s) => s.status !== 'DONE').map((s) => s.name).join(', ')}). Hoàn thành theo thứ tự công nghệ.`,
      'STAGE_ORDER',
    );
    const now = nowIso();
    const updated: WorkOrderStage = { ...stage, status: 'IN_PROGRESS', startedAt: now };
    await db.workOrderStages.put(updated);
    if (workOrder.status === 'WAITING') {
      await db.workOrders.put({ ...workOrder, status: 'IN_PROGRESS', startedAt: now, updatedAt: now, revision: workOrder.revision + 1 });
    }
    await logActivity({
      entityType: 'WORK_ORDER',
      entityId: workOrderId,
      action: 'STAGE_STARTED',
      actor,
      summary: `Bắt đầu công đoạn "${stage.name}" (bước ${stage.seq}) của lệnh ${workOrder.code}`,
      operationId: options.operationId,
    });
    await saveOperationReceipt(options.operationId, 'startStage', [stage.id]);
    return updated;
  });
}

export async function completeWorkOrderStage(
  actor: Actor,
  workOrderId: string,
  stageId: string,
  options: { operationId?: string } = {},
): Promise<{ stage: WorkOrderStage; workOrder: WorkOrder; nextStage?: WorkOrderStage }> {
  assertAction(actor, 'workorder.update');
  return db.transaction(
    'rw',
    [db.workOrders, db.workOrderStages, db.productionLogs, db.activityLogs, db.operationReceipts],
    async () => {
      const receipt = await getOperationReceipt(options.operationId);
      if (receipt) {
        const stageRow = await db.workOrderStages.get(receipt.resultEntityIds[0]);
        const orderRow = await db.workOrders.get(workOrderId);
        if (stageRow && orderRow) {
          const stages = await listWorkOrderStages(workOrderId);
          return { stage: stageRow, workOrder: orderRow, nextStage: stages.find((s) => s.seq > stageRow.seq) };
        }
      }
      const workOrder = await db.workOrders.get(workOrderId);
      if (!workOrder) throw new NotFoundError('Không tìm thấy lệnh sản xuất.');
      const stages = await listWorkOrderStages(workOrderId);
      const stage = stages.find((s) => s.id === stageId);
      if (!stage) throw new NotFoundError('Không tìm thấy công đoạn của lệnh.');
      assertRule(stage.status === 'IN_PROGRESS', `Chỉ hoàn thành được công đoạn đang làm. Công đoạn "${stage.name}" đang ở trạng thái "${stage.status}".`, 'INVALID_STATE');
      const logs = await db.productionLogs.where('stageId').equals(stageId).toArray();
      const goodTotal = logs.reduce((s, l) => s + l.quantityGood, 0);
      assertRule(
        goodTotal > 0,
        `Công đoạn "${stage.name}" chưa có phiếu sản lượng nào. Ghi sản lượng trước khi hoàn thành công đoạn.`,
        'NO_PRODUCTION_LOG',
      );
      const now = nowIso();
      const updated: WorkOrderStage = { ...stage, status: 'DONE', finishedAt: now };
      await db.workOrderStages.put(updated);
      const nextStage = stages.find((s) => s.seq > stage.seq);
      let orderUpdate: WorkOrder = { ...workOrder, updatedAt: now, revision: workOrder.revision + 1 };
      if (!nextStage) {
        orderUpdate = { ...orderUpdate, status: 'AWAITING_QC', awaitingQcAt: now };
      }
      await db.workOrders.put(orderUpdate);
      await logActivity({
        entityType: 'WORK_ORDER',
        entityId: workOrderId,
        action: nextStage ? 'STAGE_COMPLETED' : 'STAGE_COMPLETED_LAST',
        actor,
        summary: nextStage
          ? `Hoàn thành công đoạn "${stage.name}" của lệnh ${workOrder.code} — chuyển sang bước "${nextStage.name}"`
          : `Hoàn thành công đoạn cuối "${stage.name}" của lệnh ${workOrder.code} — chờ QC`,
        operationId: options.operationId,
      });
      await saveOperationReceipt(options.operationId, 'completeStage', [stage.id]);
      return { stage: updated, workOrder: orderUpdate, nextStage };
    },
  );
}

// ---------- Phiếu sản lượng ----------

export interface ProductionLogInput {
  workOrderId: string;
  stageId: string;
  employeeId: string;
  shift: ShiftId;
  date: string;
  quantityGood: number;
  quantityBad: number;
  note?: string;
}

export async function createProductionLog(
  actor: Actor,
  input: ProductionLogInput,
  options: { operationId?: string } = {},
): Promise<ProductionLog> {
  assertAction(actor, 'production.log');
  return db.transaction(
    'rw',
    [
      db.productionLogs,
      db.workOrders,
      db.workOrderStages,
      db.qcChecks,
      db.employees,
      db.documentSequences,
      db.activityLogs,
      db.operationReceipts,
    ],
    async () => {
      const receipt = await getOperationReceipt(options.operationId);
      if (receipt) {
        const found = await db.productionLogs.get(receipt.resultEntityIds[0]);
        if (found) return found;
      }
      const workOrder = await db.workOrders.get(input.workOrderId);
      if (!workOrder) throw new NotFoundError('Không tìm thấy lệnh sản xuất.');
      assertRule(workOrder.status !== 'CANCELLED', 'Lệnh đã huỷ, không thể ghi sản lượng.', 'INVALID_STATE');
      const stage = await db.workOrderStages.get(input.stageId);
      if (!stage || stage.workOrderId !== workOrder.id) throw new NotFoundError('Không tìm thấy công đoạn của lệnh.');
      assertRule(
        stage.status !== 'PENDING',
        `Công đoạn "${stage.name}" chưa bắt đầu. Bấm "Bắt đầu" công đoạn trước khi ghi sản lượng.`,
        'STAGE_NOT_STARTED',
      );
      const employee = await db.employees.get(input.employeeId);
      if (!employee) throw new NotFoundError('Không tìm thấy nhân viên ghi sản lượng.');
      assertRule(
        employee.teamId === stage.teamId,
        `Nhân viên "${employee.name}" không thuộc tổ phụ trách công đoạn "${stage.name}". Chọn nhân viên đúng tổ.`,
        'TEAM_MISMATCH',
      );
      const quantityGood = roundQty(input.quantityGood, 3);
      const quantityBad = roundQty(input.quantityBad, 3);
      assertRule(quantityGood > 0, 'Số lượng tốt phải lớn hơn 0.');
      assertRule(quantityBad >= 0, 'Số lượng lỗi không được âm.');
      const existingLogs = await db.productionLogs.where('stageId').equals(stage.id).toArray();
      const loggedGood = existingLogs.reduce((s, l) => s + l.quantityGood, 0);
      // Công đoạn có sản lượng cũ nhưng đang làm lại (QC không đạt trả về) được ghi bù theo số lượng lỗi
      const reworkChecks = await db.qcChecks.where('workOrderId').equals(workOrder.id).filter((c) => c.result === 'FAILED').toArray();
      const reworkAllowance = stage.status === 'IN_PROGRESS' && existingLogs.length > 0 ? reworkChecks.reduce((s, c) => s + c.failedQty, 0) : 0;
      const cap = roundQty(workOrder.quantity + reworkAllowance, 3);
      assertRule(
        loggedGood + quantityGood <= cap,
        `Sản lượng tốt của công đoạn "${stage.name}" sẽ vượt số lượng lệnh: đã ghi ${loggedGood}/${cap}. Giảm số lượng hoặc kiểm tra lại lệnh.`,
        'QUANTITY_EXCEEDS',
      );
      const now = nowIso();
      const record: ProductionLog = {
        id: newId(),
        code: await nextCode('PRODUCTION_LOG', input.date.slice(0, 7).replace('-', '')),
        workOrderId: workOrder.id,
        stageId: stage.id,
        teamId: stage.teamId,
        employeeId: employee.id,
        shift: input.shift,
        date: input.date,
        quantityGood,
        quantityBad,
        amountVnd: lineAmountVnd(quantityGood, stage.pieceRateVnd),
        note: input.note?.trim() || undefined,
        createdAt: now,
        createdBy: actor.employeeId,
        revision: 1,
      };
      await db.productionLogs.add(record);
      await logActivity({
        entityType: 'WORK_ORDER',
        entityId: workOrder.id,
        action: 'LOG_RECORDED',
        actor,
        summary: `Ghi sản lượng ${record.code}: ${quantityGood} tốt${quantityBad ? ` / ${quantityBad} lỗi` : ''} — ${stage.name} (${employee.name})`,
        operationId: options.operationId,
      });
      await saveOperationReceipt(options.operationId, 'createProductionLog', [record.id]);
      return record;
    },
  );
}

export interface ProductionLogPatch {
  quantityGood?: number;
  quantityBad?: number;
  shift?: ShiftId;
  employeeId?: string;
  note?: string;
}

export async function updateProductionLog(
  actor: Actor,
  logId: string,
  patch: ProductionLogPatch,
  options: { operationId?: string } = {},
): Promise<ProductionLog> {
  assertAction(actor, 'production.edit', 'Chỉ giám đốc xưởng được sửa phiếu sản lượng.');
  return db.transaction('rw', [db.productionLogs, db.workOrders, db.workOrderStages, db.qcChecks, db.activityLogs, db.operationReceipts], async () => {
    const receipt = await getOperationReceipt(options.operationId);
    if (receipt) {
      const found = await db.productionLogs.get(receipt.resultEntityIds[0]);
      if (found) return found;
    }
    const log = await db.productionLogs.get(logId);
    if (!log) throw new NotFoundError('Không tìm thấy phiếu sản lượng.');
    assertRule(log.date === todayKey(), 'Chỉ sửa được phiếu sản lượng ghi trong ngày hôm nay. Phiếu cũ cần điều chỉnh bằng phiếu bù.', 'INVALID_STATE');
    const workOrder = await db.workOrders.get(log.workOrderId);
    if (!workOrder) throw new NotFoundError('Không tìm thấy lệnh sản xuất của phiếu.');
    const stage = await db.workOrderStages.get(log.stageId);
    if (!stage) throw new NotFoundError('Không tìm thấy công đoạn của phiếu.');
    const quantityGood = roundQty(patch.quantityGood ?? log.quantityGood, 3);
    const quantityBad = roundQty(patch.quantityBad ?? log.quantityBad, 3);
    assertRule(quantityGood > 0, 'Số lượng tốt phải lớn hơn 0.');
    assertRule(quantityBad >= 0, 'Số lượng lỗi không được âm.');
    const others = (await db.productionLogs.where('stageId').equals(stage.id).toArray()).filter((l) => l.id !== log.id);
    const loggedGood = others.reduce((s, l) => s + l.quantityGood, 0);
    const reworkChecks = await db.qcChecks.where('workOrderId').equals(workOrder.id).filter((c) => c.result === 'FAILED').toArray();
    const reworkAllowance = stage.status === 'IN_PROGRESS' && others.length > 0 ? reworkChecks.reduce((s, c) => s + c.failedQty, 0) : 0;
    const cap = roundQty(workOrder.quantity + reworkAllowance, 3);
    assertRule(
      loggedGood + quantityGood <= cap,
      `Tổng sản lượng tốt của công đoạn sẽ vượt số lượng lệnh (${loggedGood + quantityGood}/${cap}).`,
      'QUANTITY_EXCEEDS',
    );
    const updated: ProductionLog = {
      ...log,
      quantityGood,
      quantityBad,
      shift: patch.shift ?? log.shift,
      employeeId: patch.employeeId ?? log.employeeId,
      note: patch.note !== undefined ? patch.note.trim() || undefined : log.note,
      amountVnd: lineAmountVnd(quantityGood, stage.pieceRateVnd),
      revision: log.revision + 1,
    };
    await db.productionLogs.put(updated);
    await logActivity({
      entityType: 'WORK_ORDER',
      entityId: workOrder.id,
      action: 'LOG_UPDATED',
      actor,
      summary: `Sửa phiếu sản lượng ${log.code} (${stage.name}): ${quantityGood} tốt / ${quantityBad} lỗi`,
      operationId: options.operationId,
    });
    await saveOperationReceipt(options.operationId, 'updateProductionLog', [log.id]);
    return updated;
  });
}

export async function deleteProductionLog(actor: Actor, logId: string, options: { operationId?: string } = {}): Promise<void> {
  assertAction(actor, 'production.edit', 'Chỉ giám đốc xưởng được xoá phiếu sản lượng.');
  await db.transaction('rw', [db.productionLogs, db.workOrders, db.workOrderStages, db.activityLogs], async () => {
    const log = await db.productionLogs.get(logId);
    if (!log) throw new NotFoundError('Không tìm thấy phiếu sản lượng.');
    assertRule(log.date === todayKey(), 'Chỉ xoá được phiếu sản lượng ghi trong ngày hôm nay.', 'INVALID_STATE');
    await db.productionLogs.delete(logId);
    await logActivity({
      entityType: 'WORK_ORDER',
      entityId: log.workOrderId,
      action: 'LOG_DELETED',
      actor,
      summary: `Xoá phiếu sản lượng ${log.code} (${log.quantityGood} tốt / ${log.quantityBad} lỗi)`,
      operationId: options.operationId,
    });
  });
}

// ---------- QC ----------

export interface QcCheckInput {
  workOrderId: string;
  checkedQty: number;
  passedQty: number;
  failedQty: number;
  defectType: DefectType;
  result: QcResult;
  note?: string;
}

export async function recordQcCheck(actor: Actor, input: QcCheckInput, options: { operationId?: string } = {}): Promise<QcCheck> {
  assertAction(actor, 'qc.check');
  return db.transaction(
    'rw',
    [
      db.qcChecks,
      db.workOrders,
      db.workOrderStages,
      db.productStock,
      db.stockMovements,
      db.products,
      db.salesOrders,
      db.salesOrderItems,
      db.documentSequences,
      db.activityLogs,
      db.operationReceipts,
    ],
    async () => {
      const receipt = await getOperationReceipt(options.operationId);
      if (receipt) {
        const found = await db.qcChecks.get(receipt.resultEntityIds[0]);
        if (found) return found;
      }
      const workOrder = await db.workOrders.get(input.workOrderId);
      if (!workOrder) throw new NotFoundError('Không tìm thấy lệnh sản xuất cần kiểm.');
      assertRule(
        workOrder.status === 'AWAITING_QC',
        'Chỉ kiểm được lệnh đang ở trạng thái "Chờ QC". Hoàn thành công đoạn cuối trước khi kiểm.',
        'INVALID_STATE',
      );
      const product = await db.products.get(workOrder.productId);
      if (!product) throw new NotFoundError('Không tìm thấy sản phẩm của lệnh.');
      const checkedQty = roundQty(input.checkedQty, 3);
      const passedQty = roundQty(input.passedQty, 3);
      const failedQty = roundQty(input.failedQty, 3);
      assertRule(checkedQty > 0, 'Số lượng kiểm phải lớn hơn 0.');
      assertRule(passedQty >= 0 && failedQty >= 0, 'Số lượng đạt/lỗi không được âm.');
      assertRule(
        Math.abs(checkedQty - (passedQty + failedQty)) < 0.001,
        'Số lượng kiểm phải bằng số lượng đạt cộng số lượng lỗi.',
        'VALIDATION',
      );
      if (input.result === 'PASSED') {
        assertRule(passedQty > 0, 'Kết luận Đạt cần số lượng đạt lớn hơn 0.');
      } else {
        assertRule(failedQty > 0, 'Kết luận Không đạt cần số lượng lỗi lớn hơn 0.');
      }
      const now = nowIso();
      const afterRework = workOrder.reworkCount > 0;
      const check: QcCheck = {
        id: newId(),
        code: await nextCode('QC_CHECK'),
        workOrderId: workOrder.id,
        checkedQty,
        passedQty,
        failedQty,
        defectType: input.defectType,
        result: input.result,
        afterRework,
        note: input.note?.trim() || undefined,
        checkedById: actor.employeeId,
        checkedAt: now,
      };
      await db.qcChecks.add(check);

      if (input.result === 'PASSED') {
        await increaseProductStock(product.id, passedQty);
        await db.stockMovements.add({
          id: newId(),
          productId: product.id,
          type: 'PRODUCT_IN',
          quantity: passedQty,
          refType: 'WORK_ORDER',
          refId: workOrder.id,
          refCode: workOrder.code,
          at: now,
          note: `Nhập kho thành phẩm từ lệnh ${workOrder.code} (${check.code})`,
        });
        await db.workOrders.put({
          ...workOrder,
          status: 'DONE',
          finishedAt: now,
          updatedAt: now,
          revision: workOrder.revision + 1,
        });
        await recalcSalesOrderStatus(workOrder.salesOrderId);
        await logActivity({
          entityType: 'WORK_ORDER',
          entityId: workOrder.id,
          action: 'QC_PASSED',
          actor,
          summary: `QC đạt ${check.code}: nhập kho ${passedQty} ${product.unit} "${product.name}" từ lệnh ${workOrder.code}`,
          operationId: options.operationId,
        });
      } else {
        const stages = await listWorkOrderStages(workOrder.id);
        const lastDone = [...stages].reverse().find((s) => s.status === 'DONE') ?? stages[stages.length - 1];
        if (lastDone) {
          await db.workOrderStages.put({ ...lastDone, status: 'IN_PROGRESS', finishedAt: undefined, startedAt: now });
        }
        await db.workOrders.put({
          ...workOrder,
          status: 'IN_PROGRESS',
          reworkCount: workOrder.reworkCount + 1,
          awaitingQcAt: undefined,
          updatedAt: now,
          revision: workOrder.revision + 1,
        });
        await logActivity({
          entityType: 'WORK_ORDER',
          entityId: workOrder.id,
          action: 'QC_FAILED',
          actor,
          summary: `QC không đạt ${check.code}: ${failedQty} ${product.unit} lỗi (${input.defectType}) — lệnh quay lại công đoạn "${lastDone?.name ?? 'cuối'}", lần làm lại thứ ${workOrder.reworkCount + 1}`,
          operationId: options.operationId,
        });
      }
      await saveOperationReceipt(options.operationId, 'recordQcCheck', [check.id]);
      return check;
    },
  );
}
