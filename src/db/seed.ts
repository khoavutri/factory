import dayjs from 'dayjs';
import { db, SCHEMA_VERSION } from './database';
import { nowIso } from '../utils/format';
import { newId } from '../utils/ids';
import { lineAmountVnd, roundQty, weightedAverageCost } from '../utils/money';
import { toSearchName } from '../utils/text';
import type {
  Actor,
  ActivityLog,
  BomMaterial,
  BomStage,
  Customer,
  Delivery,
  DeliveryItem,
  Employee,
  Material,
  MaterialIssue,
  MaterialIssueItem,
  MaterialReceipt,
  MaterialReceiptItem,
  PayrollPeriod,
  Product,
  ProductStock,
  ProductionLog,
  QcCheck,
  SalesOrder,
  SalesOrderItem,
  SettingRecord,
  ShiftId,
  StockMovement,
  Supplier,
  Team,
  WorkOrder,
  WorkOrderMaterialReq,
  WorkOrderStage,
  WorkOrderStatus,
} from '../types';
import { nextCode } from '../services/core';
import { computePayroll, lockPayrollPeriod } from '../services/payroll';
import { DEFAULT_APP_META, DEFAULT_PRINT_CONFIG, DEFAULT_WORKSHOP_INFO, SETTING_KEYS } from '../services/settings';

export const SEED_VERSION = '1';

// ============================================================
// Dữ liệu tĩnh
// ============================================================

const TEAMS: Array<{ id: string; code: string; name: string; note: string }> = [
  { id: 'to-01', code: 'TO1', name: 'Tổ Cắt phôi', note: 'Cắt, đột, chấn tôn theo bản vẽ' },
  { id: 'to-02', code: 'TO2', name: 'Tổ Hàn & CNC', note: 'Hàn khung, gia công CNC chi tiết' },
  { id: 'to-03', code: 'TO3', name: 'Tổ Sơn', note: 'Xử lý bề mặt và sơn tĩnh điện' },
  { id: 'to-04', code: 'TO4', name: 'Tổ Lắp ráp', note: 'Lắp ráp, căn chỉnh, chạy thử' },
  { id: 'to-05', code: 'TO5', name: 'Tổ Đóng gói', note: 'Đóng gói, dán nhãn, xuất xưởng' },
];

const EMPLOYEES: Array<{ id: string; code: string; name: string; role: Employee['role']; position: Employee['position']; teamId?: string; phone: string }> = [
  { id: 'emp-manager', code: 'NV-001', name: 'Đặng Quốc Hưng', role: 'MANAGER', position: 'DIRECTOR', phone: '0912345678' },
  { id: 'emp-planner', code: 'NV-002', name: 'Nguyễn Thu Hằng', role: 'PLANNER', position: 'PLANNER', phone: '0912345679' },
  { id: 'emp-leader-1', code: 'NV-003', name: 'Trần Văn Kiên', role: 'SUPERVISOR', position: 'LEADER', teamId: 'to-01', phone: '0983111222' },
  { id: 'emp-leader-2', code: 'NV-004', name: 'Phạm Văn Dũng', role: 'SUPERVISOR', position: 'LEADER', teamId: 'to-02', phone: '0983222333' },
  { id: 'emp-leader-3', code: 'NV-005', name: 'Lê Thị Ngọc', role: 'SUPERVISOR', position: 'LEADER', teamId: 'to-03', phone: '0983333444' },
  { id: 'emp-leader-4', code: 'NV-006', name: 'Hoàng Văn Thái', role: 'SUPERVISOR', position: 'LEADER', teamId: 'to-04', phone: '0983444555' },
  { id: 'emp-leader-5', code: 'NV-007', name: 'Vũ Thị Hoa', role: 'SUPERVISOR', position: 'LEADER', teamId: 'to-05', phone: '0983555666' },
  { id: 'emp-worker-1', code: 'NV-008', name: 'Ngô Văn Sơn', role: 'SUPERVISOR', position: 'MAIN_WORKER', teamId: 'to-01', phone: '0983666777' },
  { id: 'emp-worker-2', code: 'NV-009', name: 'Bùi Văn Tú', role: 'SUPERVISOR', position: 'MAIN_WORKER', teamId: 'to-02', phone: '0983777888' },
  { id: 'emp-worker-3', code: 'NV-010', name: 'Đỗ Thị Mai', role: 'SUPERVISOR', position: 'MAIN_WORKER', teamId: 'to-03', phone: '0983888999' },
  { id: 'emp-worker-4', code: 'NV-011', name: 'Trần Minh Quân', role: 'SUPERVISOR', position: 'MAIN_WORKER', teamId: 'to-04', phone: '0983999000' },
  { id: 'emp-worker-5', code: 'NV-012', name: 'Nguyễn Văn Lộc', role: 'SUPERVISOR', position: 'HELPER', teamId: 'to-05', phone: '0984000111' },
  { id: 'emp-qc', code: 'NV-013', name: 'Trịnh Văn Lâm', role: 'QC', position: 'QC', phone: '0984111222' },
  { id: 'emp-store', code: 'NV-014', name: 'Bùi Thị Oanh', role: 'STOREKEEPER', position: 'STOREKEEPER', phone: '0984222333' },
];

const SUPPLIERS: Array<{ id: string; code: string; name: string; phone: string; address: string }> = [
  { id: 'ncc-01', code: 'NCC-001', name: 'Công ty Thép Hòa Phát', phone: '024 3656 8899', address: 'KCN Phố Nối A, Hưng Yên' },
  { id: 'ncc-02', code: 'NCC-002', name: 'Cty Sơn Tĩnh điện Việt Long', phone: '024 3555 6677', address: 'Thanh Trì, Hà Nội' },
  { id: 'ncc-03', code: 'NCC-003', name: 'Cty Phụ kiện Kim khí Đông Á', phone: '024 3777 2233', address: 'Long Biên, Hà Nội' },
  { id: 'ncc-04', code: 'NCC-004', name: 'Cty Hóa chất Vinatech', phone: '0251 3888 999', address: 'Biên Hòa, Đồng Nai' },
];

/** [code, name, unit, minQty, avgCost, openingQty] */
const MATERIALS: Array<[string, string, string, number, number, number]> = [
  ['TH-2040', 'Thép hộp 20×40×1.2', 'kg', 200, 18500, 1250],
  ['TH-2550', 'Thép hộp 25×50×1.4', 'kg', 200, 19800, 980],
  ['TT-2MM', 'Thép tấm 2mm', 'tấm', 30, 720000, 60],
  ['TV-3030', 'Thép V 30×30', 'kg', 100, 17200, 320],
  ['OK-21', 'Ống kẽm Ø21', 'cây', 60, 95000, 210],
  ['QH-J421', 'Que hàn J421 2.5', 'kg', 40, 32000, 150],
  ['BL-M8', 'Bulong M8×30', 'con', 800, 1200, 5200],
  ['DN-M8', 'Đai ốc M8', 'con', 800, 700, 4800],
  ['LD-M8', 'Long đền M8', 'con', 1000, 300, 9000],
  ['BD-6204', 'Bạc đạn 6204', 'cái', 40, 65000, 22],
  ['BX-PU100', 'Bánh xe PU 100mm', 'cái', 60, 88000, 140],
  ['BX-N75', 'Bánh xe nhựa 75mm', 'cái', 50, 42000, 38],
  ['BLH-INOX', 'Bản lề inox', 'cái', 100, 24000, 260],
  ['TN-INOX', 'Tay nắm inox', 'cái', 80, 38000, 190],
  ['SON-BOT', 'Sơn tĩnh điện bột', 'kg', 120, 95000, 410],
  ['DM-01', 'Dung môi', 'lít', 40, 45000, 28],
  ['GN-01', 'Giấy nhám', 'tờ', 200, 6500, 860],
  ['KN-01', 'Khớp nối', 'cái', 100, 15000, 62],
  ['XCL-08', 'Xích con lăn', 'mét', 40, 120000, 96],
  ['TD-01', 'Tăng đơ', 'cái', 60, 28000, 34],
  ['CN-01', 'Chân nhựa', 'cái', 400, 4500, 1500],
  ['DC-01', 'Đệm cao su', 'tấm', 80, 32000, 210],
  ['ON-01', 'Ống nhựa', 'mét', 100, 18000, 420],
  ['DD-01', 'Dây đai', 'cuộn', 50, 55000, 130],
];

