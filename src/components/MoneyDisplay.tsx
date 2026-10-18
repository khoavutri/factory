import { formatMoney } from '../utils/money';

export function MoneyDisplay({ value, strong, muted }: { value?: number | null; strong?: boolean; muted?: boolean }) {
  if (value == null) return <span className="text-muted">—</span>;
  return (
    <span className={[strong ? 'text-strong' : '', muted ? 'text-muted' : '', 'nowrap'].filter(Boolean).join(' ')}>
      {formatMoney(value)}
    </span>
  );
}
