import { db } from '../db/database';
import { computeProductCost, type ProductCostBreakdown } from '../services/catalog';
import { roundQty } from '../utils/money';
import { toSearchName } from '../utils/text';
import type {
  BomMaterial,
  BomStage,
  Customer,
  Employee,
  Material,
  ProductionLog,
  Product,
  QcCheck,
  SalesOrder,
  SalesOrderItem,
  Team,
  WorkOrder,
  WorkOrderStage,
  WorkOrderStatus,
} from '../types';

// ---------- Đơn hàng ----------

export interface SalesOrderRow {
  order: SalesOrder;
  customer?: Customer;
  items: SalesOrderItem[];
  itemCount: number;
  totalQty: number;
  progressPct: number;
  workOrders: WorkOrder[];
  productNames: string;
  overdue: boolean;
}

export async function listSalesOrderRows(): Promise<SalesOrderRow[]> {
  const [orders, items, customers, products, workOrders, stages] = await Promise.all([
    db.salesOrders.toArray(),
    db.salesOrderItems.toArray(),
    db.customers.toArray(),
    db.products.toArray(),
    db.workOrders.toArray(),
    db.workOrderStages.toArray(),
  ]);
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const stagesByWorkOrder = new Map<string, WorkOrderStage[]>();
  for (const stage of stages) {
    const list = stagesByWorkOrder.get(stage.workOrderId) ?? [];
    list.push(stage);
    stagesByWorkOrder.set(stage.workOrderId, list);
  }
  const workOrdersByOrder = new Map<string, WorkOrder[]>();
  for (const workOrder of workOrders) {
    const list = workOrdersByOrder.get(workOrder.salesOrderId) ?? [];
    list.push(workOrder);
    workOrdersByOrder.set(workOrder.salesOrderId, list);
  }
  const itemsByOrder = new Map<string, SalesOrderItem[]>();
  for (const item of items) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.orderId, list);
  }
  const now = Date.now();
  const rows = orders.map((order) => {
    const orderItems = itemsByOrder.get(order.id) ?? [];
    const orderWorkOrders = workOrdersByOrder.get(order.id) ?? [];
    let totalQty = 0;
    let weighted = 0;
    for (const workOrder of orderWorkOrders) {
      const workStages = stagesByWorkOrder.get(workOrder.id) ?? [];
      const doneRatio = workStages.length > 0 ? workStages.filter((s) => s.status === 'DONE').length / workStages.length : 0;
      weighted += workOrder.quantity * doneRatio;
    }
    for (const item of orderItems) totalQty += item.quantity;
    let progressPct = totalQty > 0 ? Math.round((weighted / totalQty) * 100) : 0;
    if (order.status === 'DELIVERED') progressPct = 100;
    const names = [...new Set(orderItems.map((i) => productById.get(i.productId)?.name).filter(Boolean) as string[])];
    return {
      order,
      customer: customerById.get(order.customerId),
      items: orderItems,
      itemCount: orderItems.length,
      totalQty: roundQty(totalQty, 3),
      progressPct: Math.min(100, progressPct),
      workOrders: orderWorkOrders,
      productNames: names.join(', ') || '—',
      overdue: order.status !== 'DELIVERED' && order.status !== 'CANCELLED' && new Date(order.dueDate).getTime() < now,
    } satisfies SalesOrderRow;
  });
  return rows.sort((a, b) => a.order.dueDate.localeCompare(b.order.dueDate));
}

export async function getSalesOrderRow(orderId: string): Promise<SalesOrderRow | undefined> {
  const rows = await listSalesOrderRows();
  return rows.find((r) => r.order.id === orderId);
}

// ---------- Lệnh sản xuất ----------

export interface WorkOrderRow {
  workOrder: WorkOrder;
  product?: Product;
  salesOrder?: SalesOrder;
  customer?: Customer;
  stages: WorkOrderStage[];
  doneStages: number;
  currentStage?: WorkOrderStage;
  teamName?: string;
  goodQty: number;
  badQty: number;
  overdue: boolean;
}