const CUSTOMERS: Array<{ id: string; code: string; name: string; phone: string; address: string }> = [
  { id: 'kh-01', code: 'KH-001', name: 'Cty TNHH Nội thất Phố', phone: '024 3822 1155', address: '18 Nguyễn Trãi, Thanh Xuân, Hà Nội' },
  { id: 'kh-02', code: 'KH-002', name: 'Cửa hàng VLXD Hòa Phát', phone: '0983 445 221', address: 'QL1A, Thường Tín, Hà Nội' },
  { id: 'kh-03', code: 'KH-003', name: 'Xưởng mộc Đức Long', phone: '0912 336 778', address: 'KCN Phú Nghĩa, Chương Mỹ, Hà Nội' },
  { id: 'kh-04', code: 'KH-004', name: 'Cty Điện lạnh Sài Gòn', phone: '028 3822 9911', address: '45 Cách Mạng Tháng 8, Q.3, TP.HCM' },
  { id: 'kh-05', code: 'KH-005', name: 'Cty Bao bì Tân Tiến', phone: '0274 3778 226', address: 'KCN Tân Đông Hiệp, Bình Dương' },
  { id: 'kh-06', code: 'KH-006', name: 'Nhà máy Gạch Bình Dương', phone: '0274 3665 110', address: 'Thuận An, Bình Dương' },
  { id: 'kh-07', code: 'KH-007', name: 'Cty Thực phẩm Vina', phone: '024 3356 7788', address: 'KCN Quang Minh, Mê Linh, Hà Nội' },
  { id: 'kh-08', code: 'KH-008', name: 'Hộ kinh doanh Minh Khuê', phone: '0904 556 332', address: 'Chợ Hôm, Hai Bà Trưng, Hà Nội' },
];

interface SeedProduct {
  code: string;
  name: string;
  unit: string;
  salePriceVnd: number;
  stages: Array<[string, string, number, number]>;
  materials: Array<[string, number, number]>;
}

const PRODUCTS: SeedProduct[] = [
  {
    code: 'SP-001',
    name: 'Khung thép hộp mạ kẽm 1200×600',
    unit: 'cái',
    salePriceVnd: 1450000,
    stages: [
      ['Cắt phôi', 'to-01', 15000, 25],
      ['Hàn & CNC', 'to-02', 35000, 45],
      ['Sơn tĩnh điện', 'to-03', 20000, 30],
      ['Đóng gói', 'to-05', 5000, 10],
    ],
    materials: [
      ['TH-2040', 8.5, 2],
      ['OK-21', 0.6, 3],
      ['QH-J421', 0.35, 5],
      ['SON-BOT', 0.45, 5],
      ['BL-M8', 8, 3],
    ],
  },
  {
    code: 'SP-002',
    name: 'Kệ sắt 5 tầng 1.5m',
    unit: 'bộ',
    salePriceVnd: 2850000,
    stages: [
      ['Cắt phôi', 'to-01', 15000, 35],
      ['Hàn & CNC', 'to-02', 35000, 60],
      ['Sơn tĩnh điện', 'to-03', 20000, 40],
      ['Lắp ráp', 'to-04', 25000, 45],
      ['Đóng gói', 'to-05', 5000, 15],
    ],
    materials: [
      ['TH-2550', 18, 2],
      ['TT-2MM', 3, 4],
      ['QH-J421', 0.6, 5],
      ['SON-BOT', 0.9, 5],
      ['BL-M8', 24, 3],
    ],
  },
  {
    code: 'SP-003',
    name: 'Bàn inox 2 tầng 800×600',
    unit: 'cái',
    salePriceVnd: 3250000,
    stages: [
      ['Cắt phôi', 'to-01', 15000, 30],
      ['Hàn & CNC', 'to-02', 35000, 55],
      ['Lắp ráp', 'to-04', 25000, 40],
      ['Đóng gói', 'to-05', 5000, 12],
    ],
    materials: [
      ['TT-2MM', 4, 5],
      ['TH-2550', 6, 2],
      ['QH-J421', 0.4, 5],
      ['LD-M8', 16, 3],
      ['ON-01', 1.5, 4],
    ],
  },
  {
    code: 'SP-004',
    name: 'Xe đẩy hàng 4 bánh',
    unit: 'cái',
    salePriceVnd: 1680000,
    stages: [
      ['Cắt phôi', 'to-01', 15000, 20],
      ['Hàn & CNC', 'to-02', 35000, 40],
      ['Sơn tĩnh điện', 'to-03', 20000, 25],
      ['Lắp ráp', 'to-04', 25000, 30],
      ['Đóng gói', 'to-05', 5000, 10],
    ],
    materials: [
      ['TH-2040', 6.2, 2],
      ['TV-3030', 2.4, 2],
      ['BX-PU100', 4, 2],
      ['BL-M8', 12, 3],
      ['SON-BOT', 0.35, 5],
    ],
  },
  {
    code: 'SP-005',
    name: 'Vỏ tủ điện 600×400',
    unit: 'cái',
    salePriceVnd: 2150000,
    stages: [
      ['Cắt phôi', 'to-01', 15000, 30],
      ['Hàn & CNC', 'to-02', 35000, 50],
      ['Sơn tĩnh điện', 'to-03', 20000, 35],
      ['Lắp ráp', 'to-04', 25000, 40],
      ['Đóng gói', 'to-05', 5000, 12],
    ],
    materials: [
      ['TT-2MM', 2.5, 4],
      ['TV-3030', 1.2, 2],
      ['QH-J421', 0.3, 5],
      ['SON-BOT', 0.5, 5],
      ['BLH-INOX', 4, 3],
    ],
  },
  {
    code: 'SP-006',
    name: 'Lan can ban công sắt hộp',
    unit: 'mét',
    salePriceVnd: 780000,
    stages: [
      ['Cắt phôi', 'to-01', 15000, 12],
      ['Hàn & CNC', 'to-02', 35000, 22],
      ['Sơn tĩnh điện', 'to-03', 20000, 18],
      ['Đóng gói', 'to-05', 5000, 8],
    ],
    materials: [
      ['TH-2040', 3.4, 2],
      ['OK-21', 0.25, 3],
      ['QH-J421', 0.2, 5],
      ['SON-BOT', 0.28, 5],
      ['BLH-INOX', 2, 3],
    ],
  },
  {
    code: 'SP-007',
    name: 'Cửa sắt kéo CNC 2 cánh',
    unit: 'bộ',
    salePriceVnd: 6400000,
    stages: [
      ['Cắt phôi', 'to-01', 15000, 60],
      ['Hàn & CNC', 'to-02', 35000, 120],
      ['Sơn tĩnh điện', 'to-03', 20000, 70],
      ['Lắp ráp', 'to-04', 25000, 90],
      ['Đóng gói', 'to-05', 5000, 20],
    ],
    materials: [
      ['TH-2550', 26, 2],
      ['XCL-08', 3.2, 3],
      ['BX-N75', 4, 2],
      ['TD-01', 2, 3],
      ['SON-BOT', 1.4, 5],
    ],
  },
  {
    code: 'SP-008',
    name: 'Trục xe đẩy tải 300kg',
    unit: 'cái',
    salePriceVnd: 420000,
    stages: [
      ['Cắt phôi', 'to-01', 15000, 10],
      ['Hàn & CNC', 'to-02', 35000, 20],
      ['Đóng gói', 'to-05', 5000, 5],
    ],
    materials: [
      ['TV-3030', 1.8, 2],
      ['BD-6204', 2, 2],
      ['DN-M8', 6, 3],
      ['LD-M8', 6, 3],
      ['DD-01', 0.2, 4],
    ],
  },
];

// ============================================================
// Kế hoạch đơn hàng / lệnh sản xuất
// ============================================================

interface SeedOrder {
  customerCode: string;
  createdAtDays: number;
  approvedDays?: number;
  dueDays: number;
  status: SalesOrder['status'];
  deliveredDays?: number;
  cancelledDays?: number;
  cancelReason?: string;
  lines: Array<[string, number, number]>;
}

