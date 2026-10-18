// Kiểu dữ liệu dùng chung toàn hệ thống (FactoryOne — MES-lite)

export type Id = string;

export interface AuditFields {
  createdAt: string;
  updatedAt?: string;
  createdBy?: Id;
  revision?: number;
}

// ---------- Vai trò & nhân sự ----------
export type RoleId = 'MANAGER' | 'PLANNER' | 'SUPERVISOR' | 'QC' | 'STOREKEEPER';

export interface Actor {
  employeeId: Id;
  name: string;
  role: RoleId;
}

/** Chức danh trong xưởng */
export type PositionId = 'DIRECTOR' | 'PLANNER' | 'LEADER' | 'MAIN_WORKER' | 'HELPER' | 'QC' | 'STOREKEEPER';

export interface Team {
  id: Id;
  code: string;
  name: string;
  leaderId?: Id;
  note?: string;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
  revision: number;
}

export interface Employee {
  id: Id;
  code: string;
  name: string;
  role: RoleId;
  position: PositionId;
  teamId?: Id;
  phone: string;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
  revision: number;
}

// ---------- Nhà cung cấp & khách hàng ----------
export interface Supplier {
  id: Id;
  code: string;
  name: string;
  phone: string;
  address: string;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
  revision: number;
}

export interface Customer {
  id: Id;
  code: string;
  name: string;
  searchName: string;
  phone: string;
  address?: string;
  note?: string;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
  revision: number;
}

// ---------- Nguyên vật liệu ----------
export interface Material {
  id: Id;
  code: string;
  name: string;
  searchName: string;
  unit: string;
  stockQty: number;
  minQty: number;
  avgCostVnd: number;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
  revision: number;
}

export type StockMovementType = 'RECEIPT_IN' | 'ISSUE_OUT' | 'ADJUST' | 'PRODUCT_IN' | 'DELIVERY_OUT';

export interface StockMovement {
  id: Id;
  materialId?: Id;
  productId?: Id;
  type: StockMovementType;
  /** Số lượng luôn dương; chiều tăng/giảm xác định theo type */
  quantity: number;
  unitCostVnd?: number;
  unitPriceVnd?: number;
  refType: 'MATERIAL_RECEIPT' | 'MATERIAL_ISSUE' | 'ADJUST' | 'WORK_ORDER' | 'DELIVERY';
  refId: Id;
  refCode?: string;
  at: string;
  note?: string;
}

export interface ProductStock {
  id: Id;
  productId: Id;
  quantity: number;
  updatedAt?: string;
}

// ---------- Sản phẩm & định mức ----------
export interface Product {
  id: Id;
  code: string;
  name: string;
  searchName: string;
  unit: string;
  salePriceVnd: number;
  note?: string;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
  revision: number;
}

export interface BomStage {
  id: Id;
  productId: Id;
  seq: number;
  name: string;
  teamId: Id;
  pieceRateVnd: number;
  standardMinutes: number;
}

export interface BomMaterial {
  id: Id;
  productId: Id;
  materialId: Id;
  quantityPerUnit: number;
  wastePct: number;
}

// ---------- Đơn hàng ----------
export type SalesOrderStatus = 'NEW' | 'APPROVED' | 'IN_PROGRESS' | 'READY' | 'DELIVERED' | 'CANCELLED';

export interface SalesOrder {
  id: Id;
  code: string;
  customerId: Id;
  status: SalesOrderStatus;
  dueDate: string;
  totalVnd: number;
  note?: string;
  approvedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  createdAt: string;
  updatedAt?: string;
  createdBy?: Id;
  revision: number;
}

export interface SalesOrderItem {
  id: Id;
  orderId: Id;
  productId: Id;
  quantity: number;
  unitPriceVnd: number;
  deliveredQty: number;
}

// ---------- Lệnh sản xuất ----------
export type WorkOrderStatus = 'WAITING' | 'IN_PROGRESS' | 'AWAITING_QC' | 'DONE' | 'CANCELLED';

export type WorkOrderPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface WorkOrderMaterialReq {
  materialId: Id;
  quantityPerUnit: number;
  wastePct: number;
}

export interface WorkOrder {
  id: Id;
  code: string;
  salesOrderId: Id;
  salesOrderItemId: Id;
  productId: Id;
  quantity: number;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  dueDate: string;
  reworkCount: number;
  /** Snapshot định mức NVL tại thời điểm duyệt đơn */
  materialReqs: WorkOrderMaterialReq[];
  note?: string;
  startedAt?: string;
  awaitingQcAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt?: string;
  createdBy?: Id;
  revision: number;
}

