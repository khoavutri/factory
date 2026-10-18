import { db } from '../db/database';
import { newId } from '../utils/ids';
import { nowIso } from '../utils/format';
import { lineAmountVnd, roundQty } from '../utils/money';
import type {
  Actor,
  Delivery,
  DeliveryItem,
  SalesOrder,
  SalesOrderItem,
  SalesOrderStatus,
  WorkOrder,
  WorkOrderMaterialReq,
  WorkOrderPriority,
  WorkOrderStage,
} from '../types';
import { BusinessError, NotFoundError, assertRule } from './errors';
import { assertAction, getOperationReceipt, logActivity, nextCode, saveOperationReceipt } from './core';
import { decreaseProductStock, getProductStock } from './inventory';

export const ACTIVE_ORDER_STATUSES: SalesOrderStatus[] = ['NEW', 'APPROVED', 'IN_PROGRESS', 'READY'];

// ---------- Tạo đơn hàng ----------

export interface SalesOrderLineInput {
  productId: string;
  quantity: number;
  unitPriceVnd: number;
}

export interface SalesOrderInput {
  customerId: string;
  dueDate: string;
  note?: string;
  lines: SalesOrderLineInput[];
}

export async function createSalesOrder(
  actor: Actor,
  input: SalesOrderInput,
  options: { operationId?: string } = {},
): Promise<SalesOrder> {
  assertAction(actor, 'order.create');
  assertRule(!!input.customerId, 'Vui lòng chọn khách hàng cho đơn.');
  assertRule(!!input.dueDate, 'Vui lòng chọn hạn giao cho đơn.');
  assertRule(input.lines.length > 0, 'Đơn hàng cần ít nhất một dòng sản phẩm.');
  assertRule(
    input.lines.every((l) => l.productId && l.quantity > 0 && l.unitPriceVnd >= 0),
    'Mỗi dòng cần chọn sản phẩm, số lượng lớn hơn 0 và đơn giá không âm.',
  );
  return db.transaction(
    'rw',
    [db.salesOrders, db.salesOrderItems, db.customers, db.products, db.documentSequences, db.activityLogs, db.operationReceipts],
    async () => {
      const receipt = await getOperationReceipt(options.operationId);
      if (receipt) {
        const found = await db.salesOrders.get(receipt.resultEntityIds[0]);
        if (found) return found;
      }
      const customer = await db.customers.get(input.customerId);
      if (!customer) throw new NotFoundError('Không tìm thấy khách hàng của đơn.');
      const now = nowIso();
      const code = await nextCode('SALES_ORDER');
      const orderId = newId();
      let totalVnd = 0;
      const items: SalesOrderItem[] = [];
      for (const line of input.lines) {
        const product = await db.products.get(line.productId);
        if (!product) throw new NotFoundError('Không tìm thấy sản phẩm trong dòng đơn hàng.');
        totalVnd += lineAmountVnd(line.quantity, line.unitPriceVnd);
        items.push({
          id: newId(),
          orderId,
          productId: product.id,
          quantity: roundQty(line.quantity, 3),
          unitPriceVnd: Math.round(line.unitPriceVnd),
          deliveredQty: 0,
        });
      }
      const order: SalesOrder = {
        id: orderId,
        code,
        customerId: customer.id,
        status: 'NEW',
        dueDate: input.dueDate,
        totalVnd,
        note: input.note?.trim() || undefined,
        createdAt: now,
        createdBy: actor.employeeId,
        revision: 1,
      };
      await db.salesOrders.add(order);
      await db.salesOrderItems.bulkAdd(items);
      await logActivity({
        entityType: 'SALES_ORDER',
        entityId: order.id,
        action: 'CREATED',
        actor,
        summary: `Tạo đơn hàng ${code} cho ${customer.name} — ${items.length} mặt hàng, giá trị ${totalVnd.toLocaleString('vi-VN')} đ`,
        operationId: options.operationId,
      });
      await saveOperationReceipt(options.operationId, 'createSalesOrder', [order.id]);
      return order;
    },
  );
}

// ---------- Duyệt đơn → sinh lệnh sản xuất ----------