const ORDERS: SeedOrder[] = [
  {
    customerCode: 'KH-007',
    createdAtDays: -1,
    dueDays: 12,
    status: 'NEW',
    lines: [['SP-001', 8, 1450000]],
  },
  {
    customerCode: 'KH-008',
    createdAtDays: 0,
    dueDays: 15,
    status: 'NEW',
    lines: [
      ['SP-006', 35, 780000],
      ['SP-008', 12, 420000],
    ],
  },
  {
    customerCode: 'KH-004',
    createdAtDays: -3,
    approvedDays: -2,
    dueDays: 9,
    status: 'APPROVED',
    lines: [
      ['SP-007', 5, 6400000],
      ['SP-001', 14, 1450000],
    ],
  },
  {
    customerCode: 'KH-003',
    createdAtDays: -4,
    approvedDays: -3,
    dueDays: 6,
    status: 'APPROVED',
    lines: [['SP-002', 4, 2850000]],
  },
  {
    customerCode: 'KH-002',
    createdAtDays: -6,
    approvedDays: -5,
    dueDays: -3,
    status: 'IN_PROGRESS',
    lines: [['SP-004', 15, 1680000]],
  },
  {
    customerCode: 'KH-005',
    createdAtDays: -8,
    approvedDays: -7,
    dueDays: 4,
    status: 'IN_PROGRESS',
    lines: [['SP-001', 25, 1450000]],
  },
  {
    customerCode: 'KH-006',
    createdAtDays: -10,
    approvedDays: -9,
    dueDays: -1,
    status: 'IN_PROGRESS',
    lines: [
      ['SP-003', 6, 3250000],
      ['SP-006', 30, 780000],
    ],
  },
  {
    customerCode: 'KH-001',
    createdAtDays: -12,
    approvedDays: -11,
    dueDays: 8,
    status: 'IN_PROGRESS',
    lines: [['SP-006', 60, 780000]],
  },
  {
    customerCode: 'KH-004',
    createdAtDays: -13,
    approvedDays: -12,
    dueDays: 5,
    status: 'IN_PROGRESS',
    lines: [
      ['SP-007', 3, 6400000],
      ['SP-003', 6, 3250000],
    ],
  },
  {
    customerCode: 'KH-008',
    createdAtDays: -15,
    approvedDays: -14,
    dueDays: 2,
    status: 'IN_PROGRESS',
    lines: [
      ['SP-002', 4, 2850000],
      ['SP-008', 20, 420000],
      ['SP-004', 10, 1680000],
    ],
  },
  {
    customerCode: 'KH-003',
    createdAtDays: -24,
    approvedDays: -23,
    dueDays: 3,
    status: 'READY',
    lines: [
      ['SP-005', 8, 2150000],
      ['SP-008', 12, 420000],
    ],
  },
  {
    customerCode: 'KH-007',
    createdAtDays: -26,
    approvedDays: -25,
    dueDays: 5,
    status: 'READY',
    lines: [['SP-006', 24, 780000]],
  },
  {
    customerCode: 'KH-001',
    createdAtDays: -40,
    approvedDays: -38,
    deliveredDays: -22,
    dueDays: -20,
    status: 'DELIVERED',
    lines: [['SP-001', 12, 1450000]],
  },
  {
    customerCode: 'KH-002',
    createdAtDays: -18,
    approvedDays: -17,
    deliveredDays: -14,
    dueDays: -12,
    status: 'DELIVERED',
    lines: [['SP-002', 6, 2850000]],
  },
  {
    customerCode: 'KH-006',
    createdAtDays: -14,
    approvedDays: -13,
    deliveredDays: -8,
    dueDays: -6,
    status: 'DELIVERED',
    lines: [['SP-004', 20, 1680000]],
  },
  {
    customerCode: 'KH-002',
    createdAtDays: -9,
    cancelledDays: -8,
    dueDays: 10,
    status: 'CANCELLED',
    cancelReason: 'Khách đổi phương án thi công, huỷ để làm lại báo giá mới.',
    lines: [['SP-002', 3, 2850000]],
  },
];

interface SeedWorkOrder {
  order: number;
  line: number;
  startDays: number;
  stageStep: number;
  status: WorkOrderStatus;
  doneStages: number;
  priority: WorkOrder['priority'];
  reworkCount?: number;
  progressFrac?: number;
  finishedDays?: number;
  overdueStage?: boolean;
}

const WORK_ORDERS: SeedWorkOrder[] = [
  // Đã hoàn thành (đã nhập kho thành phẩm hoặc đã giao)
  { order: 13, line: 1, startDays: -36, stageStep: 3, status: 'DONE', doneStages: 4, priority: 'HIGH', finishedDays: -24 },
  { order: 14, line: 1, startDays: -20, stageStep: 1.5, status: 'DONE', doneStages: 5, priority: 'NORMAL', finishedDays: -14, reworkCount: 1 },
  { order: 15, line: 1, startDays: -14, stageStep: 1.5, status: 'DONE', doneStages: 5, priority: 'NORMAL', finishedDays: -9, reworkCount: 1 },
  { order: 11, line: 1, startDays: -11, stageStep: 1.5, status: 'DONE', doneStages: 4, priority: 'NORMAL', finishedDays: -6 },
  { order: 11, line: 2, startDays: -10, stageStep: 2, status: 'DONE', doneStages: 3, priority: 'NORMAL', finishedDays: -5 },
  { order: 12, line: 1, startDays: -13, stageStep: 3, status: 'DONE', doneStages: 4, priority: 'LOW', finishedDays: -4 },
  // Chờ QC
  { order: 10, line: 1, startDays: -20, stageStep: 2.5, status: 'AWAITING_QC', doneStages: 5, priority: 'NORMAL', reworkCount: 1 },
  { order: 9, line: 2, startDays: -18, stageStep: 3, status: 'AWAITING_QC', doneStages: 4, priority: 'NORMAL' },
  // Đang sản xuất
  { order: 5, line: 1, startDays: -9, stageStep: 2, status: 'IN_PROGRESS', doneStages: 2, priority: 'URGENT', progressFrac: 0.65 },
  { order: 6, line: 1, startDays: -12, stageStep: 2, status: 'IN_PROGRESS', doneStages: 1, priority: 'HIGH', progressFrac: 0.55 },
  { order: 7, line: 1, startDays: -14, stageStep: 2, status: 'IN_PROGRESS', doneStages: 2, priority: 'HIGH', progressFrac: 0.6 },
  { order: 7, line: 2, startDays: -13, stageStep: 2, status: 'IN_PROGRESS', doneStages: 3, priority: 'NORMAL', progressFrac: 0.5 },
  { order: 8, line: 1, startDays: -18, stageStep: 2, status: 'IN_PROGRESS', doneStages: 3, priority: 'HIGH', progressFrac: 0.45 },
  { order: 9, line: 1, startDays: -13, stageStep: 2, status: 'IN_PROGRESS', doneStages: 2, priority: 'NORMAL' },
  { order: 10, line: 2, startDays: -13, stageStep: 2, status: 'IN_PROGRESS', doneStages: 1, priority: 'HIGH', progressFrac: 0.6 },
  { order: 10, line: 3, startDays: -15, stageStep: 2, status: 'IN_PROGRESS', doneStages: 3, priority: 'URGENT', progressFrac: 0.7 },
  // Chờ sản xuất (đơn đã duyệt)
  { order: 3, line: 1, startDays: 0, stageStep: 1, status: 'WAITING', doneStages: 0, priority: 'HIGH' },
  { order: 3, line: 2, startDays: 0, stageStep: 1, status: 'WAITING', doneStages: 0, priority: 'NORMAL' },
  { order: 4, line: 1, startDays: 0, stageStep: 1, status: 'WAITING', doneStages: 0, priority: 'NORMAL' },
  // Huỷ theo đơn
  { order: 16, line: 1, startDays: 0, stageStep: 1, status: 'CANCELLED', doneStages: 0, priority: 'NORMAL' },
];

// ============================================================
// Tiện ích
// ============================================================

function dayKey(offsetDays: number): string {
  return dayjs().add(offsetDays, 'day').format('YYYY-MM-DD');
}

function dayIso(offsetDays: number, hour = 8, minute = 0): string {
  return dayjs().add(offsetDays, 'day').hour(hour).minute(minute).second(0).millisecond(0).toISOString();
}

function shiftOf(hour: number): ShiftId {
  if (hour < 12) return 'MORNING';
  if (hour < 18) return 'AFTERNOON';
  return 'EVENING';
}

