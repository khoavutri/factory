import Dexie, { type EntityTable } from 'dexie';
import type {
  ActivityLog,
  AppMetaRecord,
  BomMaterial,
  BomStage,
  Customer,
  Delivery,
  DeliveryItem,
  DocumentSequence,
  Employee,
  Material,
  MaterialIssue,
  MaterialIssueItem,
  MaterialReceipt,
  MaterialReceiptItem,
  OperationReceipt,
  PayrollLine,
  PayrollPeriod,
  Product,
  ProductStock,
  ProductionLog,
  QcCheck,
  SalesOrder,
  SalesOrderItem,
  SettingRecord,
  StockMovement,
  Supplier,
  Team,
  WorkOrder,
  WorkOrderStage,
} from '../types';

export const DB_NAME = 'factoryone';
export const SCHEMA_VERSION = 1;

type FactoryDB = Dexie & {
  teams: EntityTable<Team, 'id'>;
  employees: EntityTable<Employee, 'id'>;
  suppliers: EntityTable<Supplier, 'id'>;
  materials: EntityTable<Material, 'id'>;
  products: EntityTable<Product, 'id'>;
  bomStages: EntityTable<BomStage, 'id'>;
  bomMaterials: EntityTable<BomMaterial, 'id'>;
  customers: EntityTable<Customer, 'id'>;
  salesOrders: EntityTable<SalesOrder, 'id'>;
  salesOrderItems: EntityTable<SalesOrderItem, 'id'>;
  workOrders: EntityTable<WorkOrder, 'id'>;
  workOrderStages: EntityTable<WorkOrderStage, 'id'>;
  productionLogs: EntityTable<ProductionLog, 'id'>;
  qcChecks: EntityTable<QcCheck, 'id'>;
  materialReceipts: EntityTable<MaterialReceipt, 'id'>;
  materialReceiptItems: EntityTable<MaterialReceiptItem, 'id'>;
  materialIssues: EntityTable<MaterialIssue, 'id'>;
  materialIssueItems: EntityTable<MaterialIssueItem, 'id'>;
  deliveries: EntityTable<Delivery, 'id'>;
  deliveryItems: EntityTable<DeliveryItem, 'id'>;
  stockMovements: EntityTable<StockMovement, 'id'>;
  productStock: EntityTable<ProductStock, 'id'>;
  payrollPeriods: EntityTable<PayrollPeriod, 'id'>;
  payrollLines: EntityTable<PayrollLine, 'id'>;
  settings: EntityTable<SettingRecord, 'key'>;
  activityLogs: EntityTable<ActivityLog, 'id'>;
  documentSequences: EntityTable<DocumentSequence, 'id'>;
  operationReceipts: EntityTable<OperationReceipt, 'id'>;
  appMeta: EntityTable<AppMetaRecord, 'key'>;
};

export const db = new Dexie(DB_NAME) as FactoryDB;

db.version(SCHEMA_VERSION).stores({
  teams: 'id, &code, active',
  employees: 'id, &code, role, teamId, active',
  suppliers: 'id, &code, name, active',
  materials: 'id, &code, searchName, active',
  products: 'id, &code, searchName, active',
  bomStages: 'id, productId, [productId+seq], teamId',
  bomMaterials: 'id, productId, materialId, [productId+materialId]',
  customers: 'id, &code, searchName, phone, active',
  salesOrders: 'id, &code, customerId, status, dueDate, createdAt',
  salesOrderItems: 'id, orderId, productId',
  workOrders: 'id, &code, salesOrderId, salesOrderItemId, productId, status, priority, dueDate',
  workOrderStages: 'id, workOrderId, teamId, status, [workOrderId+seq]',
  productionLogs: 'id, &code, workOrderId, stageId, teamId, employeeId, date, createdAt',
  qcChecks: 'id, &code, workOrderId, result, defectType, checkedAt',
  materialReceipts: 'id, &code, supplierId, status, postedAt',
  materialReceiptItems: 'id, receiptId, materialId',
  materialIssues: 'id, &code, workOrderId, status, postedAt',
  materialIssueItems: 'id, issueId, materialId',
  deliveries: 'id, &code, salesOrderId, status, deliveredAt',
  deliveryItems: 'id, deliveryId, productId',
  stockMovements: 'id, materialId, productId, type, refType, refId, at',
  productStock: 'id, &productId',
  payrollPeriods: 'id, &code, &periodKey, status',
  payrollLines: 'id, periodId, employeeId',
  settings: 'key',
  activityLogs: 'id, [entityType+entityId], at, operationId',
  documentSequences: 'id, [documentType+period]',
  operationReceipts: 'id, operationType, completedAt',
  appMeta: 'key',
});

export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: string }).name ?? '';
  return name === 'QuotaExceededError' || name === 'ConstraintError';
}
