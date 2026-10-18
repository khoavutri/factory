import { db } from '../db/database';
import { newId } from '../utils/ids';
import { nowIso } from '../utils/format';
import { roundQty, weightedAverageCost } from '../utils/money';
import type {
  Actor,
  Material,
  MaterialIssue,
  MaterialIssueItem,
  MaterialReceipt,
  MaterialReceiptItem,
  ProductStock,
} from '../types';
import { NotFoundError, assertRule } from './errors';
import { assertAction, getOperationReceipt, logActivity, nextCode, saveOperationReceipt } from './core';

// ---------- Thành phẩm ----------

export function productStockId(productId: string): string {
  return `ps::${productId}`;
}

export async function getProductStock(productId: string): Promise<number> {
  const record = await db.productStock.get(productStockId(productId));
  return record?.quantity ?? 0;
}

/** Cộng tồn thành phẩm (gọi trong transaction của nghiệp vụ gọi tới) */
export async function increaseProductStock(productId: string, quantity: number): Promise<void> {
  assertRule(quantity > 0, 'Số lượng thành phẩm nhập kho phải lớn hơn 0.');
  const id = productStockId(productId);
  const existing = await db.productStock.get(id);
  const record: ProductStock = existing
    ? { ...existing, quantity: roundQty(existing.quantity + quantity), updatedAt: nowIso() }
    : { id, productId, quantity: roundQty(quantity), updatedAt: nowIso() };
  await db.productStock.put(record);
}

export async function decreaseProductStock(productId: string, quantity: number, productName?: string): Promise<void> {
  const id = productStockId(productId);
  const existing = await db.productStock.get(id);
  const onHand = existing?.quantity ?? 0;
  assertRule(
    onHand >= quantity,
    `Tồn thành phẩm${productName ? ` của "${productName}"` : ''} không đủ để giao: hiện có ${onHand}, cần ${quantity}. Hãy hoàn tất sản xuất và QC trước.`,
    'INSUFFICIENT_PRODUCT_STOCK',
  );
  await db.productStock.put({ id, productId, quantity: roundQty(onHand - quantity), updatedAt: nowIso() });
}

// ---------- Nhập nguyên vật liệu ----------

export interface ReceiptLineInput {
  materialId: string;
  quantity: number;
  unitCostVnd: number;
  note?: string;
}

export interface ReceiptInput {
  supplierId?: string;
  note?: string;
  postNow: boolean;
  lines: ReceiptLineInput[];
}