/** Sinh số giả ngẫu nhiên ổn định để dữ liệu mẫu lặp lại được */
function makeRng(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

interface SeedContext {
  teams: Team[];
  employees: Employee[];
  materials: Material[];
  customers: Customer[];
  products: Product[];
  bomStages: BomStage[];
  bomMaterials: BomMaterial[];
  workOrders: WorkOrder[];
  workOrderStages: WorkOrderStage[];
  progressByWorkOrder: Map<string, number>;
  orders: SalesOrder[];
  orderItems: SalesOrderItem[];
  teamByCode: Map<string, Team>;
  employeeById: Map<string, Employee>;
  materialByCode: Map<string, Material>;
  customerByCode: Map<string, Customer>;
  productByCode: Map<string, Product>;
  rng: () => number;
  manager: Actor;
  storekeeper: Actor;
  qc: Actor;
}

function actorOf(employee: Employee): Actor {
  return { employeeId: employee.id, name: employee.name, role: employee.role };
}

// ============================================================
// Seed
// ============================================================

export async function ensureSeed(): Promise<{ seeded: boolean }> {
  await db.open();
  const meta = await db.appMeta.get('seedVersion');
  if (meta?.value === SEED_VERSION) {
    return { seeded: false };
  }
  const seeded = await seedDatabase();
  return { seeded };
}

export async function seedDatabase(): Promise<boolean> {
  return db.transaction('rw', db.tables, async () => {
    const meta = await db.appMeta.get('seedVersion');
    if (meta?.value === SEED_VERSION) {
      return false;
    }
    for (const table of db.tables) {
      await table.clear();
    }
    await runSeed();
    await db.appMeta.put({ key: 'seedVersion', value: SEED_VERSION });
    await db.appMeta.put({ key: 'seededAt', value: nowIso() });
    await db.appMeta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
    return true;
  });
}

async function runSeed(): Promise<void> {
  const now = nowIso();
  const rng = makeRng(20261018);

  // ---------- Cấu hình ----------
  const settings: SettingRecord[] = [
    { key: SETTING_KEYS.WORKSHOP_INFO, value: DEFAULT_WORKSHOP_INFO, updatedAt: now },
    { key: SETTING_KEYS.PRINT_CONFIG, value: DEFAULT_PRINT_CONFIG, updatedAt: now },
    { key: SETTING_KEYS.APP_META, value: DEFAULT_APP_META, updatedAt: now },
  ];
  await db.settings.bulkPut(settings);

  // ---------- Tổ, nhân sự, nhà cung cấp ----------
  const teams: Team[] = TEAMS.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    note: t.note,
    active: true,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }));
  const leaderByTeam = new Map<string, string>();
  for (const e of EMPLOYEES) {
    if (e.position === 'LEADER' && e.teamId) leaderByTeam.set(e.teamId, e.id);
  }
  teams.forEach((t) => {
    t.leaderId = leaderByTeam.get(t.id);
  });
  await db.teams.bulkAdd(teams);

  const employees: Employee[] = EMPLOYEES.map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
    role: e.role,
    position: e.position,
    teamId: e.teamId,
    phone: e.phone,
    active: true,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }));
  await db.employees.bulkAdd(employees);

  const suppliers: Supplier[] = SUPPLIERS.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    phone: s.phone,
    address: s.address,
    active: true,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }));
  await db.suppliers.bulkAdd(suppliers);

  const customers: Customer[] = CUSTOMERS.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    searchName: toSearchName(`${c.code} ${c.name}`),
    phone: c.phone,
    address: c.address,
    active: true,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }));
  await db.customers.bulkAdd(customers);

  // ---------- Nguyên vật liệu (tồn đầu kỳ) ----------
  const materials: Material[] = MATERIALS.map(([code, name, unit, minQty, avgCost, openingQty]) => ({
    id: `nvl-${code.toLowerCase()}`,
    code,
    name,
    searchName: toSearchName(`${code} ${name}`),
    unit,
    stockQty: openingQty,
    minQty,
    avgCostVnd: avgCost,
    active: true,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }));
  await db.materials.bulkAdd(materials);

  // ---------- Sản phẩm + BOM ----------
  const products: Product[] = [];
  const bomStages: BomStage[] = [];
  const bomMaterials: BomMaterial[] = [];
  const materialByCode = new Map(materials.map((m) => [m.code, m]));
  for (const def of PRODUCTS) {
    const product: Product = {
      id: `sp-${def.code.toLowerCase()}`,
      code: def.code,
      name: def.name,
      searchName: toSearchName(`${def.code} ${def.name}`),
      unit: def.unit,
      salePriceVnd: def.salePriceVnd,
      active: true,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    products.push(product);
    def.stages.forEach(([name, teamCode, pieceRate, minutes], idx) => {
      bomStages.push({
        id: `bom-${def.code}-s${idx + 1}`,
        productId: product.id,
        seq: idx + 1,
        name,
        teamId: teamCode === 'to-01' ? 'to-01' : teamCode,
        pieceRateVnd: pieceRate,
        standardMinutes: minutes,
      });
    });
    def.materials.forEach(([materialCode, qty, waste]) => {
      const material = materialByCode.get(materialCode);
      if (!material) return;
      bomMaterials.push({
        id: `bom-${def.code}-m-${materialCode}`,
        productId: product.id,
        materialId: material.id,
        quantityPerUnit: qty,
        wastePct: waste,
      });
    });
  }
  await db.products.bulkAdd(products);
  await db.bomStages.bulkAdd(bomStages);
  await db.bomMaterials.bulkAdd(bomMaterials);

  const ctx: SeedContext = {
    teams,
    employees,
    materials,
    customers,
    products,
    bomStages,
    bomMaterials,
    workOrders: [],
    workOrderStages: [],
    progressByWorkOrder: new Map(),
    orders: [],
    orderItems: [],
    teamByCode: new Map(teams.map((t) => [t.code, t])),
    employeeById: new Map(employees.map((e) => [e.id, e])),
    materialByCode,
    customerByCode: new Map(customers.map((c) => [c.code, c])),
    productByCode: new Map(products.map((p) => [p.code, p])),
    rng,
    manager: actorOf(employees[0]),
    storekeeper: actorOf(employees[13]),
    qc: actorOf(employees[12]),
  };

  // ---------- Đơn hàng + lệnh sản xuất ----------
  await seedOrders(ctx);
  await seedWorkOrders(ctx);

  // ---------- Kho: nhập NVL, xuất NVL ----------
  await seedReceipts(ctx);
  await seedIssues(ctx);

  // ---------- Sản lượng, QC, thành phẩm, giao hàng ----------
  await seedProductionLogs(ctx);
  await seedQcChecks(ctx);
  await seedStockAndDeliveries(ctx);

  // ---------- Lương khoán ----------
  await seedPayroll(ctx);

  // ---------- Nhật ký hoạt động ----------
  await seedActivities(ctx);
}

async function seedOrders(ctx: SeedContext): Promise<void> {
  const { rng } = ctx;
  for (const def of ORDERS) {
    const customer = ctx.customerByCode.get(def.customerCode);
    if (!customer) continue;
    const createdAt = dayIso(def.createdAtDays, 8 + Math.floor(rng() * 3), Math.floor(rng() * 59));
    const orderId = newId();
    const items: SalesOrderItem[] = def.lines.map(([productCode, qty, unitPrice]) => {
      const product = ctx.productByCode.get(productCode);
      return {
        id: newId(),
        orderId,
        productId: product?.id ?? '',
        quantity: qty,
        unitPriceVnd: unitPrice,
        deliveredQty: 0,
      };
    });
    const order: SalesOrder = {
      id: orderId,
      code: await nextCode('SALES_ORDER'),
      customerId: customer.id,
      status: def.status,
      dueDate: dayIso(def.dueDays, 17),
      totalVnd: items.reduce((s, i) => s + lineAmountVnd(i.quantity, i.unitPriceVnd), 0),
      approvedAt: def.approvedDays != null ? dayIso(def.approvedDays, 9, 15) : undefined,
      cancelledAt: def.cancelledDays != null ? dayIso(def.cancelledDays, 10, 5) : undefined,
      cancelReason: def.cancelReason,
      createdAt,
      updatedAt: def.cancelledDays != null ? dayIso(def.cancelledDays, 10, 5) : createdAt,
      createdBy: ctx.employeeById.get('emp-planner')?.id,
      revision: 1,
    };
    await db.salesOrders.add(order);
    await db.salesOrderItems.bulkAdd(items);
    ctx.orders.push(order);
    ctx.orderItems.push(...items);
  }
}

