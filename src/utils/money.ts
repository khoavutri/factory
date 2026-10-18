/** Tiện ích tiền VND: làm tròn số nguyên, định dạng hiển thị, đọc dữ liệu nhập */

export function roundVnd(value: number): number {
  return Math.round(value);
}

/** Giá trị một dòng = SL × đơn giá (làm tròn VND) */
export function lineAmountVnd(quantity: number, unitPriceVnd: number): number {
  return roundVnd(quantity * unitPriceVnd);
}

export function sumVnd(values: number[]): number {
  return values.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
}

export function formatMoney(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(Math.round(value));
  return `${sign}${abs.toLocaleString('vi-VN')} ₫`;
}

export function formatMoneyShort(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tỷ`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
  if (abs >= 1_000) return `${(value / 1_000).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} nghìn`;
  return formatMoney(value);
}

/** Đọc chuỗi người dùng nhập (có thể chứa dấu chấm, phẩy) thành số VND */
export function parseMoneyInput(input?: string | number | null): number | undefined {
  if (input == null || input === '') return undefined;
  if (typeof input === 'number') return Math.round(input);
  const cleaned = input.replace(/[^\d-]/g, '');
  if (!cleaned || cleaned === '-') return undefined;
  const n = Number(cleaned);
  return Number.isNaN(n) ? undefined : Math.round(n);
}

export function formatQuantity(value?: number | null, maxFractionDigits = 3): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('vi-VN', { maximumFractionDigits: maxFractionDigits });
}

/** Làm tròn số lượng theo 3 chữ số thập phân để tránh sai số cộng dồn */
export function roundQty(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Giá bình quân gia quyền sau khi nhập thêm */
export function weightedAverageCost(currentQty: number, currentAvg: number, inQty: number, inCost: number): number {
  const totalQty = currentQty + inQty;
  if (totalQty <= 0) return inCost;
  return Math.round(((currentQty * currentAvg + inQty * inCost) / totalQty) * 100) / 100;
}
