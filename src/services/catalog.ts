import { db } from '../db/database';
import { newId } from '../utils/ids';
import { nowIso } from '../utils/format';
import { roundQty } from '../utils/money';
import { normalizePhone, toSearchName } from '../utils/text';
import type { Actor, BomMaterial, BomStage, Customer, Employee, Material, PositionId, Product, RoleId, Team } from '../types';
import { NotFoundError, assertRule } from './errors';
import { assertAction, logActivity } from './core';

// ---------- Khách hàng ----------

export interface CustomerInput {
  id?: string;
  code?: string;
  name: string;
  phone: string;
  address?: string;
  note?: string;
  active?: boolean;
}

export async function saveCustomer(actor: Actor, input: CustomerInput): Promise<Customer> {
  assertAction(actor, 'customer.manage');
  assertRule(input.name.trim().length >= 2, 'Vui lòng nhập tên khách hàng.');
  assertRule(normalizePhone(input.phone).length >= 8, 'Số điện thoại khách hàng cần ít nhất 8 chữ số.');
  return db.transaction('rw', [db.customers, db.activityLogs], async () => {
    const now = nowIso();
    const existing = input.id ? await db.customers.get(input.id) : undefined;
    if (input.id && !existing) throw new NotFoundError('Không tìm thấy khách hàng cần cập nhật.');
    let code = input.code?.trim() || existing?.code;
    if (!code) {
      const count = await db.customers.count();
      code = `KH-${String(count + 1).padStart(3, '0')}`;
      while (await db.customers.where('code').equals(code).first()) {
        code = `KH-${String(Number(code.slice(3)) + 1).padStart(3, '0')}`;
      }
    }
    const record: Customer = {
      id: existing?.id ?? newId(),
      code,
      name: input.name.trim(),
      searchName: toSearchName(input.name),
      phone: input.phone.trim(),
      address: input.address?.trim() || undefined,
      note: input.note?.trim() || undefined,
      active: input.active ?? existing?.active ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      revision: (existing?.revision ?? 0) + 1,
    };
    await db.customers.put(record);
    await logActivity({
      entityType: 'CUSTOMER',
      entityId: record.id,
      action: existing ? 'UPDATED' : 'CREATED',
      actor,
      summary: `${existing ? 'Cập nhật' : 'Thêm mới'} khách hàng ${record.name} (${record.code})`,
    });
    return record;
  });
}

// ---------- Nguyên vật liệu ----------

export interface MaterialInput {
  id?: string;
  code: string;
  name: string;
  unit: string;
  minQty: number;
  avgCostVnd: number;
  note?: string;
  active?: boolean;
}

export async function saveMaterial(actor: Actor, input: MaterialInput): Promise<Material> {
  assertAction(actor, 'material.manage');
  assertRule(input.code.trim().length >= 2, 'Vui lòng nhập mã vật tư (ít nhất 2 ký tự).');
  assertRule(input.name.trim().length >= 2, 'Vui lòng nhập tên vật tư.');
  assertRule(input.unit.trim().length >= 1, 'Vui lòng nhập đơn vị tính.');
  assertRule(input.avgCostVnd >= 0, 'Giá bình quân không được âm.');
  return db.transaction('rw', [db.materials, db.activityLogs], async () => {
    const now = nowIso();
    const existing = input.id ? await db.materials.get(input.id) : undefined;
    if (input.id && !existing) throw new NotFoundError('Không tìm thấy vật tư cần cập nhật.');
    const duplicated = await db.materials.where('code').equals(input.code.trim()).first();
    assertRule(!duplicated || duplicated.id === existing?.id, `Mã vật tư "${input.code.trim()}" đã tồn tại. Chọn mã khác.`, 'DUPLICATE_CODE');
    const record: Material = {
      id: existing?.id ?? newId(),
      code: input.code.trim(),
      name: input.name.trim(),
      searchName: toSearchName(`${input.code} ${input.name}`),
      unit: input.unit.trim(),
      stockQty: existing?.stockQty ?? 0,
      minQty: input.minQty,
      avgCostVnd: input.avgCostVnd,
      active: input.active ?? existing?.active ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      revision: (existing?.revision ?? 0) + 1,
    };
    await db.materials.put(record);
    await logActivity({
      entityType: 'MATERIAL',
      entityId: record.id,
      action: existing ? 'UPDATED' : 'CREATED',
      actor,
      summary: `${existing ? 'Cập nhật' : 'Thêm mới'} vật tư ${record.name} (${record.code})`,
    });
    return record;
  });
}

// ---------- Sản phẩm & BOM ----------

export interface BomStageInput {
  id?: string;
  name: string;
  teamId: string;
  pieceRateVnd: number;
  standardMinutes: number;
}

export interface BomMaterialInput {
  id?: string;
  materialId: string;
  quantityPerUnit: number;
  wastePct: number;
}

export interface ProductInput {
  id?: string;
  code: string;
  name: string;
  unit: string;
  salePriceVnd: number;
  note?: string;
  active?: boolean;
  stages: BomStageInput[];
  materials: BomMaterialInput[];
}