async function seedWorkOrders(ctx: SeedContext): Promise<void> {
  for (const plan of WORK_ORDERS) {
    const order = ctx.orders[plan.order - 1];
    if (!order) continue;
    const item = ctx.orderItems.find((i) => i.orderId === order.id && i.productId === ctx.productByCode.get(ORDERS[plan.order - 1].lines[plan.line - 1][0])?.id);
    if (!item) continue;
    const product = ctx.products.find((p) => p.id === item.productId);
    if (!product) continue;
    const stages = ctx.bomStages.filter((s) => s.productId === product.id).sort((a, b) => a.seq - b.seq);
    if (stages.length === 0) continue;
    const doneStages = Math.min(plan.doneStages, stages.length);

    const materialReqs: WorkOrderMaterialReq[] = ctx.bomMaterials
      .filter((m) => m.productId === product.id)
      .map((m) => ({ materialId: m.materialId, quantityPerUnit: m.quantityPerUnit, wastePct: m.wastePct }));

    const createdAt = dayIso(Math.min(plan.startDays, 0), 8, 30);
    const workOrder: WorkOrder = {
      id: newId(),
      code: await nextCode('WORK_ORDER'),
      salesOrderId: order.id,
      salesOrderItemId: item.id,
      productId: product.id,
      quantity: item.quantity,
      status: plan.status,
      priority: plan.priority,
      dueDate: order.dueDate,
      reworkCount: plan.reworkCount ?? 0,
      materialReqs,
      createdAt,
      updatedAt: createdAt,
      createdBy: ctx.employeeById.get('emp-planner')?.id,
      revision: 1,
    };
    if (plan.status === 'IN_PROGRESS' || plan.status === 'AWAITING_QC' || plan.status === 'DONE') {
      workOrder.startedAt = dayIso(plan.startDays, 8, 0);
    }
    if (plan.status === 'AWAITING_QC') {
      const lastStageStart = plan.startDays + plan.stageStep * (stages.length - 1);
      workOrder.awaitingQcAt = dayIso(lastStageStart + plan.stageStep, 16, 30);
    }
    if (plan.status === 'DONE') {
      workOrder.finishedAt = dayIso(plan.finishedDays ?? plan.startDays + plan.stageStep * stages.length, 16, 0);
    }
    await db.workOrders.add(workOrder);

    const workStages: WorkOrderStage[] = stages.map((s, idx) => {
      const isDone = idx < doneStages;
      const isCurrent = idx === doneStages && plan.status === 'IN_PROGRESS';
      const startedDays = plan.startDays + plan.stageStep * idx;
      const stage: WorkOrderStage = {
        id: newId(),
        workOrderId: workOrder.id,
        seq: s.seq,
        name: s.name,
        teamId: s.teamId,
        pieceRateVnd: s.pieceRateVnd,
        standardMinutes: s.standardMinutes,
        status: isDone ? 'DONE' : isCurrent ? 'IN_PROGRESS' : 'PENDING',
        startedAt: isDone || isCurrent ? dayIso(startedDays, 8, 0) : undefined,
        finishedAt: isDone ? dayIso(startedDays + plan.stageStep, 16, 0) : undefined,
      };
      return stage;
    });
    await db.workOrderStages.bulkAdd(workStages);
    ctx.workOrders.push(workOrder);
    ctx.workOrderStages.push(...workStages);
    ctx.progressByWorkOrder.set(workOrder.id, plan.progressFrac ?? 0.5);
  }
}

// ---------- Kho ----------

async function seedReceipts(ctx: SeedContext): Promise<void> {
  const receipts: Array<{
    supplierCode: string;
    days: number;
    post: boolean;
    note: string;
    lines: Array<[string, number, number]>;
  }> = [
    {
      supplierCode: 'NCC-001',
      days: -20,
      post: true,
      note: 'Nhập thép hộp và thép tấm cho kế hoạch tháng',
      lines: [
        ['TH-2040', 500, 18200],
        ['TH-2550', 400, 19500],
        ['TT-2MM', 20, 705000],
      ],
    },
    {
      supplierCode: 'NCC-002',
      days: -12,
      post: true,
      note: 'Nhập bột sơn và dung môi bổ sung cho dây chuyền sơn',
      lines: [
        ['SON-BOT', 200, 93000],
        ['DM-01', 5, 44000],
      ],
    },
    {
      supplierCode: 'NCC-003',
      days: -6,
      post: true,
      note: 'Nhập phụ kiện kim khí',
      lines: [
        ['BL-M8', 2000, 1150],
        ['DN-M8', 2000, 680],
        ['LD-M8', 3000, 290],
      ],
    },
    {
      supplierCode: 'NCC-004',
      days: -2,
      post: false,
      note: 'Phiếu nháp: bổ sung dung môi, giấy nhám',
      lines: [
        ['DM-01', 40, 45500],
        ['GN-01', 500, 6400],
      ],
    },
    {
      supplierCode: 'NCC-001',
      days: 0,
      post: false,
      note: 'Phiếu nháp: dự trữ thép theo kế hoạch tuần sau',
      lines: [
        ['TH-2040', 300, 18600],
        ['TV-3030', 200, 17000],
      ],
    },
  ];

  for (const def of receipts) {
    const supplier = SUPPLIERS.find((s) => s.code === def.supplierCode);
    const createdAt = dayIso(def.days, 9, 20);
    const receiptId = newId();
    const items: MaterialReceiptItem[] = def.lines.map(([code, qty, cost]) => {
      const material = ctx.materialByCode.get(code)!;
      return {
        id: newId(),
        receiptId,
        materialId: material.id,
        materialNameSnapshot: material.name,
        unitSnapshot: material.unit,
        quantity: qty,
        unitCostVnd: cost,
      };
    });
    const record: MaterialReceipt = {
      id: receiptId,
      code: await nextCode('MATERIAL_RECEIPT'),
      supplierId: supplier?.id,
      supplierNameSnapshot: supplier?.name,
      status: def.post ? 'POSTED' : 'DRAFT',
      totalVnd: items.reduce((s, i) => s + Math.round(i.quantity * i.unitCostVnd), 0),
      note: def.note,
      createdAt,
      postedAt: def.post ? dayIso(def.days, 14, 10) : undefined,
      createdBy: ctx.storekeeper.employeeId,
      revision: 1,
    };
    await db.materialReceipts.add(record);
    await db.materialReceiptItems.bulkAdd(items);
    if (!def.post) continue;
    const at = record.postedAt ?? createdAt;
    for (const item of items) {
      const material = ctx.materials.find((m) => m.id === item.materialId);
      if (!material) continue;
      material.stockQty = roundQty(material.stockQty + item.quantity, 4);
      material.avgCostVnd = weightedAverageCost(material.stockQty - item.quantity, material.avgCostVnd, item.quantity, item.unitCostVnd);
      material.updatedAt = at;
      material.revision += 1;
      await db.materials.put(material);
      const movement: StockMovement = {
        id: newId(),
        materialId: material.id,
        type: 'RECEIPT_IN',
        quantity: item.quantity,
        unitCostVnd: item.unitCostVnd,
        refType: 'MATERIAL_RECEIPT',
        refId: record.id,
        refCode: record.code,
        at,
        note: supplier?.name,
      };
      await db.stockMovements.add(movement);
    }
  }
}

