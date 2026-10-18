import type {
  DefectType,
  MaterialDocStatus,
  PayrollStatus,
  PositionId,
  QcResult,
  RoleId,
  SalesOrderStatus,
  ShiftId,
  StockMovementType,
  WorkOrderPriority,
  WorkOrderStageStatus,
  WorkOrderStatus,
} from '../types';

export interface StatusMeta {
  label: string;
  color: string;
}

export const ROLE_LABEL: Record<RoleId, string> = {
  MANAGER: 'Giám đốc xưởng',
  PLANNER: 'Kế hoạch',
  SUPERVISOR: 'Tổ trưởng',
  QC: 'QC',
  STOREKEEPER: 'Thủ kho',
};

export const POSITION_LABEL: Record<PositionId, string> = {
  DIRECTOR: 'Giám đốc xưởng',
  PLANNER: 'Kế hoạch',
  LEADER: 'Tổ trưởng',
  MAIN_WORKER: 'Thợ chính',
  HELPER: 'Thợ phụ',
  QC: 'QC',
  STOREKEEPER: 'Thủ kho',
};

export const ORDER_STATUS_META: Record<SalesOrderStatus, StatusMeta> = {
  NEW: { label: 'Mới', color: 'default' },
  APPROVED: { label: 'Đã duyệt', color: 'blue' },
  IN_PROGRESS: { label: 'Đang sản xuất', color: 'geekblue' },
  READY: { label: 'Đủ hàng', color: 'green' },
  DELIVERED: { label: 'Đã giao', color: 'success' },
  CANCELLED: { label: 'Huỷ', color: 'red' },
};

export const WORK_ORDER_STATUS_META: Record<WorkOrderStatus, StatusMeta> = {
  WAITING: { label: 'Chờ', color: 'default' },
  IN_PROGRESS: { label: 'Đang sản xuất', color: 'geekblue' },
  AWAITING_QC: { label: 'Chờ QC', color: 'orange' },
  DONE: { label: 'Hoàn thành', color: 'success' },
  CANCELLED: { label: 'Huỷ', color: 'red' },
};

export const WORK_ORDER_PRIORITY_META: Record<WorkOrderPriority, StatusMeta> = {
  LOW: { label: 'Thấp', color: 'default' },
  NORMAL: { label: 'Thường', color: 'blue' },
  HIGH: { label: 'Cao', color: 'gold' },
  URGENT: { label: 'Gấp', color: 'red' },
};

export const STAGE_STATUS_META: Record<WorkOrderStageStatus, StatusMeta> = {
  PENDING: { label: 'Chưa làm', color: 'default' },
  IN_PROGRESS: { label: 'Đang làm', color: 'processing' },
  DONE: { label: 'Xong', color: 'success' },
};

export const SHIFT_LABEL: Record<ShiftId, string> = {
  MORNING: 'Sáng',
  AFTERNOON: 'Chiều',
  EVENING: 'Tối',
};

export const DEFECT_TYPE_LABEL: Record<DefectType, string> = {
  DIMENSION: 'Kích thước',
  WELD: 'Mối hàn',
  PAINT: 'Bề mặt sơn',
  MISSING_PART: 'Thiếu linh kiện',
  OTHER: 'Khác',
};

export const QC_RESULT_META: Record<QcResult, StatusMeta> = {
  PASSED: { label: 'Đạt', color: 'success' },
  FAILED: { label: 'Không đạt', color: 'red' },
};

export const DOC_STATUS_META: Record<MaterialDocStatus, StatusMeta> = {
  DRAFT: { label: 'Nháp', color: 'default' },
  POSTED: { label: 'Đã ghi sổ', color: 'green' },
};

export const PAYROLL_STATUS_META: Record<PayrollStatus, StatusMeta> = {
  OPEN: { label: 'Đang mở', color: 'blue' },
  LOCKED: { label: 'Đã chốt', color: 'green' },
};

export const MOVEMENT_TYPE_LABEL: Record<StockMovementType, string> = {
  RECEIPT_IN: 'Nhập NVL',
  ISSUE_OUT: 'Xuất NVL theo lệnh',
  ADJUST: 'Điều chỉnh kiểm kê',
  PRODUCT_IN: 'Nhập thành phẩm',
  DELIVERY_OUT: 'Giao hàng',
};

export const MATERIAL_DOC_TYPE_LABEL = {
  RECEIPT: 'Nhập NVL',
  ISSUE: 'Xuất NVL theo lệnh',
  DELIVERY: 'Giao hàng',
} as const;

export type MaterialDocKind = keyof typeof MATERIAL_DOC_TYPE_LABEL;

export function statusMeta(meta: Record<string, StatusMeta>, key?: string | null): StatusMeta {
  if (!key) return { label: '—', color: 'default' };
  return meta[key] ?? { label: key, color: 'default' };
}
