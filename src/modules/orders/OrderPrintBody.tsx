import { useLiveQuery } from 'dexie-react-hooks';
import { PrintLetterhead } from '../../components/PrintLetterhead';
import { db } from '../../db/database';
import type { SalesOrderRow } from '../../repositories/lists';
import { formatDate } from '../../utils/format';
import { formatMoney, formatQuantity } from '../../utils/money';
import { ORDER_STATUS_META } from '../../utils/status';
import { DEFAULT_WORKSHOP_INFO, getSetting, SETTING_KEYS, type WorkshopInfo } from '../../services/settings';

/** Mẫu in đơn hàng A4 (dạng báo giá/xác nhận đơn) */
export function OrderPrintBody({ row }: { row: SalesOrderRow }) {
  const workshop = useLiveQuery(() => getSetting<WorkshopInfo>(SETTING_KEYS.WORKSHOP_INFO, DEFAULT_WORKSHOP_INFO), [], DEFAULT_WORKSHOP_INFO);
  const products = useLiveQuery(() => db.products.toArray(), []);
  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const total = row.items.reduce((s, i) => s + i.quantity * i.unitPriceVnd, 0);

  return (
    <>
      <PrintLetterhead
        title="Đơn hàng / Xác nhận đặt hàng"
        right={
          <>
            <div>
              <strong>Số: {row.order.code}</strong>
            </div>
            <div>Ngày lập: {formatDate(row.order.createdAt)}</div>
            <div>Hạn giao: {formatDate(row.order.dueDate)}</div>
          </>
        }
      />
      <div style={{ marginBottom: 8 }}>
        <div>
          <strong>Khách hàng:</strong> {row.customer?.name ?? '—'}
        </div>
        <div>
          <strong>Điện thoại:</strong> {row.customer?.phone ?? '—'}
        </div>
        <div>
          <strong>Địa chỉ:</strong> {row.customer?.address ?? '—'}
        </div>
        <div>
          <strong>Trạng thái:</strong> {ORDER_STATUS_META[row.order.status].label}
          {row.order.note ? ` · Ghi chú: ${row.order.note}` : ''}
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 40 }}>TT</th>
            <th>Sản phẩm</th>
            <th style={{ width: 60 }}>ĐVT</th>
            <th style={{ width: 80 }} className="amount">
              Số lượng
            </th>
            <th style={{ width: 110 }} className="amount">
              Đơn giá
            </th>
            <th style={{ width: 120 }} className="amount">
              Thành tiền
            </th>
          </tr>
        </thead>
        <tbody>
          {row.items.map((item, idx) => {
            const product = productById.get(item.productId);
            return (
              <tr key={item.id}>
                <td>{idx + 1}</td>
                <td>
                  {product?.name ?? '—'} ({product?.code ?? '—'})
                </td>
                <td>{product?.unit ?? '—'}</td>
                <td className="amount">{formatQuantity(item.quantity)}</td>
                <td className="amount">{formatMoney(item.unitPriceVnd)}</td>
                <td className="amount">{formatMoney(item.quantity * item.unitPriceVnd)}</td>
              </tr>
            );
          })}
          <tr>
            <th colSpan={5}>Tổng cộng</th>
            <th className="amount">{formatMoney(total)}</th>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 12.5 }}>
        Đơn hàng được sản xuất theo tiêu chuẩn kỹ thuật của xưởng. Thời gian giao hàng có thể thay đổi nếu phát sinh yêu cầu kỹ thuật; xưởng sẽ thông
        báo trước cho quý khách.
      </div>
      <div className="print-signatures">
        <div>
          <strong>Người lập đơn</strong>
          <div style={{ height: 56 }} />
          <div>{workshop.representative}</div>
        </div>
        <div>
          <strong>Khách hàng xác nhận</strong>
          <div style={{ height: 56 }} />
          <div>{row.customer?.name ?? ''}</div>
        </div>
        <div>
          <strong>Giám đốc xưởng</strong>
          <div style={{ height: 56 }} />
          <div>{workshop.representative}</div>
        </div>
      </div>
    </>
  );
}