export async function receiveMaterials(
  actor: Actor,
  input: ReceiptInput,
  options: { operationId?: string } = {},
): Promise<MaterialReceipt> {
  assertAction(actor, 'inventory.receipt');
  assertRule(input.lines.length > 0, 'Phiếu nhập kho chưa có dòng vật tư nào.');
  return db.transaction(
    'rw',
    [
      db.materialReceipts,
      db.materialReceiptItems,
      db.materials,
      db.suppliers,
      db.stockMovements,
      db.documentSequences,
      db.activityLogs,
      db.operationReceipts,
    ],
    async () => {
      const receipt = await getOperationReceipt(options.operationId);
      if (receipt) {
        const found = await db.materialReceipts.get(receipt.resultEntityIds[0]);
        if (found) return found;
      }
      let supplierNameSnapshot: string | undefined;
      if (input.supplierId) {
        const supplier = await db.suppliers.get(input.supplierId);
        if (!supplier) throw new NotFoundError('Không tìm thấy nhà cung cấp.');
        supplierNameSnapshot = supplier.name;
      }
      const now = nowIso();
      const code = await nextCode('MATERIAL_RECEIPT');
      const receiptId = newId();
      let totalVnd = 0;
      const items: MaterialReceiptItem[] = [];
      for (const line of input.lines) {
        const material = await db.materials.get(line.materialId);
        if (!material) throw new NotFoundError('Không tìm thấy vật tư trong dòng phiếu nhập.');
        assertRule(line.quantity > 0, `Số lượng nhập của "${material.name}" phải lớn hơn 0.`);
        assertRule(line.unitCostVnd >= 0, `Đơn giá nhập của "${material.name}" không hợp lệ.`);
        totalVnd += Math.round(line.quantity * line.unitCostVnd);
        items.push({
          id: newId(),
          receiptId,
          materialId: material.id,
          materialNameSnapshot: material.name,
          unitSnapshot: material.unit,
          quantity: roundQty(line.quantity, 4),
          unitCostVnd: Math.round(line.unitCostVnd),
        });
      }
      const record: MaterialReceipt = {
        id: receiptId,
        code,
        supplierId: input.supplierId,
        supplierNameSnapshot,
        status: input.postNow ? 'POSTED' : 'DRAFT',
        totalVnd,
        note: input.note?.trim() || undefined,
        createdAt: now,
        postedAt: input.postNow ? now : undefined,
        createdBy: actor.employeeId,
        revision: 1,
      };
      await db.materialReceipts.add(record);
      await db.materialReceiptItems.bulkAdd(items);
      if (input.postNow) {
        await applyReceiptItems(record, items, now);
      }
      await logActivity({
        entityType: 'MATERIAL_RECEIPT',
        entityId: record.id,
        action: input.postNow ? 'POSTED' : 'DRAFT',
        actor,
        summary: `${input.postNow ? 'Nhập kho' : 'Lưu nháp phiếu nhập'} ${code} — ${items.length} dòng, giá trị ${totalVnd.toLocaleString('vi-VN')} đ`,
        operationId: options.operationId,
      });
      await saveOperationReceipt(options.operationId, 'receiveMaterials', [record.id]);
      return record;
    },
  );
}

async function applyReceiptItems(receipt: MaterialReceipt, items: MaterialReceiptItem[], at: string): Promise<void> {
  for (const item of items) {
    const material = await db.materials.get(item.materialId);
    if (!material) throw new NotFoundError('Không tìm thấy vật tư của dòng phiếu nhập.');
    const beforeQty = material.stockQty;
    const updated: Material = {
      ...material,
      stockQty: roundQty(beforeQty + item.quantity, 4),
      avgCostVnd: weightedAverageCost(beforeQty, material.avgCostVnd, item.quantity, item.unitCostVnd),
      updatedAt: at,
      revision: material.revision + 1,
    };
    await db.materials.put(updated);
    await db.stockMovements.add({
      id: newId(),
      materialId: material.id,
      type: 'RECEIPT_IN',
      quantity: item.quantity,
      unitCostVnd: item.unitCostVnd,
      refType: 'MATERIAL_RECEIPT',
      refId: receipt.id,
      refCode: receipt.code,
      at,
      note: receipt.supplierNameSnapshot,
    });
  }
}

export async function postMaterialReceipt(
  actor: Actor,
  receiptId: string,
  options: { operationId?: string } = {},
): Promise<MaterialReceipt> {
  assertAction(actor, 'inventory.receipt');
  return db.transaction(
    'rw',
    [db.materialReceipts, db.materialReceiptItems, db.materials, db.stockMovements, db.activityLogs, db.operationReceipts],
    async () => {
      const existingReceipt = await getOperationReceipt(options.operationId);
      if (existingReceipt) {
        const found = await db.materialReceipts.get(existingReceipt.resultEntityIds[0]);
        if (found) return found;
      }
      const receipt = await db.materialReceipts.get(receiptId);
      if (!receipt) throw new NotFoundError('Không tìm thấy phiếu nhập kho.');
      assertRule(receipt.status === 'DRAFT', 'Phiếu nhập này đã được ghi sổ trước đó.', 'INVALID_STATE');
      const items = await db.materialReceiptItems.where('receiptId').equals(receiptId).toArray();
      const at = nowIso();
      await applyReceiptItems(receipt, items, at);
      const updated: MaterialReceipt = { ...receipt, status: 'POSTED', postedAt: at, revision: receipt.revision + 1 };
      await db.materialReceipts.put(updated);
      await logActivity({
        entityType: 'MATERIAL_RECEIPT',
        entityId: receipt.id,
        action: 'POSTED',
        actor,
        summary: `Ghi sổ phiếu nhập ${receipt.code} (${items.length} dòng)`,
        operationId: options.operationId,
      });
      await saveOperationReceipt(options.operationId, 'postMaterialReceipt', [receipt.id]);
      return updated;
    },
  );
}

