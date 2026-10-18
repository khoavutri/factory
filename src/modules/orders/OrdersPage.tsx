import { useMemo, useState } from 'react';
import { App, Button, DatePicker, Drawer, Empty, Form, Input, InputNumber, Progress, Select, Space, Table, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { PlusOutlined, PrinterOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import dayjs, { type Dayjs } from 'dayjs';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import { PrintPreview } from '../../components/PrintPreview';
import { useRole } from '../../app/RoleContext';
import { useAction } from '../../hooks/useAction';
import { useUrlState } from '../../hooks/useUrlState';
import { db } from '../../db/database';
import { listSalesOrderRows, type SalesOrderRow } from '../../repositories/lists';
import { createSalesOrder, type SalesOrderLineInput } from '../../services/salesOrders';
import { saveCustomer } from '../../services/catalog';
import { DATE_FORMAT, formatDate, formatDateTime } from '../../utils/format';
import { formatMoney, formatQuantity, parseMoneyInput } from '../../utils/money';
import { ORDER_STATUS_META } from '../../utils/status';
import type { SalesOrderStatus } from '../../types';
import { OrderPrintBody } from './OrderPrintBody';

interface LineDraft {
  key: string;
  productId?: string;
  quantity: number;
  unitPriceVnd?: number;
}

export function OrdersPage() {
  const navigate = useNavigate();
  const { actor, role } = useRole();
  const { message } = App.useApp();
  const { loading, run } = useAction();
  const [filters, setFilters] = useUrlState<{ status?: string; from?: string; to?: string; q?: string }>({});
  const [keyword, setKeyword] = useState(filters.q ?? '');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [printOrderId, setPrintOrderId] = useState<string | null>(null);
  const [form] = Form.useForm<{ customerId: string; dueDate: Dayjs; note?: string }>();
  const [lines, setLines] = useState<LineDraft[]>([{ key: '1', quantity: 1 }]);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerForm] = Form.useForm<{ name: string; phone: string; address?: string }>();

  const rows = useLiveQuery(() => listSalesOrderRows(), []);
  const customers = useLiveQuery(() => db.customers.filter((c) => c.active).toArray(), []);
  const products = useLiveQuery(() => db.products.filter((p) => p.active).toArray(), []);

  const canCreate = role === 'MANAGER' || role === 'PLANNER';

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const key = keyword.trim().toLowerCase();
    return list.filter((row) => {
      if (filters.status && row.order.status !== filters.status) return false;
      if (filters.from && dayjs(row.order.dueDate).isBefore(dayjs(filters.from), 'day')) return false;
      if (filters.to && dayjs(row.order.dueDate).isAfter(dayjs(filters.to), 'day')) return false;
      if (key) {
        const haystack = `${row.order.code} ${row.customer?.name ?? ''} ${row.productNames}`.toLowerCase();
        if (!haystack.includes(key)) return false;
      }
      return true;
    });
  }, [rows, filters.status, filters.from, filters.to, keyword]);

  const printRow = (rows ?? []).find((r) => r.order.id === printOrderId);

  const columns: TableColumnsType<SalesOrderRow> = [
    {
      title: 'Mã đơn',
      key: 'code',
      width: 170,
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <a className="text-strong" onClick={() => navigate(`/orders/${row.order.id}`)}>
            {row.order.code}
          </a>
          <span className="text-muted">{formatDateTime(row.order.createdAt)}</span>
        </Space>
      ),
    },
    { title: 'Khách hàng', key: 'customer', render: (_, row) => row.customer?.name ?? '—' },
    {
      title: 'Mặt hàng',
      key: 'products',
      ellipsis: true,
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <span>{row.productNames}</span>
          <span className="text-muted">
            {row.itemCount} mặt hàng · tổng SL {formatQuantity(row.totalQty)}
          </span>
        </Space>
      ),
    },
    { title: 'Giá trị', key: 'total', width: 150, align: 'right', render: (_, row) => <MoneyDisplay value={row.order.totalVnd} strong /> },
    {
      title: 'Hạn giao',
      key: 'due',
      width: 130,
      render: (_, row) => (
        <span style={row.overdue ? { color: '#d64545', fontWeight: 600 } : undefined}>
          {formatDate(row.order.dueDate)}
          {row.overdue ? ' (trễ)' : ''}
        </span>
      ),
    },
    { title: 'Trạng thái', key: 'status', width: 130, render: (_, row) => <StatusTag kind="order" status={row.order.status} /> },
    {
      title: 'Tiến độ',
      key: 'progress',
      width: 170,
      render: (_, row) => (
        <Space orientation="vertical" size={0} style={{ width: '100%' }}>
          <Progress percent={row.progressPct} size="small" status={row.overdue ? 'exception' : 'normal'} />
          <span className="text-muted">
            {row.workOrders.filter((w) => w.status === 'DONE').length}/{row.workOrders.length} lệnh xong
          </span>
        </Space>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 120,
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => navigate(`/orders/${row.order.id}`)}>
            Mở
          </Button>
          <Button size="small" icon={<PrinterOutlined />} onClick={() => setPrintOrderId(row.order.id)} />
        </Space>
      ),
    },
  ];

  const submitCustomer = async () => {
    const values = await customerForm.validateFields();
    const saved = await run(() => saveCustomer(actor, values), { successMessage: 'Đã thêm khách hàng' });
    if (saved) {
      setCustomerModalOpen(false);
      customerForm.resetFields();
      form.setFieldValue('customerId', saved.id);
    }
  };

  const submitOrder = async () => {
    const values = await form.validateFields();
    const payload: SalesOrderLineInput[] = lines
      .filter((l) => l.productId && l.quantity > 0)
      .map((l) => ({ productId: l.productId!, quantity: l.quantity, unitPriceVnd: l.unitPriceVnd ?? 0 }));
    if (payload.length === 0) {
      message.warning('Đơn hàng cần ít nhất một dòng sản phẩm hợp lệ (chọn sản phẩm và số lượng).');
      return;
    }
    const created = await run(
      (op) =>
        createSalesOrder(
          actor,
          { customerId: values.customerId, dueDate: values.dueDate.endOf('day').toISOString(), note: values.note, lines: payload },
          { operationId: op },
        ),
      { successMessage: 'Đã tạo đơn hàng mới' },
    );
    if (created) {
      setDrawerOpen(false);
      form.resetFields();
      setLines([{ key: '1', quantity: 1 }]);
      navigate(`/orders/${created.id}`);
    }
  };

  return (
    <div>
      <PageHeader
        title="Đơn hàng"
        subtitle="Đơn khách hàng, tiến độ sản xuất theo lệnh con và tình trạng giao hàng."
        extra={
          canCreate
            ? [
                <Button
                  key="new"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setDrawerOpen(true);
                    form.setFieldsValue({ dueDate: dayjs().add(10, 'day') });
                  }}
                >
                  Tạo đơn
                </Button>,
              ]
            : null
        }
      />

      <div className="page-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Tìm mã đơn, khách hàng, sản phẩm"
          style={{ width: 280 }}
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setFilters({ q: e.target.value || undefined });
          }}
        />
        <Select
          allowClear
          placeholder="Trạng thái"
          style={{ width: 170 }}
          value={filters.status}
          onChange={(value) => setFilters({ status: value })}
          options={(Object.keys(ORDER_STATUS_META) as SalesOrderStatus[]).map((s) => ({ value: s, label: ORDER_STATUS_META[s].label }))}
        />
        <DatePicker
          placeholder="Hạn giao từ"
          format={DATE_FORMAT}
          value={filters.from ? dayjs(filters.from) : null}
          onChange={(value) => setFilters({ from: value ? value.format(DATE_FORMAT) : undefined })}
        />
        <DatePicker
          placeholder="Hạn giao đến"
          format={DATE_FORMAT}
          value={filters.to ? dayjs(filters.to) : null}
          onChange={(value) => setFilters({ to: value ? value.format(DATE_FORMAT) : undefined })}
        />
        <Typography.Text type="secondary">
          {filtered.length} đơn hàng
          {filtered.filter((r) => r.overdue).length > 0 ? ` · ${filtered.filter((r) => r.overdue).length} đơn trễ hạn` : ''}
        </Typography.Text>
      </div>

      <Table<SalesOrderRow>
        rowKey={(r) => r.order.id}
        columns={columns}
        dataSource={filtered}
        loading={!rows}
        size="middle"
        scroll={{ x: 1200 }}
        pagination={{ pageSize: 15, showSizeChanger: false }}
        locale={{ emptyText: <Empty description="Không có đơn hàng phù hợp" /> }}
      />

      <Drawer
        title="Tạo đơn hàng"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="large"
        destroyOnHidden
        footer={
          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => setDrawerOpen(false)}>Đóng</Button>
            <Button type="primary" loading={loading} onClick={() => void submitOrder()}>
              Lưu đơn hàng
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Space size={12} style={{ width: '100%' }} wrap>
            <Form.Item name="customerId" label="Khách hàng" rules={[{ required: true, message: 'Chọn khách hàng' }]} style={{ minWidth: 320 }}>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Chọn khách hàng"
                options={(customers ?? []).map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))}
              />
            </Form.Item>
            <Button size="small" onClick={() => setCustomerModalOpen(true)} style={{ marginTop: 4 }}>
              + Tạo khách nhanh
            </Button>
            <Form.Item name="dueDate" label="Hạn giao" rules={[{ required: true, message: 'Chọn hạn giao' }]} style={{ width: 180 }}>
              <DatePicker format={DATE_FORMAT} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Typography.Text strong>Các dòng sản phẩm</Typography.Text>
          <Space orientation="vertical" style={{ width: '100%', marginTop: 8 }}>
            {lines.map((line, idx) => (
              <Space key={line.key} wrap align="start">
                <Select
                  showSearch
                  optionFilterProp="label"
                  style={{ width: 360 }}
                  placeholder="Chọn sản phẩm"
                  value={line.productId}
                  options={(products ?? []).map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))}
                  onChange={(value) => {
                    const product = (products ?? []).find((p) => p.id === value);
                    setLines(
                      lines.map((l, i) =>
                        i === idx
                          ? { ...l, productId: value, unitPriceVnd: l.unitPriceVnd ?? product?.salePriceVnd ?? 0 }
                          : l,
                      ),
                    );
                  }}
                />
                <InputNumber
                  style={{ width: 110 }}
                  min={1}
                  placeholder="SL"
                  value={line.quantity}
                  onChange={(v) => setLines(lines.map((l, i) => (i === idx ? { ...l, quantity: Number(v ?? 0) } : l)))}
                />
                <InputNumber<number>
                  style={{ width: 170 }}
                  min={0}
                  placeholder="Đơn giá"
                  value={line.unitPriceVnd}
                  formatter={(v) => (v == null ? '' : Number(v).toLocaleString('vi-VN'))}
                  parser={(v) => parseMoneyInput(v) ?? 0}
                  onChange={(v) => setLines(lines.map((l, i) => (i === idx ? { ...l, unitPriceVnd: v ?? undefined } : l)))}
                />
                <Typography.Text type="secondary" style={{ lineHeight: '34px' }}>
                  = {formatMoney((line.quantity || 0) * (line.unitPriceVnd || 0))}
                </Typography.Text>
                <Button type="text" danger disabled={lines.length <= 1} onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
                  Xoá
                </Button>
              </Space>
            ))}
            <Button icon={<PlusOutlined />} onClick={() => setLines([...lines, { key: Math.random().toString(36).slice(2), quantity: 1 }])}>
              Thêm dòng
            </Button>
          </Space>
          <Form.Item name="note" label="Ghi chú đơn hàng" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} placeholder="Yêu cầu riêng, tiến độ giao, điều kiện thanh toán..." />
          </Form.Item>
          <Typography.Paragraph type="secondary">Tổng giá trị đơn (tạm tính): <strong>{formatMoney(lines.reduce((s, l) => s + (l.quantity || 0) * (l.unitPriceVnd || 0), 0))}</strong></Typography.Paragraph>
        </Form>
      </Drawer>

      <Drawer title="Thêm khách hàng nhanh" open={customerModalOpen} onClose={() => setCustomerModalOpen(false)} size="default" destroyOnHidden>
        <Form form={customerForm} layout="vertical">
          <Form.Item name="name" label="Tên khách hàng" rules={[{ required: true, min: 2, message: 'Nhập tên khách hàng' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="Số điện thoại" rules={[{ required: true, message: 'Nhập số điện thoại' }]}>
            <Input placeholder="09xx xxx xxx" />
          </Form.Item>
          <Form.Item name="address" label="Địa chỉ">
            <Input />
          </Form.Item>
          <Button type="primary" loading={loading} onClick={() => void submitCustomer()}>
            Lưu khách hàng
          </Button>
        </Form>
      </Drawer>

      <PrintPreview open={!!printOrderId} onClose={() => setPrintOrderId(null)} title={`Đơn hàng ${printRow?.order.code ?? ''}`}>
        {printRow ? <OrderPrintBody row={printRow} /> : null}
      </PrintPreview>
    </div>
  );
}
