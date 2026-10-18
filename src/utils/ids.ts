/** Sinh ID duy nhất cho bản ghi */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Mã thao tác chống ghi trùng (operationId) */
export function newOperationId(): string {
  return `op-${newId()}`;
}

/** Khóa kết hợp cho bảng tổng hợp */
export function compositeKey(...parts: Array<string | number>): string {
  return parts.join('::');
}

/** Sinh khóa ổn định cho bản ghi mẫu */
export function slugId(prefix: string, index: number, pad = 3): string {
  return `${prefix}-${String(index).padStart(pad, '0')}`;
}
