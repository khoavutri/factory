import dayjs from 'dayjs';
import { db } from '../db/database';
import { roundQty } from '../utils/money';
import { toDateKey } from '../utils/format';
import { materialDemand } from '../services/inventory';
import { listSalesOrderRows, listWorkOrderRows } from './lists';
import type { ActivityLog, DefectType, Team, WorkOrder, WorkOrderStage } from '../types';

// ---------- Tổng quan ----------

export interface DashboardData {
  runningWorkOrders: number;
  todayGood: number;
  dueSoonOrders: number;
  overdueOrders: number;
  qcPassRate30: number;
  lowStockCount: number;
  waitingDeliveryValueVnd: number;
  revenue30Vnd: number;
  materialCost30Vnd: number;
  payrollThisMonthVnd: number;
  output14: Array<{ dateKey: string; good: number; bad: number }>;
  stageCounts: Array<{ teamId: string; teamName: string; count: number; running: number }>;
  overdueList: Array<{ orderId: string; code: string; customerName: string; dueDate: string; daysLate: number; valueVnd: number }>;
  shortageList: Array<{ workOrderId: string; workOrderCode: string; productName: string; materialName: string; missingQty: number; unit: string }>;
  reworkList: Array<{ workOrderId: string; code: string; productName: string; reworkCount: number; dueDate: string }>;
  recentActivities: ActivityLog[];
}