async function seedIssues(ctx: SeedContext): Promise<void> {
  const issues: Array<{ workOrder: number; post: boolean; days: number; note: string; lines: Array<[string, number]> }> = [
    { workOrder: 1, post: true, days: -34, note: 'Cấp đủ vật tư cho lệnh khung thép hộp', lines: [['TH-2040', 104.04], ['OK-21', 7.416], ['QH-J421', 4.41], ['SON-BOT', 5.67], ['BL-M8', 98.88]] },
    { workOrder: 2, post: true, days: -18, note: 'Cấp vật tư cho lệnh kệ sắt 5 tầng', lines: [['TH-2550', 110.16], ['TT-2MM', 18.72], ['QH-J421', 3.78], ['SON-BOT', 5.67], ['BL-M8', 148.32]] },
    { workOrder: 9, post: true, days: -7, note: 'Cấp trước 2 loại vật tư chính, phần còn lại bổ sung sau', lines: [['TH-2040', 94.86], ['TV-3030', 36.72]] },
    { workOrder: 10, post: true, days: -10, note: 'Cấp đủ vật tư cho lệnh khung thép 25 cái', lines: [['TH-2040', 216.75], ['OK-21', 15.45], ['QH-J421', 9.1875], ['SON-BOT', 11.8125], ['BL-M8', 206]] },
    { workOrder: 11, post: true, days: -12, note: 'Cấp vật tư cho lệnh bàn inox', lines: [['TT-2MM', 25.2], ['TH-2550', 36.72], ['QH-J421', 2.52], ['LD-M8', 98.88], ['ON-01', 9.36]] },
    { workOrder: 16, post: false, days: -1, note: 'Phiếu nháp chờ tổ trưởng xác nhận định mức thực tế', lines: [['TH-2550', 132.6], ['XCL-08', 16.48], ['BX-N75', 20]] },
    { workOrder: 17, post: false, days: -1, note: 'Phiếu nháp cấp vật tư khung thép', lines: [['TH-2040', 121.38], ['OK-21', 8.652], ['QH-J421', 5.145]] },
    { workOrder: 18, post: false, days: 0, note: 'Phiếu nháp chờ xác nhận quy cách thép tấm', lines: [['TH-2550', 73.44], ['TT-2MM', 12.48], ['BL-M8', 98.88]] },
  ];

  for (const def of issues) {
    const workOrder = ctx.workOrders[def.workOrder - 1];
    if (!workOrder) continue;
    const createdAt = dayIso(def.days, 8, 45);
    const issueId = newId();
    const items: MaterialIssueItem[] = def.lines.map(([code, qty]) => {
      const material = ctx.materialByCode.get(code)!;
      return {
        id: newId(),
        issueId,
        materialId: material.id,
        materialNameSnapshot: material.name,
        unitSnapshot: material.unit,
        quantity: qty,
        unitCostVnd: material.avgCostVnd,
      };
    });
    const record: MaterialIssue = {
      id: issueId,
      code: await nextCode('MATERIAL_ISSUE'),
      workOrderId: workOrder.id,
      status: def.post ? 'POSTED' : 'DRAFT',
      totalVnd: items.reduce((s, i) => s + Math.round(i.quantity * i.unitCostVnd), 0),
      note: def.note,
      createdAt,
      postedAt: def.post ? dayIso(def.days, 10, 15) : undefined,
      createdBy: ctx.storekeeper.employeeId,
      revision: 1,
    };
    await db.materialIssues.add(record);
    await db.materialIssueItems.bulkAdd(items);
    if (!def.post) continue;
    const at = record.postedAt ?? createdAt;
    for (const item of items) {
      const material = ctx.materials.find((m) => m.id === item.materialId);
      if (!material) continue;
      material.stockQty = roundQty(material.stockQty - item.quantity, 4);
      material.updatedAt = at;
      material.revision += 1;
      await db.materials.put(material);
      await db.stockMovements.add({
        id: newId(),
        materialId: material.id,
        type: 'ISSUE_OUT',
        quantity: item.quantity,
        unitCostVnd: item.unitCostVnd,
        refType: 'MATERIAL_ISSUE',
        refId: record.id,
        refCode: record.code,
        at,
        note: `Cấp cho lệnh ${workOrder.code}`,
      } satisfies StockMovement);
    }
  }
}

// ---------- Sản lượng ----------

async function seedProductionLogs(ctx: SeedContext): Promise<void> {
  const employeesByTeam = new Map<string, Employee[]>();
  for (const employee of ctx.employees) {
    if (!employee.teamId) continue;
    const list = employeesByTeam.get(employee.teamId) ?? [];
    list.push(employee);
    employeesByTeam.set(employee.teamId, list);
  }

  const createLog = async (
    workOrder: WorkOrder,
    stage: WorkOrderStage,
    dateKeyValue: string,
    hour: number,
    quantityGood: number,
    quantityBad: number,
    note?: string,
  ) => {
    const team = employeesByTeam.get(stage.teamId) ?? ctx.employees;
    const employee = team[Math.floor(ctx.rng() * team.length)];
    const created = dayjs(`${dateKeyValue}T${String(hour).padStart(2, '0')}:30:00`).toISOString();
    const record: ProductionLog = {
      id: newId(),
      code: await nextCode('PRODUCTION_LOG', dateKeyValue.slice(0, 7).replace('-', '')),
      workOrderId: workOrder.id,
      stageId: stage.id,
      teamId: stage.teamId,
      employeeId: employee.id,
      shift: shiftOf(hour),
      date: dateKeyValue,
      quantityGood: roundQty(quantityGood, 3),
      quantityBad: roundQty(quantityBad, 3),
      amountVnd: lineAmountVnd(roundQty(quantityGood, 3), stage.pieceRateVnd),
      note,
      createdAt: created,
      createdBy: employee.id,
      revision: 1,
    };
    await db.productionLogs.add(record);
  };

  const todayKeyValue = dayKey(0);
  let todayCount = 0;

  for (const workOrder of ctx.workOrders) {
    if (workOrder.status === 'CANCELLED') continue;
    const stages = ctx.workOrderStages.filter((s) => s.workOrderId === workOrder.id).sort((a, b) => a.seq - b.seq);
    const doneStages = stages.filter((s) => s.status === 'DONE');
    const currentStage = stages.find((s) => s.status === 'IN_PROGRESS');

    for (const stage of doneStages) {
      const startDateKey = (stage.startedAt ?? workOrder.createdAt).slice(0, 10);
      const finishDateKey = (stage.finishedAt ?? stage.startedAt ?? workOrder.createdAt).slice(0, 10);
      // Làm lại: công đoạn cuối của lệnh từng QC không đạt được ghi thêm một phần sản lượng
      if (workOrder.reworkCount > 0 && stage.seq === stages.length && workOrder.status === 'AWAITING_QC') {
        await createLog(workOrder, stage, startDateKey, 8, roundQty(workOrder.quantity * 0.7, 3), roundQty(workOrder.quantity * 0.02, 3), 'Lô đầu trong ngày');
        await createLog(workOrder, stage, dayKey(-5), 14, roundQty(workOrder.quantity * 0.3, 3), 0, 'Hoàn tất lô đầu');
        await createLog(workOrder, stage, dayKey(-3), 9, roundQty(workOrder.quantity * 0.5, 3), roundQty(workOrder.quantity * 0.02, 3), 'Làm lại sau QC không đạt');
        continue;
      }
      if (workOrder.reworkCount > 0 && stage.seq === stages.length) {
        await createLog(workOrder, stage, startDateKey, 8, roundQty(workOrder.quantity * 0.75, 3), roundQty(workOrder.quantity * 0.03, 3), 'Lô đầu');
        await createLog(workOrder, stage, finishDateKey, 14, roundQty(workOrder.quantity * 0.25, 3), roundQty(workOrder.quantity * 0.02, 3), 'Làm lại phần lỗi rồi hoàn tất');
        continue;
      }
      if (startDateKey === finishDateKey) {
        await createLog(workOrder, stage, startDateKey, 9, roundQty(workOrder.quantity * 0.6, 3), 0, 'Ca sáng');
        await createLog(workOrder, stage, finishDateKey, 14, roundQty(workOrder.quantity * 0.4, 3), Math.floor(ctx.rng() * 2), 'Ca chiều, hoàn tất công đoạn');
      } else {
        await createLog(workOrder, stage, startDateKey, 8, roundQty(workOrder.quantity * 0.7, 3), Math.floor(ctx.rng() * 2), 'Triển khai trong ngày');
        await createLog(workOrder, stage, finishDateKey, 15, roundQty(workOrder.quantity * 0.3, 3), 0, 'Hoàn tất công đoạn');
      }
    }

    if (currentStage) {
      const startDateKey = (currentStage.startedAt ?? workOrder.createdAt).slice(0, 10);
      const frac = ctx.progressByWorkOrder.get(workOrder.id) ?? 0.5;
      const target = roundQty(workOrder.quantity * frac, 3);
      const firstBatch = roundQty(target * 0.5, 3);
      const secondBatch = roundQty(target * 0.3, 3);
      const thirdBatch = roundQty(target - firstBatch - secondBatch, 3);
      await createLog(workOrder, currentStage, startDateKey, 9, firstBatch, Math.floor(ctx.rng() * 2), 'Bắt đầu tổ triển khai');
      await createLog(workOrder, currentStage, dayKey(-2), 14, secondBatch, 0, 'Tiếp tục ca chiều');
      if (thirdBatch > 0) {
        await createLog(workOrder, currentStage, todayKeyValue, 10 + Math.floor(ctx.rng() * 6), thirdBatch, Math.floor(ctx.rng() * 2), 'Sản lượng hôm nay');
        todayCount += 1;
      }
    }
  }

  // Bổ sung thêm phiếu hôm nay để bảng điều khiển có dữ liệu sống
  const runningStages = ctx.workOrderStages.filter((s) => s.status === 'IN_PROGRESS');
  const targetToday = Math.max(8, todayCount);
  let guard = 0;
  while (todayCount < targetToday && runningStages.length > 0 && guard < 40) {
    const stage = runningStages[guard % runningStages.length];
    const workOrder = ctx.workOrders.find((w) => w.id === stage.workOrderId);
    guard += 1;
    if (!workOrder) continue;
    await createLog(workOrder, stage, todayKeyValue, 13 + (guard % 5), roundQty(Math.max(1, workOrder.quantity * 0.05), 3), 0, 'Bổ sung sản lượng trong ngày');
    todayCount += 1;
  }
}