// ---------- Xuất nguyên vật liệu theo lệnh sản xuất ----------

export interface IssueLineInput {
  materialId: string;
  quantity: number;
  note?: string;
}

export async function issueMaterialsToWorkOrder(
  actor: Actor,
  workOrderId: string,
  lines: IssueLineInput[],
  options: { note?: string; operationId?: string } = {},
): Promise<MaterialIssue> {
  assertAction(actor, 'inventory.issue');
  assertRule(lines.length > 0, 'Phiếu cấp vật tư chưa có dòng nào.');
  return db.transaction(
    'rw',
    [
      db.materialIssues,
      db.materialIssueItems,
      db.materials,
      db.stockMovements,
      db.workOrders,
      db.documentSequences,
      db.activityLogs,
      db.operationReceipts,
    ],
    async () => {
      const receipt = await getOperationReceipt(options.operationId);
      if (receipt) {
        const found = await db.materialIssues.get(receipt.resultEntityIds[0]);
        if (found) return found;
      }
      const workOrder = await db.workOrders.get(workOrderId);
      if (!workOrder) throw new NotFoundError('Không tìm thấy lệnh sản xuất cần cấp vật tư.');
      assertRule(workOrder.status !== 'CANCELLED', 'Lệnh sản xuất đã huỷ, không thể cấp thêm vật tư.', 'INVALID_STATE');
      const now = nowIso();
      const code = await nextCode('MATERIAL_ISSUE');
      const issueId = newId();
      let totalVnd = 0;
      const items: MaterialIssueItem[] = [];
      for (const line of lines) {
        const material = await db.materials.get(line.materialId);
        if (!material) throw new NotFoundError('Không tìm thấy vật tư cần cấp.');
        const qty = roundQty(line.quantity, 4);
        assertRule(qty > 0, `Số lượng cấp của "${material.name}" phải lớn hơn 0.`);
        assertRule(
          material.stockQty >= qty,
          `"${material.name}" chỉ còn tồn ${material.stockQty} ${material.unit}, không đủ cấp ${qty} ${material.unit}. Hãy nhập kho trước.`,
          'INSUFFICIENT_STOCK',
        );
        totalVnd += Math.round(qty * material.avgCostVnd);
        items.push({
          id: newId(),
          issueId,
          materialId: material.id,
          materialNameSnapshot: material.name,
          unitSnapshot: material.unit,
          quantity: qty,
          unitCostVnd: material.avgCostVnd,
        });
      }
      const record: MaterialIssue = {
        id: issueId,
        code,
        workOrderId,
        status: 'POSTED',
        totalVnd,
        note: options.note?.trim() || undefined,
        createdAt: now,
        postedAt: now,
        createdBy: actor.employeeId,
        revision: 1,
      };
      await db.materialIssues.add(record);
      await db.materialIssueItems.bulkAdd(items);
      await applyIssueItems(record, items, workOrder.code, now);
      await logActivity({
        entityType: 'WORK_ORDER',
        entityId: workOrderId,
        action: 'MATERIAL_ISSUED',
        actor,
        summary: `Cấp ${items.length} dòng vật tư cho lệnh ${workOrder.code} (${code})`,
        operationId: options.operationId,
      });
      await saveOperationReceipt(options.operationId, 'issueMaterials', [record.id]);
      return record;
    },
  );
}

