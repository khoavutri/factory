import { useMemo, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Divider, Empty, Input, InputNumber, Modal, Progress, Space, Table, Tag, Timeline, Tooltip, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { ArrowLeftOutlined, CheckOutlined, CloseCircleOutlined, PrinterOutlined, SendOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import { PrintPreview } from '../../components/PrintPreview';
import { PrintLetterhead } from '../../components/PrintLetterhead';
import { useRole } from '../../app/RoleContext';
import { useAction } from '../../hooks/useAction';
import { db } from '../../db/database';
import { getSalesOrderRow } from '../../repositories/lists';
import { approveSalesOrder, cancelSalesOrder, deliverSalesOrder } from '../../services/salesOrders';
import { formatDate, formatDateTime } from '../../utils/format';
import { formatMoney, formatQuantity } from '../../utils/money';
import type { ActivityLog, Delivery, SalesOrderItem } from '../../types';
import { OrderPrintBody } from './OrderPrintBody';

interface DeliveryDraftLine {
  itemId: string;
  quantity: number;
}

export function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { actor, role } = useRole();
  const { message } = App.useApp();
  const { loading, run } = useAction();
  const [printOpen, setPrintOpen] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [deliverLines, setDeliverLines] = useState<DeliveryDraftLine[]>([]);
  const [receivedBy, setReceivedBy] = useState('');
  const [deliverNote, setDeliverNote] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [printDeliveryId, setPrintDeliveryId] = useState<string | null>(null);

  const row = useLiveQuery(() => (orderId ? getSalesOrderRow(orderId) : Promise.resolve(undefined)), [orderId]);
  const productStock = useLiveQuery(() => db.productStock.toArray(), []);
  const products = useLiveQuery(() => db.products.toArray(), []);
  const deliveries = useLiveQuery(
    () => (orderId ? db.deliveries.where('salesOrderId').equals(orderId).toArray() : Promise.resolve<Delivery[]>([])),
    [orderId],
  );
  const deliveryItems = useLiveQuery(() => db.deliveryItems.toArray(), []);
  const activities = useLiveQuery(
    () => (orderId ? db.activityLogs.where('[entityType+entityId]').equals(['SALES_ORDER', orderId]).toArray() : Promise.resolve<ActivityLog[]>([])),
    [orderId],
  );

  const stockByProduct = useMemo(() => new Map((productStock ?? []).map((s) => [s.productId, s.quantity])), [productStock]);
  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

  if (!row) {
    return <Card loading />;
  }

  const canApprove = role === 'MANAGER' || role === 'PLANNER';
  const canDeliver = role === 'MANAGER' || role === 'STOREKEEPER';
  const canCancel = role === 'MANAGER' || role === 'PLANNER';

  const openDeliverModal = () => {
    setDeliverLines(
      row.items
        .map((item) => ({
          itemId: item.id,
          quantity: Math.max(0, Math.min(item.quantity - item.deliveredQty, stockByProduct.get(item.productId) ?? 0)),
        }))
        .filter((l) => l.quantity > 0),
    );
    setReceivedBy('');
    setDeliverNote('');
    setDeliverOpen(true);
  };

  const submitDelivery = async () => {
    const lines = deliverLines.filter((l) => l.quantity > 0);
    if (lines.length === 0) {
      message.warning('Chưa chọn dòng thành phẩm nào để giao.');
      return;
    }
    const delivery = await run((op) => deliverSalesOrder(actor, row.order.id, lines, { receivedBy, note: deliverNote, operationId: op }), {
      successMessage: 'Đã lập phiếu giao hàng',
    });
    if (delivery) {
      setDeliverOpen(false);
    }
  };

  const itemColumns: TableColumnsType<SalesOrderItem> = [
    {
      title: 'Sản phẩm',
      key: 'product',
      render: (_, item) => (
        <Space orientation="vertical" size={0}>
          <span className="text-strong">{productById.get(item.productId)?.name ?? '—'}</span>
          <span className="text-muted">{productById.get(item.productId)?.code ?? '—'}</span>
        </Space>
      ),
    },
    { title: 'ĐVT', key: 'unit', width: 70, render: (_, item) => productById.get(item.productId)?.unit ?? '—' },
    { title: 'Số lượng', key: 'qty', width: 100, align: 'right', render: (_, item) => formatQuantity(item.quantity) },
    { title: 'Đơn giá', key: 'price', width: 130, align: 'right', render: (_, item) => <MoneyDisplay value={item.unitPriceVnd} /> },
    { title: 'Thành tiền', key: 'amount', width: 140, align: 'right', render: (_, item) => <MoneyDisplay value={item.quantity * item.unitPriceVnd} strong /> },
    {
      title: 'Đã giao',
      key: 'delivered',
      width: 130,
      align: 'right',
      render: (_, item) => (
        <span style={item.deliveredQty >= item.quantity ? { color: '#2f9e44', fontWeight: 600 } : undefined}>
          {formatQuantity(item.deliveredQty)}/{formatQuantity(item.quantity)}
        </span>
      ),
    },
    {
      title: 'Tồn thành phẩm',
      key: 'stock',
      width: 130,
      align: 'right',
      render: (_, item) => {
        const stock = stockByProduct.get(item.productId) ?? 0;
        const missing = Math.max(0, item.quantity - item.deliveredQty - stock);
        return missing > 0 ? (
          <Tooltip title={`Còn thiếu ${formatQuantity(missing)} để đủ hàng giao`}>
            <span style={{ color: '#e8930c', fontWeight: 600 }}>{formatQuantity(stock)} (thiếu {formatQuantity(missing)})</span>
          </Tooltip>
        ) : (
          <span>{formatQuantity(stock)}</span>
        );
      },
    },
  ];

  const deliveredValue = row.items.reduce((s, i) => s + i.deliveredQty * i.unitPriceVnd, 0);

  return (
    <div>
      <PageHeader
        title={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/orders')} />
            Đơn hàng {row.order.code}
            <StatusTag kind="order" status={row.order.status} />
            {row.overdue ? <Tag color="red">Trễ hạn</Tag> : null}
          </Space>
        }
        subtitle={`${row.customer?.name ?? '—'} · ${row.customer?.phone ?? '—'}`}
        extra={[
          <Button key="print" icon={<PrinterOutlined />} onClick={() => setPrintOpen(true)}>
            In đơn hàng
          </Button>,
          canApprove && row.order.status === 'NEW' ? (
            <Button
              key="approve"
              type="primary"
              icon={<CheckOutlined />}
              loading={loading}
              onClick={async () => {
                const created = await run((op) => approveSalesOrder(actor, row.order.id, { operationId: op }), {
                  successMessage: 'Đã duyệt đơn và sinh lệnh sản xuất theo BOM',
                });
                if (created && created.length > 0) navigate(`/work-orders/${created[0].id}`);
              }}
            >
              Duyệt đơn
            </Button>
          ) : null,
          canDeliver && (row.order.status === 'IN_PROGRESS' || row.order.status === 'READY') ? (
            <Button key="deliver" type="primary" icon={<SendOutlined />} onClick={openDeliverModal}>
              Giao hàng
            </Button>
          ) : null,
          canCancel && (row.order.status === 'NEW' || row.order.status === 'APPROVED') ? (
            <Button key="cancel" danger icon={<CloseCircleOutlined />} onClick={() => setCancelOpen(true)}>
              Huỷ đơn
            </Button>
          ) : null,
        ]}
      />

      {row.order.status === 'CANCELLED' ? (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} title={`Đơn đã huỷ: ${row.order.cancelReason ?? '—'}`} />
      ) : null}

      <Card size="small" style={{ marginBottom: 14 }}>
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
          <Descriptions.Item label="Khách hàng">{row.customer?.name ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Hạn giao">
            <span style={row.overdue ? { color: '#d64545', fontWeight: 600 } : undefined}>{formatDate(row.order.dueDate)}</span>
          </Descriptions.Item>
          <Descriptions.Item label="Giá trị đơn">
            <MoneyDisplay value={row.order.totalVnd} strong />
          </Descriptions.Item>
          <Descriptions.Item label="Đã giao / giá trị">
            {formatMoney(deliveredValue)} ({Math.round((deliveredValue / Math.max(1, row.order.totalVnd)) * 100)}%)
          </Descriptions.Item>
          <Descriptions.Item label="Tạo lúc">{formatDateTime(row.order.createdAt)}</Descriptions.Item>
          <Descriptions.Item label="Duyệt lúc">{formatDateTime(row.order.approvedAt)}</Descriptions.Item>
          <Descriptions.Item label="Tiến độ">{row.progressPct}%</Descriptions.Item>
          <Descriptions.Item label="Lệnh sản xuất">{row.workOrders.length}</Descriptions.Item>
        </Descriptions>
        {row.order.note ? (
          <div className="text-muted" style={{ marginTop: 6 }}>
            Ghi chú: {row.order.note}
          </div>
        ) : null}
        <Divider style={{ margin: '10px 0' }} />
        <Progress percent={row.progressPct} status={row.overdue ? 'exception' : 'normal'} />
      </Card>

      <Card size="small" title="Mặt hàng trong đơn" style={{ marginBottom: 14 }}>
        <Table<SalesOrderItem> rowKey="id" columns={itemColumns} dataSource={row.items} pagination={false} size="middle" scroll={{ x: 1050 }} />
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
        <Card size="small" title={`Lệnh sản xuất đã sinh (${row.workOrders.length})`}>
          {row.workOrders.length === 0 ? (
            <Alert
              type="info"
              showIcon
              title="Đơn chưa sinh lệnh sản xuất"
              description="Bấm Duyệt đơn để sinh lệnh sản xuất cho từng dòng sản phẩm. Lệnh sẽ sao chép công đoạn và định mức nguyên vật liệu từ BOM tại thời điểm duyệt."
            />
          ) : (
            <Table
              rowKey={(w) => w.id}
              size="small"
              pagination={false}
              dataSource={row.workOrders}
              columns={[
                { title: 'Mã lệnh', dataIndex: 'code', key: 'code', width: 180, render: (code: string, w) => <a onClick={() => navigate(`/work-orders/${w.id}`)}>{code}</a> },
                { title: 'Sản phẩm', key: 'product', render: (_, w) => productById.get(w.productId)?.name ?? '—' },
                { title: 'SL', dataIndex: 'quantity', key: 'qty', width: 80, align: 'right' },
                { title: 'Trạng thái', key: 'status', width: 140, render: (_, w) => <StatusTag kind="workOrder" status={w.status} /> },
                { title: 'Ưu tiên', key: 'priority', width: 110, render: (_, w) => <StatusTag kind="priority" status={w.priority} /> },
                { title: 'Làm lại', key: 'rework', width: 90, align: 'center', render: (_, w) => (w.reworkCount > 0 ? <Tag color="red">{w.reworkCount}</Tag> : 0) },
              ]}
            />
          )}
        </Card>

        <div>
          <Card size="small" title={`Phiếu giao hàng (${(deliveries ?? []).length})`} style={{ marginBottom: 14 }}>
            {(deliveries ?? []).length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có phiếu giao hàng" />
            ) : (
              (deliveries ?? []).map((delivery) => (
                <div key={delivery.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderBottom: '1px dashed #edf1f6', padding: '6px 0' }}>
                  <div>
                    <div className="text-strong">{delivery.code}</div>
                    <div className="text-muted">
                      {formatDateTime(delivery.deliveredAt ?? delivery.createdAt)} · {formatMoney(delivery.totalVnd)}
                      {delivery.receivedBy ? ` · nhận bởi ${delivery.receivedBy}` : ''}
                    </div>
                  </div>
                  <Button size="small" icon={<PrinterOutlined />} onClick={() => setPrintDeliveryId(delivery.id)}>
                    In phiếu
                  </Button>
                </div>
              ))
            )}
          </Card>

          <Card size="small" title="Nhật ký đơn hàng">
            {(activities ?? []).length === 0 ? (
              <Typography.Text type="secondary">Chưa có hoạt động nào.</Typography.Text>
            ) : (
              <Timeline
                items={[...(activities ?? [])]
                  .sort((a, b) => b.at.localeCompare(a.at))
                  .map((log) => ({
                    color: log.action === 'CANCELLED' ? 'red' : log.action === 'DELIVERED' ? 'green' : 'blue',
                    content: (
                      <div>
                        <div>{log.summary}</div>
                        <div className="text-muted">
                          {formatDateTime(log.at)}
                          {log.actorName ? ` · ${log.actorName}` : ''}
                        </div>
                      </div>
                    ),
                  }))}
              />
            )}
          </Card>
        </div>
      </div>

      <Modal
        title={`Giao hàng cho đơn ${row.order.code}`}
        open={deliverOpen}
        onCancel={() => setDeliverOpen(false)}
        onOk={() => void submitDelivery()}
        okText="Lập phiếu giao hàng"
        cancelText="Đóng"
        confirmLoading={loading}
        width={720}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title="Phiếu giao hàng sẽ trừ tồn thành phẩm ngay khi lập. Dòng không đủ tồn sẽ bị chặn kèm số lượng còn thiếu."
        />
        <Table
          rowKey="itemId"
          size="small"
          pagination={false}
          dataSource={row.items.map((item) => ({
            itemId: item.id,
            productId: item.productId,
            quantity: item.quantity,
            deliveredQty: item.deliveredQty,
            stock: stockByProduct.get(item.productId) ?? 0,
          }))}
          columns={[
            { title: 'Sản phẩm', key: 'product', render: (_, r) => productById.get(r.productId)?.name ?? '—' },
            { title: 'Đặt', dataIndex: 'quantity', key: 'qty', width: 70, align: 'right' },
            { title: 'Đã giao', dataIndex: 'deliveredQty', key: 'delivered', width: 80, align: 'right' },
            { title: 'Tồn TP', dataIndex: 'stock', key: 'stock', width: 80, align: 'right' },
            {
              title: 'SL giao lần này',
              key: 'deliver',
              width: 160,
              render: (_, r) => {
                const remaining = Math.max(0, r.quantity - r.deliveredQty);
                const draft = deliverLines.find((l) => l.itemId === r.itemId);
                return (
                  <InputNumber
                    min={0}
                    max={Math.min(remaining, r.stock)}
                    value={draft?.quantity ?? 0}
                    disabled={remaining <= 0 || r.stock <= 0}
                    onChange={(value) => {
                      const next = Number(value ?? 0);
                      setDeliverLines((prev) => {
                        const others = prev.filter((l) => l.itemId !== r.itemId);
                        return next > 0 ? [...others, { itemId: r.itemId, quantity: next }] : others;
                      });
                    }}
                  />
                );
              },
            },
            {
              title: 'Còn thiếu',
              key: 'missing',
              width: 110,
              align: 'right',
              render: (_, r) => {
                const missing = Math.max(0, r.quantity - r.deliveredQty - r.stock);
                return missing > 0 ? <Tag color="orange">Thiếu {formatQuantity(missing)}</Tag> : <Tag color="green">Đủ</Tag>;
              },
            },
          ]}
        />
        <Space orientation="vertical" style={{ width: '100%', marginTop: 12 }}>
          <Input placeholder="Người nhận hàng (họ tên, đơn vị)" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
          <Input placeholder="Ghi chú giao hàng" value={deliverNote} onChange={(e) => setDeliverNote(e.target.value)} />
        </Space>
      </Modal>

      <Modal
        title={`Huỷ đơn ${row.order.code}`}
        open={cancelOpen}
        onCancel={() => setCancelOpen(false)}
        onOk={async () => {
          const cancelled = await run((op) => cancelSalesOrder(actor, row.order.id, cancelReason, { operationId: op }), {
            successMessage: 'Đã huỷ đơn hàng',
          });
          if (cancelled) {
            setCancelOpen(false);
            setCancelReason('');
          }
        }}
        okText="Huỷ đơn"
        okButtonProps={{ danger: true }}
        cancelText="Đóng"
        confirmLoading={loading}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          Chỉ huỷ được đơn ở trạng thái Mới hoặc Đã duyệt. Nếu đơn đã sinh lệnh sản xuất chưa chạy, hệ thống huỷ luôn các lệnh đó.
        </Typography.Paragraph>
        <Input.TextArea rows={3} placeholder="Lý do huỷ (ít nhất 5 ký tự)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
      </Modal>

      <PrintPreview open={printOpen} onClose={() => setPrintOpen(false)} title={`Đơn hàng ${row.order.code}`}>
        <OrderPrintBody row={row} />
      </PrintPreview>

      <PrintPreview
        open={!!printDeliveryId}
        onClose={() => setPrintDeliveryId(null)}
        title={`Phiếu giao hàng ${(deliveries ?? []).find((d) => d.id === printDeliveryId)?.code ?? ''}`}
        printLabel="In phiếu giao hàng"
      >
        {(() => {
          const delivery = (deliveries ?? []).find((d) => d.id === printDeliveryId);
          if (!delivery) return null;
          const lines = (deliveryItems ?? []).filter((i) => i.deliveryId === delivery.id);
          return (
            <>
              <PrintLetterhead
                title="Phiếu giao hàng"
                right={
                  <>
                    <div>
                      <strong>Số: {delivery.code}</strong>
                    </div>
                    <div>Ngày giao: {formatDate(delivery.deliveredAt ?? delivery.createdAt)}</div>
                  </>
                }
              />
              <div style={{ marginBottom: 8 }}>
                <div>
                  <strong>Đơn hàng:</strong> {row.order.code}
                </div>
                <div>
                  <strong>Khách hàng:</strong> {row.customer?.name ?? '—'} · {row.customer?.phone ?? '—'}
                </div>
                <div>
                  <strong>Địa chỉ giao:</strong> {row.customer?.address ?? '—'}
                </div>
                {delivery.note ? (
                  <div>
                    <strong>Ghi chú:</strong> {delivery.note}
                  </div>
                ) : null}
              </div>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>TT</th>
                    <th>Sản phẩm</th>
                    <th style={{ width: 60 }}>ĐVT</th>
                    <th style={{ width: 90 }} className="amount">
                      Số lượng
                    </th>
                    <th style={{ width: 120 }} className="amount">
                      Đơn giá
                    </th>
                    <th style={{ width: 130 }} className="amount">
                      Thành tiền
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={line.id}>
                      <td>{idx + 1}</td>
                      <td>{line.productNameSnapshot}</td>
                      <td>{line.unitSnapshot}</td>
                      <td className="amount">{formatQuantity(line.quantity)}</td>
                      <td className="amount">{formatMoney(line.unitPriceVnd)}</td>
                      <td className="amount">{formatMoney(line.quantity * line.unitPriceVnd)}</td>
                    </tr>
                  ))}
                  <tr>
                    <th colSpan={5}>Tổng cộng</th>
                    <th className="amount">{formatMoney(delivery.totalVnd)}</th>
                  </tr>
                </tbody>
              </table>
              <div style={{ fontSize: 12.5 }}>
                Hàng hoá đã được kiểm tra chất lượng trước khi giao. Quý khách vui lòng kiểm đủ số lượng và tình trạng hàng hoá khi nhận.
              </div>
              <div className="print-signatures">
                <div>
                  <strong>Người giao hàng</strong>
                  <div style={{ height: 56 }} />
                  <div>Bùi Thị Oanh</div>
                </div>
                <div>
                  <strong>Người nhận hàng</strong>
                  <div style={{ height: 56 }} />
                  <div>{delivery.receivedBy ?? ''}</div>
                </div>
                <div>
                  <strong>Giám đốc xưởng</strong>
                  <div style={{ height: 56 }} />
                </div>
              </div>
            </>
          );
        })()}
      </PrintPreview>
    </div>
  );
}