export interface ProductCostBreakdown {
  materialCostVnd: number;
  laborCostVnd: number;
  totalVnd: number;
  materialLines: Array<{ materialId: string; quantity: number; costVnd: number }>;
}

/** Giá thành sơ bộ 1 đơn vị = Σ định mức NVL × (1 + hao hụt) × giá bình quân + Σ đơn giá khoán công đoạn */
export function computeProductCost(
  stages: BomStage[],
  bomMaterials: BomMaterial[],
  materialById: Map<string, Material>,
): ProductCostBreakdown {
  const materialLines = bomMaterials.map((m) => {
    const material = materialById.get(m.materialId);
    const quantityNeeded = roundQty(m.quantityPerUnit * (1 + m.wastePct / 100), 4);
    return { materialId: m.materialId, quantity: quantityNeeded, costVnd: Math.round(quantityNeeded * (material?.avgCostVnd ?? 0)) };
  });
  const materialCostVnd = materialLines.reduce((s, l) => s + l.costVnd, 0);
  const laborCostVnd = stages.reduce((s, st) => s + st.pieceRateVnd, 0);
  return {
    materialCostVnd,
    laborCostVnd,
    totalVnd: materialCostVnd + laborCostVnd,
    materialLines,
  };
}

export async function saveProduct(actor: Actor, input: ProductInput): Promise<Product> {
  assertAction(actor, 'product.manage');
  assertRule(input.code.trim().length >= 2, 'Vui lòng nhập mã sản phẩm (ít nhất 2 ký tự).');
  assertRule(input.name.trim().length >= 2, 'Vui lòng nhập tên sản phẩm.');
  assertRule(input.salePriceVnd >= 0, 'Giá bán không được âm.');
  assertRule(input.stages.length > 0, 'Sản phẩm cần ít nhất một công đoạn để sản xuất.');
  assertRule(
    input.stages.every((s) => s.name.trim().length >= 2 && s.teamId && s.pieceRateVnd >= 0),
    'Mỗi công đoạn cần tên, tổ thực hiện và đơn giá khoán không âm.',
  );
  assertRule(
    input.materials.every((m) => m.materialId && m.quantityPerUnit > 0 && m.wastePct >= 0),
    'Mỗi dòng nguyên vật liệu cần chọn vật tư, định mức lớn hơn 0 và % hao hụt không âm.',
  );
  return db.transaction('rw', [db.products, db.bomStages, db.bomMaterials, db.activityLogs], async () => {
    const now = nowIso();
    const existing = input.id ? await db.products.get(input.id) : undefined;
    if (input.id && !existing) throw new NotFoundError('Không tìm thấy sản phẩm cần cập nhật.');
    const duplicated = await db.products.where('code').equals(input.code.trim()).first();
    assertRule(!duplicated || duplicated.id === existing?.id, `Mã sản phẩm "${input.code.trim()}" đã tồn tại. Chọn mã khác.`, 'DUPLICATE_CODE');

    const record: Product = {
      id: existing?.id ?? newId(),
      code: input.code.trim(),
      name: input.name.trim(),
      searchName: toSearchName(`${input.code} ${input.name}`),
      unit: input.unit.trim() || 'cái',
      salePriceVnd: input.salePriceVnd,
      note: input.note?.trim() || undefined,
      active: input.active ?? existing?.active ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      revision: (existing?.revision ?? 0) + 1,
    };
    await db.products.put(record);

    await db.bomStages.where('productId').equals(record.id).delete();
    await db.bomMaterials.where('productId').equals(record.id).delete();

    const stages: BomStage[] = input.stages.map((s, idx) => ({
      id: s.id ?? newId(),
      productId: record.id,
      seq: idx + 1,
      name: s.name.trim(),
      teamId: s.teamId,
      pieceRateVnd: Math.round(s.pieceRateVnd),
      standardMinutes: Math.round(s.standardMinutes),
    }));
    const materials: BomMaterial[] = input.materials.map((m) => ({
      id: m.id ?? newId(),
      productId: record.id,
      materialId: m.materialId,
      quantityPerUnit: roundQty(m.quantityPerUnit, 4),
      wastePct: roundQty(m.wastePct, 2),
    }));
    await db.bomStages.bulkAdd(stages);
    await db.bomMaterials.bulkAdd(materials);

    await logActivity({
      entityType: 'PRODUCT',
      entityId: record.id,
      action: existing ? 'BOM_UPDATED' : 'CREATED',
      actor,
      summary: `${existing ? 'Cập nhật BOM' : 'Thêm sản phẩm'} ${record.name} (${record.code}) — ${stages.length} công đoạn, ${materials.length} vật tư`,
    });
    return record;
  });
}

// ---------- Tổ sản xuất ----------

export interface TeamInput {
  id?: string;
  code: string;
  name: string;
  leaderId?: string;
  note?: string;
  active?: boolean;
}