export async function approveSalesOrder(
  actor: Actor,
  orderId: string,
  options: { operationId?: string } = {},
): Promise<WorkOrder[]> {
  assertAction(actor, 'order.approve');
  return db.transaction(
    'rw',
    [
      db.salesOrders,
      db.salesOrderItems,
      db.workOrders,
      db.workOrderStages,
      db.bomStages,
      db.bomMaterials,
      db.products,
      db.documentSequences,
      db.activityLogs,
      db.operationReceipts,
    ],
    async () => {
      const receipt = await getOperationReceipt(options.operationId);
      if (receipt) {
        const found = await db.workOrders.bulkGet(receipt.resultEntityIds);
        return found.filter(Boolean) as WorkOrder[];
      }
      const order = await db.salesOrders.get(orderId);
      if (!order) throw new NotFoundError('Không tìm thấy đơn hàng cần duyệt.');
      assertRule(order.status === 'NEW', 'Chỉ duyệt được đơn hàng đang ở trạng thái "Mới".', 'INVALID_STATE');
      const items = await db.salesOrderItems.where('orderId').equals(orderId).toArray();
      assertRule(items.length > 0, 'Đơn hàng chưa có dòng sản phẩm nào.');

      const created: WorkOrder[] = [];
      const now = nowIso();
      for (const item of items) {
        const product = await db.products.get(item.productId);
        if (!product) throw new NotFoundError('Không tìm thấy sản phẩm của dòng đơn hàng.');
        const stages = (await db.bomStages.where('productId').equals(product.id).toArray()).sort((a, b) => a.seq - b.seq);
        if (stages.length === 0) {
          throw new BusinessError(
            `Sản phẩm "${product.name}" (${product.code}) chưa có định mức công đoạn (BOM). Vào màn Sản phẩm & BOM để khai báo công đoạn + nguyên vật liệu trước khi duyệt đơn.`,
            'BOM_MISSING',
          );
        }
        const bomMaterials = await db.bomMaterials.where('productId').equals(product.id).toArray();
        assertRule(
          bomMaterials.length > 0,
          `Sản phẩm "${product.name}" chưa khai báo nguyên vật liệu trong BOM. Bổ sung định mức trước khi duyệt đơn.`,
          'BOM_MISSING',
        );
        const materialReqs: WorkOrderMaterialReq[] = bomMaterials.map((m) => ({
          materialId: m.materialId,
          quantityPerUnit: m.quantityPerUnit,
          wastePct: m.wastePct,
        }));
        const priority: WorkOrderPriority =
          item.unitPriceVnd >= 8_000_000 ? 'HIGH' : 'NORMAL';
        const workOrder: WorkOrder = {
          id: newId(),
          code: await nextCode('WORK_ORDER'),
          salesOrderId: order.id,
          salesOrderItemId: item.id,
          productId: product.id,
          quantity: roundQty(item.quantity, 3),
          status: 'WAITING',
          priority,
          dueDate: order.dueDate,
          reworkCount: 0,
          materialReqs,
          createdAt: now,
          createdBy: actor.employeeId,
          revision: 1,
        };
        await db.workOrders.add(workOrder);
        const workStages: WorkOrderStage[] = stages.map((s) => ({
          id: newId(),
          workOrderId: workOrder.id,
          seq: s.seq,
          name: s.name,
          teamId: s.teamId,
          pieceRateVnd: s.pieceRateVnd,
          standardMinutes: s.standardMinutes,
          status: 'PENDING',
        }));
        await db.workOrderStages.bulkAdd(workStages);
        created.push(workOrder);
      }
      const updated: SalesOrder = { ...order, status: 'APPROVED', approvedAt: now, updatedAt: now, revision: order.revision + 1 };
      await db.salesOrders.put(updated);
      await logActivity({
        entityType: 'SALES_ORDER',
        entityId: order.id,
        action: 'APPROVED',
        actor,
        summary: `Duyệt đơn ${order.code} — sinh ${created.length} lệnh sản xuất (${created.map((w) => w.code).join(', ')})`,
        operationId: options.operationId,
      });
      await saveOperationReceipt(options.operationId, 'approveSalesOrder', created.map((w) => w.id));
      return created;
    },
  );
}

// ---------- Tính lại trạng thái đơn theo sản xuất & tồn thành phẩm ----------

