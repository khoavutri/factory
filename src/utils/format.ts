import dayjs from 'dayjs';

export const DATE_FORMAT = 'DD/MM/YYYY';
export const DATETIME_FORMAT = 'DD/MM/YYYY HH:mm';
export const TIME_FORMAT = 'HH:mm';
export const DATE_KEY_FORMAT = 'YYYY-MM-DD';
export const MONTH_KEY_FORMAT = 'YYYY-MM';

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayKey(): string {
  return dayjs().format(DATE_KEY_FORMAT);
}

export function toDateKey(value: string | Date | dayjs.Dayjs): string {
  return dayjs(value).format(DATE_KEY_FORMAT);
}

export function toMonthKey(value: string | Date | dayjs.Dayjs): string {
  return dayjs(value).format(MONTH_KEY_FORMAT);
}

export function formatDate(value?: string | Date | null): string {
  if (!value) return '—';
  const d = dayjs(value);
  return d.isValid() ? d.format(DATE_FORMAT) : '—';
}

export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const d = dayjs(value);
  return d.isValid() ? d.format(DATETIME_FORMAT) : '—';
}

export function formatTime(value?: string | null): string {
  if (!value) return '—';
  const d = dayjs(value);
  return d.isValid() ? d.format(TIME_FORMAT) : '—';
}

/** Khoảng [đầu ngày, cuối ngày] của một ngày (theo giờ local) */
export function dayRange(date: string | Date | dayjs.Dayjs): [string, string] {
  const d = dayjs(date);
  return [d.startOf('day').toISOString(), d.endOf('day').toISOString()];
}

export function startOfDayIso(date: string | Date | dayjs.Dayjs): string {
  return dayjs(date).startOf('day').toISOString();
}

export function endOfDayIso(date: string | Date | dayjs.Dayjs): string {
  return dayjs(date).endOf('day').toISOString();
}

/** Khoảng ngày của kỳ tháng dạng YYYY-MM */
export function monthRange(monthKey: string): { from: string; to: string; label: string } {
  const start = dayjs(`${monthKey}-01`);
  const valid = start.isValid() ? start : dayjs();
  return {
    from: valid.startOf('month').toISOString(),
    to: valid.endOf('month').toISOString(),
    label: `Tháng ${valid.format('MM/YYYY')}`,
  };
}

/** Định dạng thời lượng từ số phút */
export function formatMinutes(minutes?: number | null): string {
  if (minutes == null) return '—';
  if (minutes < 60) return `${minutes} phút`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

export function isOverdue(value?: string | null, ref: dayjs.Dayjs = dayjs()): boolean {
  if (!value) return false;
  return dayjs(value).isBefore(ref);
}

export function isSameDay(a?: string | null, b?: string | Date): boolean {
  if (!a) return false;
  return dayjs(a).isSame(dayjs(b), 'day');
}

/** Số ngày còn lại (âm là quá hạn) tính đến hết ngày hạn */
export function daysUntil(value?: string | null): number | null {
  if (!value) return null;
  const d = dayjs(value);
  if (!d.isValid()) return null;
  return d.startOf('day').diff(dayjs().startOf('day'), 'day');
}

/** Số ngày chênh lệch giữa hai mốc (dùng tính lead time) */
export function diffDays(from?: string | null, to?: string | null): number | null {
  if (!from || !to) return null;
  const a = dayjs(from);
  const b = dayjs(to);
  if (!a.isValid() || !b.isValid()) return null;
  return b.diff(a, 'day', true);
}

export function formatBytes(bytes?: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