export async function saveTeam(actor: Actor, input: TeamInput): Promise<Team> {
  assertAction(actor, 'team.manage');
  assertRule(input.code.trim().length >= 2, 'Vui lòng nhập mã tổ.');
  assertRule(input.name.trim().length >= 2, 'Vui lòng nhập tên tổ.');
  return db.transaction('rw', [db.teams, db.activityLogs], async () => {
    const now = nowIso();
    const existing = input.id ? await db.teams.get(input.id) : undefined;
    if (input.id && !existing) throw new NotFoundError('Không tìm thấy tổ cần cập nhật.');
    const duplicated = await db.teams.where('code').equals(input.code.trim()).first();
    assertRule(!duplicated || duplicated.id === existing?.id, `Mã tổ "${input.code.trim()}" đã tồn tại.`, 'DUPLICATE_CODE');
    const record: Team = {
      id: existing?.id ?? newId(),
      code: input.code.trim(),
      name: input.name.trim(),
      leaderId: input.leaderId || undefined,
      note: input.note?.trim() || undefined,
      active: input.active ?? existing?.active ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      revision: (existing?.revision ?? 0) + 1,
    };
    await db.teams.put(record);
    await logActivity({
      entityType: 'TEAM',
      entityId: record.id,
      action: existing ? 'UPDATED' : 'CREATED',
      actor,
      summary: `${existing ? 'Cập nhật' : 'Thêm mới'} tổ ${record.name} (${record.code})`,
    });
    return record;
  });
}

// ---------- Nhân viên ----------

export interface EmployeeInput {
  id?: string;
  code: string;
  name: string;
  role: RoleId;
  position: PositionId;
  teamId?: string;
  phone: string;
  active?: boolean;
}

export async function saveEmployee(actor: Actor, input: EmployeeInput): Promise<Employee> {
  assertAction(actor, 'employee.manage');
  assertRule(input.code.trim().length >= 2, 'Vui lòng nhập mã nhân viên.');
  assertRule(input.name.trim().length >= 2, 'Vui lòng nhập tên nhân viên.');
  assertRule(normalizePhone(input.phone).length >= 8, 'Số điện thoại cần ít nhất 8 chữ số.');
  return db.transaction('rw', [db.employees, db.activityLogs], async () => {
    const now = nowIso();
    const existing = input.id ? await db.employees.get(input.id) : undefined;
    if (input.id && !existing) throw new NotFoundError('Không tìm thấy nhân viên cần cập nhật.');
    const duplicated = await db.employees.where('code').equals(input.code.trim()).first();
    assertRule(!duplicated || duplicated.id === existing?.id, `Mã nhân viên "${input.code.trim()}" đã tồn tại.`, 'DUPLICATE_CODE');
    if (input.position === 'LEADER' || input.position === 'MAIN_WORKER' || input.position === 'HELPER') {
      assertRule(!!input.teamId, 'Nhân viên tổ sản xuất cần được gán vào một tổ.');
    }
    const record: Employee = {
      id: existing?.id ?? newId(),
      code: input.code.trim(),
      name: input.name.trim(),
      role: input.role,
      position: input.position,
      teamId: input.teamId || undefined,
      phone: input.phone.trim(),
      active: input.active ?? existing?.active ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      revision: (existing?.revision ?? 0) + 1,
    };
    await db.employees.put(record);
    await logActivity({
      entityType: 'EMPLOYEE',
      entityId: record.id,
      action: existing ? 'UPDATED' : 'CREATED',
      actor,
      summary: `${existing ? 'Cập nhật' : 'Thêm mới'} nhân viên ${record.name} (${record.code})`,
    });
    return record;
  });
}

export async function saveSupplier(
  actor: Actor,
  input: { id?: string; code: string; name: string; phone: string; address: string; active?: boolean },
): Promise<void> {
  assertAction(actor, 'material.manage');
  assertRule(input.name.trim().length >= 2, 'Vui lòng nhập tên nhà cung cấp.');
  await db.transaction('rw', [db.suppliers, db.activityLogs], async () => {
    const now = nowIso();
    const existing = input.id ? await db.suppliers.get(input.id) : undefined;
    if (input.id && !existing) throw new NotFoundError('Không tìm thấy nhà cung cấp.');
    const duplicated = await db.suppliers.where('code').equals(input.code.trim()).first();
    assertRule(!duplicated || duplicated.id === existing?.id, `Mã nhà cung cấp "${input.code.trim()}" đã tồn tại.`, 'DUPLICATE_CODE');
    const record = {
      id: existing?.id ?? newId(),
      code: input.code.trim(),
      name: input.name.trim(),
      phone: input.phone.trim(),
      address: input.address.trim(),
      active: input.active ?? existing?.active ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      revision: (existing?.revision ?? 0) + 1,
    };
    await db.suppliers.put(record);
    await logActivity({
      entityType: 'SUPPLIER',
      entityId: record.id,
      action: existing ? 'UPDATED' : 'CREATED',
      actor,
      summary: `${existing ? 'Cập nhật' : 'Thêm mới'} nhà cung cấp ${record.name}`,
    });
  });
}