export async function recalcSalesOrderStatus(orderId: string): Promise<void> {
  const order = await db.salesOrders.get(orderId);
  if (!order) return;
  if (order.status === 'NEW' || order.status === 'CANCELLED') return;
  const items = await db.salesOrderItems.where('orderId').equals(orderId).toArray();
  if (items.length === 0) return;
  let allDelivered = true;
  let allCovered = true;
  for (const item of items) {
    if (item.deliveredQty < item.quantity) allDelivered = false;
    const onHand = await getProductStock(item.productId);
    if (item.deliveredQty + onHand < item.quantity) allCovered = false;
  }
  const workOrders = await db.workOrders.where('salesOrderId').equals(orderId).toArray();
  let next: SalesOrderStatus = order.status;
  if (allDelivered && workOrders.length > 0 && workOrders.every((w) => w.status === 'DONE' || w.status === 'CANCELLED')) {
    next = 'DELIVERED';
  } else if (allCovered && workOrders.some((w) => w.status === 'DONE')) {
    next = 'READY';
  } else if (workOrders.length > 0) {
    // Đã sinh lệnh nhưng chưa tổ nào bắt đầu → giữ trạng thái Đã duyệt
    next = workOrders.some((w) => w.status !== 'WAITING' && w.status !== 'CANCELLED') ? 'IN_PROGRESS' : 'APPROVED';
  } else if (order.approvedAt) {
    next = 'APPROVED';
  }
  if (next !== order.status) {
    await db.salesOrders.put({ ...order, status: next, updatedAt: nowIso(), revision: order.revision + 1 });
  }
}

// ---------- Giao hàng ----------

export interface DeliveryLineInput {
  itemId: string;
  quantity: number;
}

export async function deliverSalesOrder(
  actor: Actor,
  orderId: string,
  lines: DeliveryLineInput[],
  options: { receivedBy?: string; note?: string; operationId?: string } = {},
): Promise<Delivery> {
  assertAction(actor, 'order.deliver');
  assertRule(lines.length > 0, 'Phiếu giao hàng chưa có dòng sản phẩm nào.');
  return db.transaction(
    'rw',
    [
      db.salesOrders,
      db.salesOrderItems,
      db.workOrders,
      db.deliveries,
      db.deliveryItems,
      db.products,
      db.productStock,
      db.stockMovements,
      db.documentSequences,
      db.activityLogs,
      db.operationReceipts,
    ],
    async () => {
      const receipt = await getOperationReceipt(options.operationId);
      if (receipt) {
        const found = await db.deliveries.get(receipt.resultEntityIds[0]);
        if (found) return found;
      }
      const order = await db.salesOrders.get(orderId);
      if (!order) throw new NotFoundError('Không tìm thấy đơn hàng cần giao.');
      assertRule(order.status !== 'CANCELLED', 'Đơn hàng đã huỷ, không thể giao.', 'INVALID_STATE');
      assertRule(order.status !== 'NEW', 'Đơn hàng chưa duyệt. Duyệt đơn để sinh lệnh sản xuất trước khi giao.', 'INVALID_STATE');

      const now = nowIso();
      const code = await nextCode('DELIVERY');
      const deliveryId = newId();
      const deliveryItems: DeliveryItem[] = [];
      let totalVnd = 0;
      const orderItems = await db.salesOrderItems.where('orderId').equals(orderId).toArray();
      const shortfalls: string[] = [];

      for (const line of lines) {
        const item = orderItems.find((i) => i.id === line.itemId);
        if (!item) throw new NotFoundError('Không tìm thấy dòng đơn hàng cần giao.');
        const product = await db.products.get(item.productId);
        if (!product) throw new NotFoundError('Không tìm thấy sản phẩm của dòng giao hàng.');
        const remaining = roundQty(item.quantity - item.deliveredQty, 3);
        const qty = roundQty(line.quantity, 3);
        if (qty <= 0) continue;
        assertRule(qty <= remaining, `Dòng "${product.name}": số lượng giao ${qty} vượt số còn lại ${remaining}.`, 'DELIVERY_EXCEEDS');
        const onHand = await getProductStock(product.id);
        if (onHand < qty) {
          shortfalls.push(`${product.name}: còn thiếu ${roundQty(qty - onHand, 3)} ${product.unit} (tồn ${onHand})`);
          continue;
        }
        deliveryItems.push({
          id: newId(),
          deliveryId,
          productId: product.id,
          productNameSnapshot: product.name,
          unitSnapshot: product.unit,
          quantity: qty,
          unitPriceVnd: item.unitPriceVnd,
        });
        totalVnd += lineAmountVnd(qty, item.unitPriceVnd);
        await decreaseProductStock(product.id, qty, product.name);
        await db.stockMovements.add({
          id: newId(),
          productId: product.id,
          type: 'DELIVERY_OUT',
          quantity: qty,
          unitPriceVnd: item.unitPriceVnd,
          refType: 'DELIVERY',
          refId: deliveryId,
          refCode: code,
          at: now,
          note: `Giao cho đơn ${order.code}`,
        });
        await db.salesOrderItems.put({ ...item, deliveredQty: roundQty(item.deliveredQty + qty, 3) });
      }

      assertRule(
        deliveryItems.length > 0,
        `Không giao được dòng nào vì thiếu thành phẩm. ${shortfalls.join('; ')}`,
        'INSUFFICIENT_PRODUCT_STOCK',
      );

      const delivery: Delivery = {
        id: deliveryId,
        code,
        salesOrderId: orderId,
        status: 'POSTED',
        totalVnd,
        note: options.note?.trim() || undefined,
        createdAt: now,
        deliveredAt: now,
        createdBy: actor.employeeId,
        receivedBy: options.receivedBy?.trim() || undefined,
        revision: 1,
      };
      await db.deliveries.add(delivery);
      await db.deliveryItems.bulkAdd(deliveryItems);

      await recalcSalesOrderStatus(orderId);
      await logActivity({
        entityType: 'SALES_ORDER',
        entityId: orderId,
        action: 'DELIVERED',
        actor,
        summary: `Giao hàng ${code} cho đơn ${order.code} — ${deliveryItems.length} dòng, giá trị ${totalVnd.toLocaleString('vi-VN')} đ`,
        operationId: options.operationId,
      });
      await saveOperationReceipt(options.operationId, 'deliverSalesOrder', [delivery.id]);
      return delivery;
    },
  );
}