export type WorkOrderStageStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE';

export interface WorkOrderStage {
  id: Id;
  workOrderId: Id;
  seq: number;
  name: string;
  teamId: Id;
  pieceRateVnd: number;
  standardMinutes: number;
  status: WorkOrderStageStatus;
  startedAt?: string;
  finishedAt?: string;
}

// ---------- Sản lượng ----------
export type ShiftId = 'MORNING' | 'AFTERNOON' | 'EVENING';

export interface ProductionLog {
  id: Id;
  code: string;
  workOrderId: Id;
  stageId: Id;
  teamId: Id;
  employeeId: Id;
  shift: ShiftId;
  /** Khóa ngày dạng YYYY-MM-DD */
  date: string;
  quantityGood: number;
  quantityBad: number;
  amountVnd: number;
  note?: string;
  createdAt: string;
  createdBy?: Id;
  revision: number;
}

// ---------- QC ----------
export type DefectType = 'DIMENSION' | 'WELD' | 'PAINT' | 'MISSING_PART' | 'OTHER';
export type QcResult = 'PASSED' | 'FAILED';

export interface QcCheck {
  id: Id;
  code: string;
  workOrderId: Id;
  checkedQty: number;
  passedQty: number;
  failedQty: number;
  defectType: DefectType;
  result: QcResult;
  /** Lần kiểm này thực hiện sau khi lệnh từng bị làm lại */
  afterRework: boolean;
  note?: string;
  checkedById: Id;
  checkedAt: string;
}

// ---------- Kho vật tư ----------
export type MaterialDocStatus = 'DRAFT' | 'POSTED';

export interface MaterialReceipt {
  id: Id;
  code: string;
  supplierId?: Id;
  supplierNameSnapshot?: string;
  status: MaterialDocStatus;
  totalVnd: number;
  note?: string;
  createdAt: string;
  postedAt?: string;
  createdBy?: Id;
  revision: number;
}

export interface MaterialReceiptItem {
  id: Id;
  receiptId: Id;
  materialId: Id;
  materialNameSnapshot: string;
  unitSnapshot: string;
  quantity: number;
  unitCostVnd: number;
}

export interface MaterialIssue {
  id: Id;
  code: string;
  workOrderId: Id;
  status: MaterialDocStatus;
  totalVnd: number;
  note?: string;
  createdAt: string;
  postedAt?: string;
  createdBy?: Id;
  revision: number;
}

export interface MaterialIssueItem {
  id: Id;
  issueId: Id;
  materialId: Id;
  materialNameSnapshot: string;
  unitSnapshot: string;
  quantity: number;
  unitCostVnd: number;
}

// ---------- Giao hàng ----------
export interface Delivery {
  id: Id;
  code: string;
  salesOrderId: Id;
  status: MaterialDocStatus;
  totalVnd: number;
  note?: string;
  createdAt: string;
  deliveredAt?: string;
  createdBy?: Id;
  receivedBy?: string;
  revision: number;
}

export interface DeliveryItem {
  id: Id;
  deliveryId: Id;
  productId: Id;
  productNameSnapshot: string;
  unitSnapshot: string;
  quantity: number;
  unitPriceVnd: number;
}

// ---------- Lương khoán ----------
export type PayrollStatus = 'OPEN' | 'LOCKED';

export interface PayrollPeriod {
  id: Id;
  code: string;
  /** Khóa kỳ dạng YYYY-MM */
  periodKey: string;
  from: string;
  to: string;
  status: PayrollStatus;
  totalVnd: number;
  lockedAt?: string;
  createdAt: string;
  createdBy?: Id;
  revision: number;
}

export interface PayrollLine {
  id: Id;
  periodId: Id;
  employeeId: Id;
  employeeCodeSnapshot: string;
  employeeNameSnapshot: string;
  teamIdSnapshot?: Id;
  quantityGood: number;
  quantityBad: number;
  amountVnd: number;
}

// ---------- Hạ tầng ----------
export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface AppMetaRecord {
  key: string;
  value: unknown;
}

export interface ActivityLog {
  id: Id;
  entityType: string;
  entityId: Id;
  action: string;
  actorId?: Id;
  actorName?: string;
  at: string;
  summary: string;
  changes?: Record<string, unknown>;
  operationId?: string;
}

export interface DocumentSequence {
  id: string;
  documentType: string;
  period: string;
  nextValue: number;
}

export interface OperationReceipt {
  id: string;
  operationType: string;
  resultEntityIds: Id[];
  completedAt: string;
  summary?: string;
}