async function applyIssueItems(issue: MaterialIssue, items: MaterialIssueItem[], workOrderCode: string, at: string): Promise<void> {
  for (const item of items) {
    const material = await db.materials.get(item.materialId);
    if (!material) continue;
    await db.materials.put({
      ...material,
      stockQty: roundQty(material.stockQty - item.quantity, 4),
      updatedAt: at,
      revision: material.revision + 1,
    });
    await db.stockMovements.add({
      id: newId(),
      materialId: material.id,
      type: 'ISSUE_OUT',
      quantity: item.quantity,
      unitCostVnd: item.unitCostVnd,
      refType: 'MATERIAL_ISSUE',
      refId: issue.id,
      refCode: issue.code,
      at,
      note: `Cấp cho lệnh ${workOrderCode}`,
    });
  }
}

/** Ghi sổ phiếu xuất vật tư đang ở trạng thái nháp (trừ tồn, ghi giao dịch kho) */
export async function postMaterialIssue(actor: Actor, issueId: string, options: { operationId?: string } = {}): Promise<MaterialIssue> {
  assertAction(actor, 'inventory.issue');
  return db.transaction(
    'rw',
    [db.materialIssues, db.materialIssueItems, db.materials, db.stockMovements, db.workOrders, db.activityLogs, db.operationReceipts],
    async () => {
      const receipt = await getOperationReceipt(options.operationId);
      if (receipt) {
        const found = await db.materialIssues.get(receipt.resultEntityIds[0]);
        if (found) return found;
      }
      const issue = await db.materialIssues.get(issueId);
      if (!issue) throw new NotFoundError('Không tìm thấy phiếu xuất vật tư.');
      assertRule(issue.status === 'DRAFT', 'Phiếu xuất này đã được ghi sổ trước đó.', 'INVALID_STATE');
      const workOrder = await db.workOrders.get(issue.workOrderId);
      assertRule(!!workOrder && workOrder.status !== 'CANCELLED', 'Lệnh sản xuất đã huỷ, không thể ghi sổ phiếu xuất.', 'INVALID_STATE');
      const items = await db.materialIssueItems.where('issueId').equals(issueId).toArray();
      for (const item of items) {
        const material = await db.materials.get(item.materialId);
        assertRule(
          !!material && material.stockQty >= item.quantity,
          `"${material?.name ?? 'Vật tư'}" không đủ tồn để ghi sổ phiếu xuất (tồn ${material?.stockQty ?? 0}, cần ${item.quantity}). Nhập kho trước rồi ghi sổ.`,
          'INSUFFICIENT_STOCK',
        );
      }
      const at = nowIso();
      await applyIssueItems(issue, items, workOrder!.code, at);
      const updated: MaterialIssue = { ...issue, status: 'POSTED', postedAt: at, revision: issue.revision + 1 };
      await db.materialIssues.put(updated);
      await logActivity({
        entityType: 'WORK_ORDER',
        entityId: issue.workOrderId,
        action: 'MATERIAL_ISSUED',
        actor,
        summary: `Ghi sổ phiếu xuất ${issue.code} — ${items.length} dòng vật tư`,
        operationId: options.operationId,
      });
      await saveOperationReceipt(options.operationId, 'postMaterialIssue', [issue.id]);
      return updated;
    },
  );
}

// ---------- Kiểm kê / điều chỉnh tồn ----------

export interface StocktakeInput {
  materialId: string;
  actualQty: number;
  reason: string;
}