export async function getDashboardData(): Promise<DashboardData> {
  const now = dayjs();
  const todayKey = now.format('YYYY-MM-DD');
  const from30 = now.subtract(29, 'day').startOf('day').toISOString();
  const next7 = now.add(7, 'day').endOf('day').toISOString();

  const [workOrderRows, orderRows, logs, materials, movements, checks, teams, activities, deliveries] = await Promise.all([
    listWorkOrderRows(),
    listSalesOrderRows(),
    db.productionLogs.toArray(),
    db.materials.toArray(),
    db.stockMovements.toArray(),
    db.qcChecks.toArray(),
    db.teams.toArray(),
    db.activityLogs.orderBy('at').reverse().limit(10).toArray(),
    db.deliveries.toArray(),
  ]);

  const activeWorkOrders = workOrderRows.filter(
    (r) => r.workOrder.status === 'WAITING' || r.workOrder.status === 'IN_PROGRESS' || r.workOrder.status === 'AWAITING_QC',
  );
  const runningWorkOrders = workOrderRows.filter((r) => r.workOrder.status === 'IN_PROGRESS').length;

  const todayGood = roundQty(
    logs.filter((l) => l.date === todayKey).reduce((s, l) => s + l.quantityGood, 0),
    3,
  );

  const activeOrders = orderRows.filter((r) => r.order.status !== 'CANCELLED' && r.order.status !== 'DELIVERED');
  const dueSoonOrders = activeOrders.filter((r) => {
    const due = dayjs(r.order.dueDate);
    return due.isAfter(now) && due.isBefore(next7);
  }).length;
  const overdueList = activeOrders
    .filter((r) => dayjs(r.order.dueDate).isBefore(now))
    .map((r) => ({
      orderId: r.order.id,
      code: r.order.code,
      customerName: r.customer?.name ?? '—',
      dueDate: r.order.dueDate,
      daysLate: Math.max(1, now.startOf('day').diff(dayjs(r.order.dueDate).startOf('day'), 'day')),
      valueVnd: r.order.totalVnd,
    }))
    .sort((a, b) => b.daysLate - a.daysLate);

  const checks30 = checks.filter((c) => dayjs(c.checkedAt).isAfter(from30));
  const qcPassRate30 = checks30.length > 0 ? Math.round((checks30.filter((c) => c.result === 'PASSED').length / checks30.length) * 100) : 100;

  const lowStock = materials.filter((m) => m.active && m.stockQty < m.minQty);

  const waitingDeliveryValueVnd = activeOrders.reduce(
    (sum, r) => sum + r.items.reduce((s, i) => s + Math.max(0, i.quantity - i.deliveredQty) * i.unitPriceVnd, 0),
    0,
  );

  const revenue30Vnd = deliveries
    .filter((d) => d.status === 'POSTED' && d.deliveredAt && d.deliveredAt >= from30)
    .reduce((s, d) => s + d.totalVnd, 0);

  const materialCost30Vnd = movements
    .filter((m) => m.type === 'ISSUE_OUT' && m.at >= from30)
    .reduce((s, m) => s + Math.round(m.quantity * (m.unitCostVnd ?? 0)), 0);

  const monthStart = now.startOf('month').format('YYYY-MM-DD');
  const payrollThisMonthVnd = logs.filter((l) => l.date >= monthStart).reduce((s, l) => s + l.amountVnd, 0);

  const output14: Array<{ dateKey: string; good: number; bad: number }> = [];
  for (let i = 13; i >= 0; i -= 1) {
    const key = now.subtract(i, 'day').format('YYYY-MM-DD');
    const dayLogs = logs.filter((l) => l.date === key);
    output14.push({
      dateKey: key,
      good: roundQty(dayLogs.reduce((s, l) => s + l.quantityGood, 0), 3),
      bad: roundQty(dayLogs.reduce((s, l) => s + l.quantityBad, 0), 3),
    });
  }

  const teamById = new Map<string, Team>(teams.map((t) => [t.id, t]));
  const stageCounter = new Map<string, { count: number; running: number }>();
  for (const row of activeWorkOrders) {
    // Chỉ đếm lệnh đang ở xưởng (chờ hoặc đang sản xuất), khớp với cột Kanban
    if (row.workOrder.status !== 'WAITING' && row.workOrder.status !== 'IN_PROGRESS') continue;
    const stage = row.currentStage;
    if (!stage) continue;
    const entry = stageCounter.get(stage.teamId) ?? { count: 0, running: 0 };
    entry.count += 1;
    if (stage.status === 'IN_PROGRESS') entry.running += 1;
    stageCounter.set(stage.teamId, entry);
  }
  const stageCounts = [...stageCounter.entries()]
    .map(([teamId, value]) => ({ teamId, teamName: teamById.get(teamId)?.name ?? 'Chưa rõ tổ', ...value }))
    .sort((a, b) => b.count - a.count);

  // Cảnh báo thiếu vật tư theo các lệnh đang chạy
  const shortageList: DashboardData['shortageList'] = [];
  for (const row of activeWorkOrders.slice(0, 30)) {
    if (!(row.workOrder.status === 'WAITING' || row.workOrder.status === 'IN_PROGRESS')) continue;
    const demand = await materialDemand(row.workOrder.id);
    for (const line of demand) {
      if (line.missingQty > 0) {
        shortageList.push({
          workOrderId: row.workOrder.id,
          workOrderCode: row.workOrder.code,
          productName: row.product?.name ?? '—',
          materialName: line.material.name,
          missingQty: line.missingQty,
          unit: line.material.unit,
        });
      }
    }
    if (shortageList.length >= 8) break;
  }

  const reworkList = workOrderRows
    .filter((r) => r.workOrder.reworkCount > 0 && (r.workOrder.status === 'IN_PROGRESS' || r.workOrder.status === 'AWAITING_QC'))
    .map((r) => ({
      workOrderId: r.workOrder.id,
      code: r.workOrder.code,
      productName: r.product?.name ?? '—',
      reworkCount: r.workOrder.reworkCount,
      dueDate: r.workOrder.dueDate,
    }));

  return {
    runningWorkOrders,
    todayGood,
    dueSoonOrders,
    overdueOrders: overdueList.length,
    qcPassRate30,
    lowStockCount: lowStock.length,
    waitingDeliveryValueVnd,
    revenue30Vnd,
    materialCost30Vnd,
    payrollThisMonthVnd,
    output14,
    stageCounts,
    overdueList: overdueList.slice(0, 5),
    shortageList: shortageList.slice(0, 5),
    reworkList: reworkList.slice(0, 5),
    recentActivities: activities.slice(0, 8),
  };
}

// ---------- Báo cáo ----------

export interface OutputByDayRow {
  dateKey: string;
  good: number;
  bad: number;
  logCount: number;
  amountVnd: number;
}