export async function listWorkOrderRows(options: { statuses?: WorkOrderStatus[] } = {}): Promise<WorkOrderRow[]> {
  const [workOrders, stages, products, orders, customers, logs, teams] = await Promise.all([
    db.workOrders.toArray(),
    db.workOrderStages.toArray(),
    db.products.toArray(),
    db.salesOrders.toArray(),
    db.customers.toArray(),
    db.productionLogs.toArray(),
    db.teams.toArray(),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const stagesByWorkOrder = new Map<string, WorkOrderStage[]>();
  for (const stage of stages) {
    const list = stagesByWorkOrder.get(stage.workOrderId) ?? [];
    list.push(stage);
    stagesByWorkOrder.set(stage.workOrderId, list);
  }
  const logsByWorkOrder = new Map<string, ProductionLog[]>();
  for (const log of logs) {
    const list = logsByWorkOrder.get(log.workOrderId) ?? [];
    list.push(log);
    logsByWorkOrder.set(log.workOrderId, list);
  }
  const now = Date.now();
  const rows = workOrders
    .filter((w) => (options.statuses ? options.statuses.includes(w.status) : true))
    .map((workOrder) => {
      const workStages = (stagesByWorkOrder.get(workOrder.id) ?? []).sort((a, b) => a.seq - b.seq);
      const workLogs = logsByWorkOrder.get(workOrder.id) ?? [];
      const currentStage =
        workStages.find((s) => s.status === 'IN_PROGRESS') ?? workStages.find((s) => s.status === 'PENDING') ?? workStages[workStages.length - 1];
      const order = orderById.get(workOrder.salesOrderId);
      return {
        workOrder,
        product: productById.get(workOrder.productId),
        salesOrder: order,
        customer: order ? customerById.get(order.customerId) : undefined,
        stages: workStages,
        doneStages: workStages.filter((s) => s.status === 'DONE').length,
        currentStage,
        teamName: currentStage ? teamById.get(currentStage.teamId)?.name : undefined,
        goodQty: roundQty(workLogs.reduce((s, l) => s + l.quantityGood, 0), 3),
        badQty: roundQty(workLogs.reduce((s, l) => s + l.quantityBad, 0), 3),
        overdue: workOrder.status !== 'DONE' && workOrder.status !== 'CANCELLED' && new Date(workOrder.dueDate).getTime() < now,
      } satisfies WorkOrderRow;
    });
  return rows.sort((a, b) => a.workOrder.dueDate.localeCompare(b.workOrder.dueDate));
}

export async function getWorkOrderRow(workOrderId: string): Promise<WorkOrderRow | undefined> {
  const rows = await listWorkOrderRows();
  return rows.find((r) => r.workOrder.id === workOrderId);
}

// ---------- Vật tư ----------

export interface MaterialRow {
  material: Material;
  low: boolean;
  valueVnd: number;
}

export function materialRowsFromList(materials: Material[], keyword: string): MaterialRow[] {
  const key = toSearchName(keyword.trim());
  return materials
    .filter((m) => (key ? m.searchName.includes(key) : true))
    .map((material) => ({
      material,
      low: material.stockQty < material.minQty,
      valueVnd: Math.round(material.stockQty * material.avgCostVnd),
    }))
    .sort((a, b) => a.material.code.localeCompare(b.material.code));
}

export async function listMaterialRows(keyword = ''): Promise<MaterialRow[]> {
  const materials = await db.materials.toArray();
  return materialRowsFromList(materials, keyword);
}

// ---------- Sản phẩm & BOM ----------

export interface ProductRow {
  product: Product;
  stages: BomStage[];
  bomMaterials: BomMaterial[];
  materialCount: number;
  stageCount: number;
  cost: ProductCostBreakdown;
  stockQty: number;
}

export async function listProductRows(): Promise<ProductRow[]> {
  const [products, stages, bomMaterials, materials, stockRows] = await Promise.all([
    db.products.toArray(),
    db.bomStages.toArray(),
    db.bomMaterials.toArray(),
    db.materials.toArray(),
    db.productStock.toArray(),
  ]);
  const materialById = new Map(materials.map((m) => [m.id, m]));
  const stockByProduct = new Map(stockRows.map((s) => [s.productId, s.quantity]));
  return products
    .map((product) => {
      const productStages = stages.filter((s) => s.productId === product.id).sort((a, b) => a.seq - b.seq);
      const productBomMaterials = bomMaterials.filter((m) => m.productId === product.id);
      return {
        product,
        stages: productStages,
        bomMaterials: productBomMaterials,
        materialCount: productBomMaterials.length,
        stageCount: productStages.length,
        cost: computeProductCost(productStages, productBomMaterials, materialById),
        stockQty: stockByProduct.get(product.id) ?? 0,
      } satisfies ProductRow;
    })
    .sort((a, b) => a.product.code.localeCompare(b.product.code));
}

export async function getProductRow(productId: string): Promise<ProductRow | undefined> {
  const rows = await listProductRows();
  return rows.find((r) => r.product.id === productId);
}

// ---------- Phiếu sản lượng ----------

export interface ProductionLogRow {
  log: ProductionLog;
  workOrder?: WorkOrder;
  product?: Product;
  stage?: WorkOrderStage;
  team?: Team;
  employee?: Employee;
}

export async function listProductionLogRows(): Promise<ProductionLogRow[]> {
  const [logs, workOrders, products, stages, teams, employees] = await Promise.all([
    db.productionLogs.toArray(),
    db.workOrders.toArray(),
    db.products.toArray(),
    db.workOrderStages.toArray(),
    db.teams.toArray(),
    db.employees.toArray(),
  ]);
  const workOrderById = new Map(workOrders.map((w) => [w.id, w]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  return logs
    .map((log) => {
      const workOrder = workOrderById.get(log.workOrderId);
      return {
        log,
        workOrder,
        product: workOrder ? productById.get(workOrder.productId) : undefined,
        stage: stageById.get(log.stageId),
        team: teamById.get(log.teamId),
        employee: employeeById.get(log.employeeId),
      } satisfies ProductionLogRow;
    })
    .sort((a, b) => (b.log.createdAt ?? '').localeCompare(a.log.createdAt ?? ''));
}

// ---------- Phiếu QC ----------

export interface QcCheckRow {
  check: QcCheck;
  workOrder?: WorkOrder;
  product?: Product;
  teamName?: string;
  checker?: Employee;
}

export async function listQcCheckRows(): Promise<QcCheckRow[]> {
  const [checks, workOrders, products, stages, teams, employees] = await Promise.all([
    db.qcChecks.toArray(),
    db.workOrders.toArray(),
    db.products.toArray(),
    db.workOrderStages.toArray(),
    db.teams.toArray(),
    db.employees.toArray(),
  ]);
  const workOrderById = new Map(workOrders.map((w) => [w.id, w]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  return checks
    .map((check) => {
      const workOrder = workOrderById.get(check.workOrderId);
      const workStages = stages.filter((s) => s.workOrderId === check.workOrderId).sort((a, b) => a.seq - b.seq);
      const lastStage = workStages[workStages.length - 1];
      return {
        check,
        workOrder,
        product: workOrder ? productById.get(workOrder.productId) : undefined,
        teamName: lastStage ? teamById.get(lastStage.teamId)?.name : undefined,
        checker: employeeById.get(check.checkedById),
      } satisfies QcCheckRow;
    })
    .sort((a, b) => b.check.checkedAt.localeCompare(a.check.checkedAt));
}