// ---------- QC ----------

async function seedQcChecks(ctx: SeedContext): Promise<void> {
  // 18 phiếu trong 30 ngày gần đây: 15 đạt, 3 không đạt (đã làm lại và đạt, hoặc đang chờ kiểm lại)
  const checks: Array<{
    workOrder: number;
    days: number;
    hour: number;
    result: QcCheck['result'];
    defect: QcCheck['defectType'];
    passed: number;
    failed: number;
    note?: string;
  }> = [
    { workOrder: 1, days: -25, hour: 15, result: 'PASSED', defect: 'OTHER', passed: 12, failed: 0, note: 'Khung hộp đúng bản vẽ, mối hàn đạt.' },
    { workOrder: 1, days: -24, hour: 10, result: 'PASSED', defect: 'OTHER', passed: 12, failed: 0, note: 'Kiểm lại mẫu trước khi nhập kho.' },
    { workOrder: 1, days: -20, hour: 9, result: 'PASSED', defect: 'OTHER', passed: 12, failed: 0, note: 'Kiểm mẫu lưu kho, đạt.' },
    { workOrder: 2, days: -16, hour: 10, result: 'FAILED', defect: 'PAINT', passed: 4, failed: 2, note: '2 bộ bị chảy sơn ở chân kệ, trả về tổ Sơn xử lý lại.' },
    { workOrder: 2, days: -15, hour: 16, result: 'PASSED', defect: 'OTHER', passed: 6, failed: 0, note: 'Đã sơn lại, kiểm lần 2 đạt.' },
    { workOrder: 2, days: -14, hour: 11, result: 'PASSED', defect: 'OTHER', passed: 6, failed: 0, note: 'Kiểm mẫu sau khi nhập kho.' },
    { workOrder: 3, days: -12, hour: 10, result: 'FAILED', defect: 'WELD', passed: 16, failed: 4, note: '4 xe bị rỗ mối hàn ở góc khung, yêu cầu hàn lại.' },
    { workOrder: 3, days: -10, hour: 15, result: 'PASSED', defect: 'OTHER', passed: 20, failed: 0 },
    { workOrder: 3, days: -9, hour: 9, result: 'PASSED', defect: 'OTHER', passed: 20, failed: 0, note: 'Kiểm mẫu trước khi đóng gói xuất hàng.' },
    { workOrder: 7, days: -7, hour: 16, result: 'FAILED', defect: 'DIMENSION', passed: 2, failed: 2, note: 'Kệ bị lệch 4mm so với bản vẽ, yêu cầu hàn lại rồi kiểm lại.' },
    { workOrder: 4, days: -7, hour: 14, result: 'PASSED', defect: 'OTHER', passed: 8, failed: 0, note: 'Vỏ tủ điện đủ lỗ đột, sơn đều.' },
    { workOrder: 4, days: -6, hour: 10, result: 'PASSED', defect: 'OTHER', passed: 8, failed: 0, note: 'Kiểm lại ngẫu nhiên 2 vỏ tủ.' },
    { workOrder: 5, days: -6, hour: 9, result: 'PASSED', defect: 'OTHER', passed: 12, failed: 0 },
    { workOrder: 5, days: -5, hour: 15, result: 'PASSED', defect: 'OTHER', passed: 12, failed: 0 },
    { workOrder: 6, days: -4, hour: 15, result: 'PASSED', defect: 'OTHER', passed: 24, failed: 0, note: 'Lan can thẳng, mối hàn đánh bóng đạt.' },
    { workOrder: 6, days: -3, hour: 9, result: 'PASSED', defect: 'OTHER', passed: 24, failed: 0, note: 'Kiểm lại mẫu trước khi giao.' },
    { workOrder: 4, days: -4, hour: 14, result: 'PASSED', defect: 'OTHER', passed: 8, failed: 0 },
    { workOrder: 6, days: -2, hour: 10, result: 'PASSED', defect: 'OTHER', passed: 24, failed: 0, note: 'Kiểm mẫu lần cuối, đủ điều kiện giao.' },
  ];
  for (const def of checks) {
    const workOrder = ctx.workOrders[def.workOrder - 1];
    if (!workOrder) continue;
    const checkedAt = dayIso(def.days, def.hour, 20);
    const check: QcCheck = {
      id: newId(),
      code: await nextCode('QC_CHECK'),
      workOrderId: workOrder.id,
      checkedQty: def.passed + def.failed,
      passedQty: def.passed,
      failedQty: def.failed,
      defectType: def.defect,
      result: def.result,
      afterRework: workOrder.reworkCount > 0,
      note: def.note,
      checkedById: ctx.qc.employeeId,
      checkedAt,
    };
    await db.qcChecks.add(check);
    workOrder.updatedAt = checkedAt;
  }
}

// ---------- Thành phẩm & giao hàng ----------

async function seedStockAndDeliveries(ctx: SeedContext): Promise<void> {
  const stockByProduct = new Map<string, number>();
  for (const workOrder of ctx.workOrders) {
    if (workOrder.status !== 'DONE') continue;
    const checks = await db.qcChecks.where('workOrderId').equals(workOrder.id).toArray();
    const passed = checks.filter((c) => c.result === 'PASSED').reduce((s, c) => s + c.passedQty, 0);
    const quantity = Math.min(workOrder.quantity, passed);
    stockByProduct.set(workOrder.productId, roundQty((stockByProduct.get(workOrder.productId) ?? 0) + quantity, 3));
    await db.stockMovements.add({
      id: newId(),
      productId: workOrder.productId,
      type: 'PRODUCT_IN',
      quantity,
      refType: 'WORK_ORDER',
      refId: workOrder.id,
      refCode: workOrder.code,
      at: workOrder.finishedAt ?? workOrder.updatedAt ?? workOrder.createdAt,
      note: `Nhập kho thành phẩm từ lệnh ${workOrder.code}`,
    } satisfies StockMovement);
  }

  // Giao hàng cho 3 đơn đã giao
  const deliveries: Array<{ order: number; days: number; note: string; receivedBy: string }> = [
    { order: 13, days: -22, note: 'Giao đủ 12 khung thép hộp theo hợp đồng.', receivedBy: 'Anh Tuấn — đại diện Cty Nội thất Phố' },
    { order: 14, days: -14, note: 'Giao 6 bộ kệ sắt 5 tầng, khách kiểm tại xưởng.', receivedBy: 'Chị Hòa — VLXD Hòa Phát' },
    { order: 15, days: -8, note: 'Giao 20 xe đẩy hàng 4 bánh.', receivedBy: 'Anh Dũng — Nhà máy Gạch Bình Dương' },
  ];
  for (const def of deliveries) {
    const order = ctx.orders[def.order - 1];
    if (!order) continue;
    const items = ctx.orderItems.filter((i) => i.orderId === order.id);
    const deliveryId = newId();
    const deliveryCode = await nextCode('DELIVERY');
    const deliveryItems: DeliveryItem[] = [];
    let totalVnd = 0;
    const at = dayIso(def.days, 9, 30);
    for (const item of items) {
      const product = ctx.products.find((p) => p.id === item.productId);
      if (!product) continue;
      const remaining = roundQty(item.quantity - item.deliveredQty, 3);
      if (remaining <= 0) continue;
      deliveryItems.push({
        id: newId(),
        deliveryId,
        productId: product.id,
        productNameSnapshot: product.name,
        unitSnapshot: product.unit,
        quantity: remaining,
        unitPriceVnd: item.unitPriceVnd,
      });
      totalVnd += lineAmountVnd(remaining, item.unitPriceVnd);
      item.deliveredQty = roundQty(item.deliveredQty + remaining, 3);
      await db.salesOrderItems.put(item);
      stockByProduct.set(product.id, roundQty((stockByProduct.get(product.id) ?? 0) - remaining, 3));
      await db.stockMovements.add({
        id: newId(),
        productId: product.id,
        type: 'DELIVERY_OUT',
        quantity: remaining,
        unitPriceVnd: item.unitPriceVnd,
        refType: 'DELIVERY',
        refId: deliveryId,
        refCode: deliveryCode,
        at,
        note: `Giao cho đơn ${order.code}`,
      } satisfies StockMovement);
    }
    const delivery: Delivery = {
      id: deliveryId,
      code: deliveryCode,
      salesOrderId: order.id,
      status: 'POSTED',
      totalVnd,
      note: def.note,
      createdAt: at,
      deliveredAt: at,
      createdBy: ctx.storekeeper.employeeId,
      receivedBy: def.receivedBy,
      revision: 1,
    };
    await db.deliveries.add(delivery);
    await db.deliveryItems.bulkAdd(deliveryItems);
  }

  const stockRows: ProductStock[] = [...stockByProduct.entries()]
    .filter(([, quantity]) => quantity > 0)
    .map(([productId, quantity]) => ({ id: `ps::${productId}`, productId, quantity: roundQty(quantity, 3), updatedAt: nowIso() }));
  if (stockRows.length > 0) await db.productStock.bulkPut(stockRows);
}

