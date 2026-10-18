/** Chuẩn hóa chuỗi tiếng Việt để tìm kiếm không dấu */
export function toSearchName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePhone(input?: string): string {
  return (input ?? '').replace(/[^\d]/g, '');
}

export function maskPhone(input?: string): string {
  const digits = normalizePhone(input);
  if (digits.length < 7) return input ?? '—';
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
}

/** Viết hoa chữ đầu để hiển thị tên tổ/nhân viên gọn gàng */
export function titleCase(input: string): string {
  return input
    .split(' ')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}