export async function outputByDay(fromIso: string, toIso: string): Promise<OutputByDayRow[]> {
  const logs = await db.productionLogs.toArray();
  const fromKey = toDateKey(fromIso);
  const toKey = toDateKey(toIso);
  const map = new Map<string, OutputByDayRow>();
  for (const log of logs) {
    if (log.date < fromKey || log.date > toKey) continue;
    const row = map.get(log.date) ?? { dateKey: log.date, good: 0, bad: 0, logCount: 0, amountVnd: 0 };
    row.good += log.quantityGood;
    row.bad += log.quantityBad;
    row.logCount += 1;
    row.amountVnd += log.amountVnd;
    map.set(log.date, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, good: roundQty(r.good, 3), bad: roundQty(r.bad, 3) }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export interface OutputByTeamRow {
  teamId: string;
  teamName: string;
  good: number;
  bad: number;
  amountVnd: number;
  logCount: number;
  errorRate: number;
}

export async function outputByTeam(fromIso: string, toIso: string): Promise<OutputByTeamRow[]> {
  const [logs, teams] = await Promise.all([db.productionLogs.toArray(), db.teams.toArray()]);
  const fromKey = toDateKey(fromIso);
  const toKey = toDateKey(toIso);
  const inRange = logs.filter((l) => l.date >= fromKey && l.date <= toKey);
  return teams
    .map((team) => {
      const teamLogs = inRange.filter((l) => l.teamId === team.id);
      const good = roundQty(teamLogs.reduce((s, l) => s + l.quantityGood, 0), 3);
      const bad = roundQty(teamLogs.reduce((s, l) => s + l.quantityBad, 0), 3);
      return {
        teamId: team.id,
        teamName: team.name,
        good,
        bad,
        amountVnd: teamLogs.reduce((s, l) => s + l.amountVnd, 0),
        logCount: teamLogs.length,
        errorRate: good + bad > 0 ? Math.round((bad / (good + bad)) * 1000) / 10 : 0,
      } satisfies OutputByTeamRow;
    })
    .sort((a, b) => b.good - a.good);
}

export interface OutputByStageRow {
  stageId: string;
  stageName: string;
  teamName: string;
  good: number;
  bad: number;
  amountVnd: number;
}

export async function outputByStage(fromIso: string, toIso: string): Promise<OutputByStageRow[]> {
  const [logs, stages, teams] = await Promise.all([db.productionLogs.toArray(), db.workOrderStages.toArray(), db.teams.toArray()]);
  const fromKey = toDateKey(fromIso);
  const toKey = toDateKey(toIso);
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const map = new Map<string, OutputByStageRow>();
  for (const log of logs) {
    if (log.date < fromKey || log.date > toKey) continue;
    const stage = stageById.get(log.stageId);
    const key = stage?.name ?? 'Không xác định';
    const row =
      map.get(key) ??
      ({ stageId: log.stageId, stageName: key, teamName: teamById.get(log.teamId)?.name ?? '—', good: 0, bad: 0, amountVnd: 0 } satisfies OutputByStageRow);
    row.good += log.quantityGood;
    row.bad += log.quantityBad;
    row.amountVnd += log.amountVnd;
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, good: roundQty(r.good, 3), bad: roundQty(r.bad, 3) }))
    .sort((a, b) => b.good - a.good);
}

export interface OutputByProductRow {
  productId: string;
  productCode: string;
  productName: string;
  good: number;
  bad: number;
  goodQtyCompleted: number;
}