export async function adjustMaterialStock(
  actor: Actor,
  input: StocktakeInput,
  options: { operationId?: string } = {},
): Promise<{ material: Material; diff: number }> {
  assertAction(actor, 'inventory.adjust');
  assertRule(input.reason.trim().length >= 5, 'Vui lòng nhập lý do điều chỉnh (ít nhất 5 ký tự).');
  assertRule(input.actualQty >= 0, 'Tồn thực tế không được âm.');
  return db.transaction('rw', [db.materials, db.stockMovements, db.activityLogs, db.operationReceipts], async () => {
    const receipt = await getOperationReceipt(options.operationId);
    if (receipt) {
      const found = await db.materials.get(receipt.resultEntityIds[0]);
      if (found) return { material: found, diff: 0 };
    }
    const material = await db.materials.get(input.materialId);
    if (!material) throw new NotFoundError('Không tìm thấy vật tư cần kiểm kê.');
    const diff = roundQty(input.actualQty - material.stockQty, 4);
    const at = nowIso();
    const updated: Material = { ...material, stockQty: roundQty(input.actualQty, 4), updatedAt: at, revision: material.revision + 1 };
    await db.materials.put(updated);
    if (diff !== 0) {
      await db.stockMovements.add({
        id: newId(),
        materialId: material.id,
        type: 'ADJUST',
        quantity: Math.abs(diff),
        unitCostVnd: material.avgCostVnd,
        refType: 'ADJUST',
        refId: updated.id,
        refCode: `KK-${updated.code}`,
        at,
        note: `${diff > 0 ? 'Tăng' : 'Giảm'} ${Math.abs(diff)} ${material.unit} — ${input.reason.trim()}`,
      });
    }
    await logActivity({
      entityType: 'MATERIAL',
      entityId: material.id,
      action: 'STOCKTAKE',
      actor,
      summary: `Kiểm kê ${material.name}: tồn hệ thống ${material.stockQty} → thực tế ${input.actualQty} (${diff > 0 ? '+' : ''}${diff}). Lý do: ${input.reason.trim()}`,
      operationId: options.operationId,
    });
    await saveOperationReceipt(options.operationId, 'adjustMaterialStock', [material.id]);
    return { material: updated, diff };
  });
}

// ---------- Đọc tổng hợp ----------

export interface MaterialDemandRow {
  material: Material;
  neededQty: number;
  issuedQty: number;
  missingQty: number;
}

/** Nhu cầu vật tư của lệnh = snapshot định mức × SL lệnh (kèm hao hụt) − đã cấp */
export async function materialDemand(workOrderId: string): Promise<MaterialDemandRow[]> {
  const workOrder = await db.workOrders.get(workOrderId);
  if (!workOrder) return [];
  const materials = new Map((await db.materials.toArray()).map((m) => [m.id, m]));
  const issues = await db.materialIssues.where('workOrderId').equals(workOrderId).filter((i) => i.status === 'POSTED').toArray();
  const issuedByMaterial = new Map<string, number>();
  if (issues.length) {
    const items = await db.materialIssueItems.where('issueId').anyOf(issues.map((i) => i.id)).toArray();
    for (const item of items) {
      issuedByMaterial.set(item.materialId, roundQty((issuedByMaterial.get(item.materialId) ?? 0) + item.quantity, 4));
    }
  }
  const rows: MaterialDemandRow[] = [];
  for (const req of workOrder.materialReqs) {
    const material = materials.get(req.materialId);
    if (!material) continue;
    const neededQty = roundQty(req.quantityPerUnit * (1 + req.wastePct / 100) * workOrder.quantity, 4);
    const issuedQty = issuedByMaterial.get(req.materialId) ?? 0;
    rows.push({ material, neededQty, issuedQty, missingQty: Math.max(0, roundQty(neededQty - issuedQty, 4)) });
  }
  return rows;
}

/** Tổng giá trị vật tư đã cấp cho một lệnh sản xuất */
export async function issuedValueOfWorkOrder(workOrderId: string): Promise<number> {
  const issues = await db.materialIssues.where('workOrderId').equals(workOrderId).filter((i) => i.status === 'POSTED').toArray();
  return issues.reduce((s, i) => s + i.totalVnd, 0);
}