// ---------- Lương khoán ----------

async function seedPayroll(ctx: SeedContext): Promise<void> {
  const months = [dayjs(), dayjs().subtract(1, 'month')];
  const currentMonth = months[0];
  const previousMonth = months[1];

  // Kỳ tháng trước đã chốt (dữ liệu lấy từ phiếu sản lượng trong kỳ)
  const prevFrom = previousMonth.startOf('month').toISOString();
  const prevTo = previousMonth.endOf('month').toISOString();
  const prevComputation = await computePayroll(prevFrom, prevTo);
  if (prevComputation.rows.length > 0) {
    await lockPayrollPeriod(ctx.manager, {
      periodKey: previousMonth.format('YYYY-MM'),
      from: prevFrom,
      to: prevTo,
    });
  }

  // Kỳ tháng hiện tại đang mở
  const period: PayrollPeriod = {
    id: newId(),
    code: await nextCode('PAYROLL_PERIOD', currentMonth.format('YYYY-MM')),
    periodKey: currentMonth.format('YYYY-MM'),
    from: currentMonth.startOf('month').toISOString(),
    to: currentMonth.endOf('month').toISOString(),
    status: 'OPEN',
    totalVnd: 0,
    createdAt: nowIso(),
    createdBy: ctx.manager.employeeId,
    revision: 1,
  };
  await db.payrollPeriods.add(period);
}

// ---------- Nhật ký hoạt động ----------

async function seedActivities(ctx: SeedContext): Promise<void> {
  const actorOfCode = (code: string) => ctx.employees.find((e) => e.code === code);
  const manager = actorOfCode('NV-001');
  const planner = actorOfCode('NV-002');
  const store = actorOfCode('NV-014');
  const qc = actorOfCode('NV-013');
  const leader2 = actorOfCode('NV-004');
  const leader5 = actorOfCode('NV-007');

  const entries: Array<{ days: number; hour: number; minute?: number; actor?: Employee; summary: string; entityType: string; entityId: string; action: string }> = [
    { days: -40, hour: 9, actor: planner, summary: `Tạo đơn hàng ${ctx.orders[12]?.code ?? ''} cho Cty TNHH Nội thất Phố`, entityType: 'SALES_ORDER', entityId: ctx.orders[12]?.id ?? '', action: 'CREATED' },
    { days: -38, hour: 10, actor: planner, summary: `Duyệt đơn ${ctx.orders[12]?.code ?? ''} — sinh lệnh sản xuất ${ctx.workOrders[0]?.code ?? ''}`, entityType: 'SALES_ORDER', entityId: ctx.orders[12]?.id ?? '', action: 'APPROVED' },
    { days: -34, hour: 8, actor: store, summary: `Cấp 5 dòng vật tư cho lệnh ${ctx.workOrders[0]?.code ?? ''}`, entityType: 'WORK_ORDER', entityId: ctx.workOrders[0]?.id ?? '', action: 'MATERIAL_ISSUED' },
    { days: -25, hour: 15, actor: qc, summary: 'QC đạt: nhập kho 12 khung thép hộp từ lệnh sản xuất', entityType: 'WORK_ORDER', entityId: ctx.workOrders[0]?.id ?? '', action: 'QC_PASSED' },
    { days: -22, hour: 9, actor: store, summary: `Giao hàng cho đơn ${ctx.orders[12]?.code ?? ''} — 12 khung thép hộp`, entityType: 'SALES_ORDER', entityId: ctx.orders[12]?.id ?? '', action: 'DELIVERED' },
    { days: -20, hour: 14, actor: store, summary: 'Nhập kho 3 dòng vật tư từ Công ty Thép Hòa Phát', entityType: 'MATERIAL_RECEIPT', entityId: 'seed-receipt-1', action: 'POSTED' },
    { days: -16, hour: 10, actor: qc, summary: 'QC không đạt: 2 bộ kệ sảy sơn, yêu cầu làm lại', entityType: 'WORK_ORDER', entityId: ctx.workOrders[1]?.id ?? '', action: 'QC_FAILED' },
    { days: -15, hour: 16, actor: qc, summary: 'QC đạt sau làm lại: nhập kho 6 bộ kệ sắt 5 tầng', entityType: 'WORK_ORDER', entityId: ctx.workOrders[1]?.id ?? '', action: 'QC_PASSED' },
    { days: -14, hour: 9, actor: store, summary: `Giao hàng cho đơn ${ctx.orders[13]?.code ?? ''} — 6 bộ kệ sắt`, entityType: 'SALES_ORDER', entityId: ctx.orders[13]?.id ?? '', action: 'DELIVERED' },
    { days: -12, hour: 8, actor: store, summary: 'Cấp vật tư cho lệnh bàn inox 2 tầng', entityType: 'WORK_ORDER', entityId: ctx.workOrders[5]?.id ?? '', action: 'MATERIAL_ISSUED' },
    { days: -11, hour: 10, actor: planner, summary: 'Duyệt đơn hàng và sinh 3 lệnh sản xuất cho khách Hộ kinh doanh Minh Khuê', entityType: 'SALES_ORDER', entityId: ctx.orders[9]?.id ?? '', action: 'APPROVED' },
    { days: -8, hour: 9, actor: store, summary: `Giao hàng cho đơn ${ctx.orders[14]?.code ?? ''} — 20 xe đẩy hàng`, entityType: 'SALES_ORDER', entityId: ctx.orders[14]?.id ?? '', action: 'DELIVERED' },
    { days: -7, hour: 16, actor: qc, summary: 'QC không đạt: kệ sắt lệch kích thước, yêu cầu hàn lại', entityType: 'WORK_ORDER', entityId: ctx.workOrders[6]?.id ?? '', action: 'QC_FAILED' },
    { days: -6, hour: 11, actor: leader2, summary: 'Bắt đầu công đoạn Hàn & CNC cho lệnh khung thép 25 cái', entityType: 'WORK_ORDER', entityId: ctx.workOrders[9]?.id ?? '', action: 'STAGE_STARTED' },
    { days: -4, hour: 15, actor: leader5, summary: 'Hoàn thành công đoạn Đóng gói, lệnh chuyển sang chờ QC', entityType: 'WORK_ORDER', entityId: ctx.workOrders[12]?.id ?? '', action: 'STAGE_COMPLETED_LAST' },
    { days: -2, hour: 14, actor: manager, summary: 'Phê duyệt kế hoạch sản xuất tuần và ưu tiên các lệnh quá hạn', entityType: 'SYSTEM', entityId: 'plan', action: 'PLAN_APPROVED' },
    { days: 0, hour: 8, actor: store, summary: 'Lưu nháp phiếu nhập vật tư dự trữ thép cho tuần sau', entityType: 'MATERIAL_RECEIPT', entityId: 'seed-receipt-5', action: 'DRAFT' },
  ];

  for (const entry of entries) {
    const actor: Actor | undefined = entry.actor ? actorOf(entry.actor) : undefined;
    const record: ActivityLog = {
      id: newId(),
      entityType: entry.entityType,
      entityId: entry.entityId || 'seed',
      action: entry.action,
      actorId: actor?.employeeId,
      actorName: actor?.name,
      at: dayIso(entry.days, entry.hour, entry.minute ?? 0),
      summary: entry.summary,
    };
    await db.activityLogs.add(record);
  }
}
