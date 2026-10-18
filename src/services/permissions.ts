import type { RoleId } from '../types';
import { PermissionError } from './errors';

/** Tập hành động nghiệp vụ cần kiểm tra quyền tại tầng service */
export type Action =
  | 'customer.manage'
  | 'order.create'
  | 'order.approve'
  | 'order.cancel'
  | 'order.deliver'
  | 'product.manage'
  | 'material.manage'
  | 'inventory.receipt'
  | 'inventory.issue'
  | 'inventory.adjust'
  | 'workorder.update'
  | 'production.log'
  | 'production.edit'
  | 'qc.check'
  | 'team.manage'
  | 'employee.manage'
  | 'payroll.lock'
  | 'settings.manage';

const ALL: Action[] = [
  'customer.manage',
  'order.create',
  'order.approve',
  'order.cancel',
  'order.deliver',
  'product.manage',
  'material.manage',
  'inventory.receipt',
  'inventory.issue',
  'inventory.adjust',
  'workorder.update',
  'production.log',
  'production.edit',
  'qc.check',
  'team.manage',
  'employee.manage',
  'payroll.lock',
  'settings.manage',
];

export const PERMISSIONS: Record<RoleId, Action[]> = {
  // Giám đốc xưởng: toàn quyền
  MANAGER: ALL,
  // Kế hoạch: đơn hàng, sản phẩm/BOM, điều độ, báo cáo (không ghi sổ kho, không QC)
  PLANNER: ['customer.manage', 'order.create', 'order.approve', 'order.cancel', 'product.manage', 'material.manage', 'workorder.update'],
  // Tổ trưởng: chạy công đoạn, ghi sản lượng, cấp vật tư đề nghị, xem QC
  SUPERVISOR: ['workorder.update', 'production.log', 'inventory.issue'],
  // QC: kiểm tra chất lượng, xem lệnh sản xuất
  QC: ['qc.check'],
  // Thủ kho: nhập/xuất/kiểm kê vật tư, giao hàng theo đơn
  STOREKEEPER: ['material.manage', 'inventory.receipt', 'inventory.issue', 'inventory.adjust', 'order.deliver'],
};

export function can(role: RoleId, action: Action): boolean {
  return PERMISSIONS[role]?.includes(action) ?? false;
}

export function assertPermission(role: RoleId, action: Action, message?: string): void {
  if (!can(role, action)) {
    throw new PermissionError(message);
  }
}