// ---------- Huỷ đơn ----------

export async function cancelSalesOrder(
  actor: Actor,
  orderId: string,
  reason: string,
  options: { operationId?: string } = {},
): Promise<SalesOrder> {
  assertAction(actor, 'order.cancel');
  assertRule(reason.trim().length >= 5, 'Vui lòng nhập lý do huỷ đơn (ít nhất 5 ký tự).');
  return db.transaction(
    'rw',
    [db.salesOrders, db.workOrders, db.workOrderStages, db.activityLogs, db.operationReceipts],
    async () => {
      const receipt = await getOperationReceipt(options.operationId);
      if (receipt) {
        const found = await db.salesOrders.get(receipt.resultEntityIds[0]);
        if (found) return found;
      }
      const order = await db.salesOrders.get(orderId);
      if (!order) throw new NotFoundError('Không tìm thấy đơn hàng cần huỷ.');
      assertRule(
        order.status === 'NEW' || order.status === 'APPROVED',
        'Chỉ được huỷ đơn ở trạng thái "Mới" hoặc "Đã duyệt". Đơn đã vào sản xuất cần xử lý lệnh sản xuất trước.',
        'INVALID_STATE',
      );
      const workOrders = await db.workOrders.where('salesOrderId').equals(orderId).toArray();
      const started = workOrders.filter((w) => w.status !== 'WAITING');
      assertRule(
        started.length === 0,
        `Có ${started.length} lệnh sản xuất đã bắt đầu (${started.map((w) => w.code).join(', ')}). Hãy hoàn tất hoặc xử lý các lệnh này trước khi huỷ đơn.`,
        'WORK_ORDER_RUNNING',
      );
      const now = nowIso();
      for (const workOrder of workOrders) {
        await db.workOrders.put({ ...workOrder, status: 'CANCELLED', updatedAt: now, revision: workOrder.revision + 1 });
      }
      const updated: SalesOrder = {
        ...order,
        status: 'CANCELLED',
        cancelledAt: now,
        cancelReason: reason.trim(),
        updatedAt: now,
        revision: order.revision + 1,
      };
      await db.salesOrders.put(updated);
      await logActivity({
        entityType: 'SALES_ORDER',
        entityId: order.id,
        action: 'CANCELLED',
        actor,
        summary: `Huỷ đơn ${order.code}: ${reason.trim()}${workOrders.length ? ` — huỷ ${workOrders.length} lệnh sản xuất chưa chạy` : ''}`,
        operationId: options.operationId,
      });
      await saveOperationReceipt(options.operationId, 'cancelSalesOrder', [order.id]);
      return updated;
    },
  );
}