export async function outputByProduct(fromIso: string, toIso: string): Promise<OutputByProductRow[]> {
  const [logs, workOrders, products] = await Promise.all([db.productionLogs.toArray(), db.workOrders.toArray(), db.products.toArray()]);
  const fromKey = toDateKey(fromIso);
  const toKey = toDateKey(toIso);
  const workOrderById = new Map(workOrders.map((w) => [w.id, w]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const map = new Map<string, OutputByProductRow>();
  for (const log of logs) {
    const workOrder = workOrderById.get(log.workOrderId);
    if (!workOrder) continue;
    const product = productById.get(workOrder.productId);
    if (!product) continue;
    const row =
      map.get(product.id) ??
      ({
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        good: 0,
        bad: 0,
        goodQtyCompleted: 0,
      } satisfies OutputByProductRow);
    if (log.date >= fromKey && log.date <= toKey) {
      row.good += log.quantityGood;
      row.bad += log.quantityBad;
    }
    map.set(product.id, row);
  }
  for (const workOrder of workOrders) {
    if (workOrder.status !== 'DONE' || !workOrder.finishedAt) continue;
    const finishKey = toDateKey(workOrder.finishedAt);
    if (finishKey < fromKey || finishKey > toKey) continue;
    const row = map.get(workOrder.productId);
    if (row) row.goodQtyCompleted += workOrder.quantity;
  }
  return [...map.values()]
    .map((r) => ({ ...r, good: roundQty(r.good, 3), bad: roundQty(r.bad, 3), goodQtyCompleted: roundQty(r.goodQtyCompleted, 3) }))
    .sort((a, b) => b.good - a.good);
}

export interface QualityWeeklyRow {
  weekStart: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
}

export async function qualityByWeek(fromIso: string, toIso: string): Promise<QualityWeeklyRow[]> {
  const checks = await db.qcChecks.toArray();
  const map = new Map<string, QualityWeeklyRow>();
  for (const check of checks) {
    if (check.checkedAt < fromIso || check.checkedAt > toIso) continue;
    const weekStart = dayjs(check.checkedAt).startOf('week').add(1, 'day').format('YYYY-MM-DD');
    const row = map.get(weekStart) ?? { weekStart, total: 0, passed: 0, failed: 0, passRate: 0 };
    row.total += 1;
    if (check.result === 'PASSED') row.passed += 1;
    else row.failed += 1;
    row.passRate = Math.round((row.passed / row.total) * 100);
    map.set(weekStart, row);
  }
  return [...map.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export interface DefectRow {
  defectType: DefectType;
  count: number;
  failedQty: number;
}

export async function defectsByType(fromIso: string, toIso: string): Promise<DefectRow[]> {
  const checks = await db.qcChecks.toArray();
  const map = new Map<DefectType, DefectRow>();
  for (const check of checks) {
    if (check.result !== 'FAILED') continue;
    if (check.checkedAt < fromIso || check.checkedAt > toIso) continue;
    const row = map.get(check.defectType) ?? { defectType: check.defectType, count: 0, failedQty: 0 };
    row.count += 1;
    row.failedQty += check.failedQty;
    map.set(check.defectType, row);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export interface QualityByTeamRow {
  teamName: string;
  total: number;
  failed: number;
  failedQty: number;
}

export async function defectsByTeam(fromIso: string, toIso: string): Promise<QualityByTeamRow[]> {
  const [checks, stages, teams] = await Promise.all([db.qcChecks.toArray(), db.workOrderStages.toArray(), db.teams.toArray()]);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const map = new Map<string, QualityByTeamRow>();
  for (const check of checks) {
    if (check.checkedAt < fromIso || check.checkedAt > toIso) continue;
    const workStages = stages.filter((s) => s.workOrderId === check.workOrderId).sort((a, b) => a.seq - b.seq);
    const lastStage = workStages[workStages.length - 1];
    const teamName = lastStage ? teamById.get(lastStage.teamId)?.name ?? 'Chưa rõ tổ' : 'Chưa rõ tổ';
    const row = map.get(teamName) ?? { teamName, total: 0, failed: 0, failedQty: 0 };
    row.total += 1;
    if (check.result === 'FAILED') {
      row.failed += 1;
      row.failedQty += check.failedQty;
    }
    map.set(teamName, row);
  }
  return [...map.values()].sort((a, b) => b.failed - a.failed);
}

export interface QualityByEmployeeRow {
  employeeName: string;
  good: number;
  bad: number;
  errorRate: number;
}

export async function qualityByEmployee(fromIso: string, toIso: string): Promise<QualityByEmployeeRow[]> {
  const [logs, employees] = await Promise.all([db.productionLogs.toArray(), db.employees.toArray()]);
  const fromKey = toDateKey(fromIso);
  const toKey = toDateKey(toIso);
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const map = new Map<string, QualityByEmployeeRow>();
  for (const log of logs) {
    if (log.date < fromKey || log.date > toKey) continue;
    const employee = employeeById.get(log.employeeId);
    if (!employee) continue;
    const row = map.get(employee.id) ?? { employeeName: employee.name, good: 0, bad: 0, errorRate: 0 };
    row.good += log.quantityGood;
    row.bad += log.quantityBad;
    row.errorRate = Math.round((row.bad / (row.good + row.bad)) * 1000) / 10;
    map.set(employee.id, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, good: roundQty(r.good, 3), bad: roundQty(r.bad, 3) }))
    .sort((a, b) => b.errorRate - a.errorRate);
}

export interface MaterialCostByProductRow {
  productId: string;
  productCode: string;
  productName: string;
  materialCostVnd: number;
  producedQty: number;
  unitCostVnd: number;
}

export async function materialCostByProduct(fromIso: string, toIso: string): Promise<MaterialCostByProductRow[]> {
  const [issues, items, workOrders, products] = await Promise.all([
    db.materialIssues.toArray(),
    db.materialIssueItems.toArray(),
    db.workOrders.toArray(),
    db.products.toArray(),
  ]);
  const workOrderById = new Map(workOrders.map((w) => [w.id, w]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const itemsByIssue = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByIssue.get(item.issueId) ?? [];
    list.push(item);
    itemsByIssue.set(item.issueId, list);
  }
  const map = new Map<string, MaterialCostByProductRow>();
  for (const issue of issues) {
    if (issue.status !== 'POSTED' || !issue.postedAt) continue;
    if (issue.postedAt < fromIso || issue.postedAt > toIso) continue;
    const workOrder = workOrderById.get(issue.workOrderId);
    if (!workOrder) continue;
    const product = productById.get(workOrder.productId);
    if (!product) continue;
    const row =
      map.get(product.id) ??
      ({
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        materialCostVnd: 0,
        producedQty: 0,
        unitCostVnd: 0,
      } satisfies MaterialCostByProductRow);
    const cost = (itemsByIssue.get(issue.id) ?? []).reduce((s, i) => s + Math.round(i.quantity * i.unitCostVnd), 0);
    row.materialCostVnd += cost;
    row.producedQty += workOrder.quantity;
    row.unitCostVnd = row.producedQty > 0 ? Math.round(row.materialCostVnd / row.producedQty) : 0;
    map.set(product.id, row);
  }
  return [...map.values()].sort((a, b) => b.materialCostVnd - a.materialCostVnd);
}

export interface CostByWorkOrderRow {
  workOrderId: string;
  code: string;
  productName: string;
  quantity: number;
  materialCostVnd: number;
  laborCostVnd: number;
  totalCostVnd: number;
  unitCostVnd: number;
  revenueVnd: number;
  marginVnd: number;
}

export async function costByWorkOrder(fromIso: string, toIso: string): Promise<CostByWorkOrderRow[]> {
  const [workOrders, products, issues, items, logs, stages, orderItems] = await Promise.all([
    db.workOrders.toArray(),
    db.products.toArray(),
    db.materialIssues.toArray(),
    db.materialIssueItems.toArray(),
    db.productionLogs.toArray(),
    db.workOrderStages.toArray(),
    db.salesOrderItems.toArray(),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const itemById = new Map(orderItems.map((i) => [i.id, i]));
  const itemsByIssue = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByIssue.get(item.issueId) ?? [];
    list.push(item);
    itemsByIssue.set(item.issueId, list);
  }
  const rows: CostByWorkOrderRow[] = [];
  for (const workOrder of workOrders) {
    if (workOrder.createdAt < fromIso || workOrder.createdAt > toIso) continue;
    if (workOrder.status === 'CANCELLED') continue;
    const product = productById.get(workOrder.productId);
    if (!product) continue;
    const materialCostVnd = issues
      .filter((i) => i.workOrderId === workOrder.id && i.status === 'POSTED')
      .reduce((s, issue) => s + (itemsByIssue.get(issue.id) ?? []).reduce((x, i) => x + Math.round(i.quantity * i.unitCostVnd), 0), 0);
    const logRows = logs.filter((l) => l.workOrderId === workOrder.id);
    const laborCostVnd = logRows.reduce((s, l) => {
      const stage = stageById.get(l.stageId);
      return s + (stage ? l.quantityGood * stage.pieceRateVnd : l.amountVnd);
    }, 0);
    const orderItem = itemById.get(workOrder.salesOrderItemId);
    const revenueVnd = Math.round(workOrder.quantity * (orderItem?.unitPriceVnd ?? product.salePriceVnd));
    const totalCostVnd = materialCostVnd + laborCostVnd;
    rows.push({
      workOrderId: workOrder.id,
      code: workOrder.code,
      productName: product.name,
      quantity: workOrder.quantity,
      materialCostVnd,
      laborCostVnd,
      totalCostVnd,
      unitCostVnd: workOrder.quantity > 0 ? Math.round(totalCostVnd / workOrder.quantity) : 0,
      revenueVnd,
      marginVnd: revenueVnd - totalCostVnd,
    });
  }
  return rows.sort((a, b) => b.totalCostVnd - a.totalCostVnd);
}

export interface PayrollByTeamRow {
  teamId: string;
  teamName: string;
  amountVnd: number;
  quantityGood: number;
  employeeCount: number;
}

export async function payrollByTeam(fromIso: string, toIso: string): Promise<PayrollByTeamRow[]> {
  const [logs, teams, employees] = await Promise.all([db.productionLogs.toArray(), db.teams.toArray(), db.employees.toArray()]);
  const fromKey = toDateKey(fromIso);
  const toKey = toDateKey(toIso);
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  return teams
    .map((team) => {
      const teamLogs = logs.filter((l) => l.teamId === team.id && l.date >= fromKey && l.date <= toKey);
      const employeeIds = new Set(teamLogs.map((l) => l.employeeId).filter((id) => employeeById.has(id)));
      return {
        teamId: team.id,
        teamName: team.name,
        amountVnd: teamLogs.reduce((s, l) => s + l.amountVnd, 0),
        quantityGood: roundQty(teamLogs.reduce((s, l) => s + l.quantityGood, 0), 3),
        employeeCount: employeeIds.size,
      } satisfies PayrollByTeamRow;
    })
    .sort((a, b) => b.amountVnd - a.amountVnd);
}

export interface LeadTimeRow {
  orderId: string;
  code: string;
  customerName: string;
  approvedAt?: string;
  deliveredAt?: string;
  leadTimeDays?: number;
  dueDate: string;
  lateDays: number;
}

export async function leadTimeReport(fromIso: string, toIso: string): Promise<{ rows: LeadTimeRow[]; averageDays: number | null }> {
  const [orders, deliveries, customers] = await Promise.all([db.salesOrders.toArray(), db.deliveries.toArray(), db.customers.toArray()]);
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const firstDelivery = new Map<string, string>();
  for (const delivery of deliveries) {
    if (delivery.status !== 'POSTED' || !delivery.deliveredAt) continue;
    const current = firstDelivery.get(delivery.salesOrderId);
    if (!current || delivery.deliveredAt < current) firstDelivery.set(delivery.salesOrderId, delivery.deliveredAt);
  }
  const rows: LeadTimeRow[] = [];
  for (const order of orders) {
    const deliveredAt = firstDelivery.get(order.id);
    const reference = deliveredAt ?? order.createdAt;
    if (reference < fromIso || reference > toIso) continue;
    const leadTimeDays =
      order.approvedAt && deliveredAt ? Math.round(dayjs(deliveredAt).diff(dayjs(order.approvedAt), 'day', true) * 10) / 10 : undefined;
    rows.push({
      orderId: order.id,
      code: order.code,
      customerName: customerById.get(order.customerId)?.name ?? '—',
      approvedAt: order.approvedAt,
      deliveredAt,
      leadTimeDays,
      dueDate: order.dueDate,
      lateDays:
        deliveredAt && dayjs(deliveredAt).isAfter(dayjs(order.dueDate))
          ? Math.max(0, dayjs(deliveredAt).startOf('day').diff(dayjs(order.dueDate).startOf('day'), 'day'))
          : !deliveredAt && dayjs(order.dueDate).isBefore(dayjs())
            ? Math.max(0, dayjs().startOf('day').diff(dayjs(order.dueDate).startOf('day'), 'day'))
            : 0,
    });
  }
  const withLead = rows.filter((r) => r.leadTimeDays != null);
  const averageDays = withLead.length > 0 ? Math.round((withLead.reduce((s, r) => s + (r.leadTimeDays ?? 0), 0) / withLead.length) * 10) / 10 : null;
  return { rows: rows.sort((a, b) => b.lateDays - a.lateDays), averageDays };
}

export interface OrderProgressRow {
  orderId: string;
  code: string;
  customerName: string;
  status: string;
  dueDate: string;
  progressPct: number;
  workOrdersTotal: number;
  workOrdersDone: number;
  overdue: boolean;
}

export async function orderProgressReport(): Promise<OrderProgressRow[]> {
  const rows = await listSalesOrderRows();
  const workOrderRows = await listWorkOrderRows();
  return rows.map((row) => {
    const workOrders = workOrderRows.filter((w) => w.workOrder.salesOrderId === row.order.id);
    return {
      orderId: row.order.id,
      code: row.order.code,
      customerName: row.customer?.name ?? '—',
      status: row.order.status,
      dueDate: row.order.dueDate,
      progressPct: row.progressPct,
      workOrdersTotal: workOrders.length,
      workOrdersDone: workOrders.filter((w) => w.workOrder.status === 'DONE').length,
      overdue: row.overdue,
    };
  });
}

export interface RunningWorkOrderRow {
  workOrderId: string;
  code: string;
  productName: string;
  quantity: number;
  teamName: string;
  stageName: string;
  dueDate: string;
  overdue: boolean;
  reworkCount: number;
}

export async function runningWorkOrders(): Promise<RunningWorkOrderRow[]> {
  const rows = await listWorkOrderRows();
  return rows
    .filter((r) => r.workOrder.status === 'IN_PROGRESS' || r.workOrder.status === 'AWAITING_QC' || r.workOrder.status === 'WAITING')
    .map((r) => ({
      workOrderId: r.workOrder.id,
      code: r.workOrder.code,
      productName: r.product?.name ?? '—',
      quantity: r.workOrder.quantity,
      teamName: r.teamName ?? '—',
      stageName: r.currentStage?.name ?? '—',
      dueDate: r.workOrder.dueDate,
      overdue: r.overdue,
      reworkCount: r.workOrder.reworkCount,
    }));
}

/** Thẻ Kanban: công đoạn đang làm, hoặc công đoạn kế tiếp đang chờ tại tổ */
export interface KanbanCard {
  workOrder: WorkOrder;
  stage: WorkOrderStage;
  productName: string;
  productCode: string;
  customerName: string;
  orderCode: string;
  loggedGood: number;
  totalStages: number;
  overdue: boolean;
}

export async function kanbanCards(): Promise<KanbanCard[]> {
  const rows = await listWorkOrderRows();
  const logs = await db.productionLogs.toArray();
  const cards: KanbanCard[] = [];
  for (const row of rows) {
    if (row.workOrder.status !== 'WAITING' && row.workOrder.status !== 'IN_PROGRESS') continue;
    const stage = row.stages.find((s) => s.status === 'IN_PROGRESS') ?? row.stages.find((s) => s.status === 'PENDING');
    if (!stage) continue;
    const loggedGood = logs.filter((l) => l.stageId === stage.id).reduce((s, l) => s + l.quantityGood, 0);
    cards.push({
      workOrder: row.workOrder,
      stage,
      productName: row.product?.name ?? '—',
      productCode: row.product?.code ?? '—',
      customerName: row.customer?.name ?? '—',
      orderCode: row.salesOrder?.code ?? '—',
      loggedGood: roundQty(loggedGood, 3),
      totalStages: row.stages.length,
      overdue: row.overdue,
    });
  }
  return cards;
}

// ---------- CSV ----------

export function toCsv(rows: ReadonlyArray<object>, headers: Array<{ key: string; label: string }>): string {
  const headerLine = headers.map((h) => `"${h.label}"`).join(',');
  const lines = rows.map((row) => headers.map((h) => `"${String((row as Record<string, unknown>)[h.key] ?? '').replace(/"/g, '""')}"`).join(','));
  return [headerLine, ...lines].join('\r\n');
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
