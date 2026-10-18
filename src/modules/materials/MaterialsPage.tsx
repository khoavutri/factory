import { useMemo, useState } from 'react';
import { App, Button, Card, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { PlusOutlined, SearchOutlined, SwapOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import { useRole } from '../../app/RoleContext';
import { useAction } from '../../hooks/useAction';
import { useUrlState } from '../../hooks/useUrlState';
import { db } from '../../db/database';
import { listMaterialRows, listProductRows, type MaterialRow } from '../../repositories/lists';
import { downloadCsv, toCsv } from '../../repositories/reports';
import { adjustMaterialStock, postMaterialIssue, postMaterialReceipt, receiveMaterials } from '../../services/inventory';
import { saveMaterial } from '../../services/catalog';
import { formatDate, formatDateTime } from '../../utils/format';
import { formatMoney, formatQuantity, parseMoneyInput, roundQty } from '../../utils/money';
import { MATERIAL_DOC_TYPE_LABEL, MOVEMENT_TYPE_LABEL } from '../../utils/status';
import type { Material, MaterialReceipt, MaterialReceiptItem, Product, StockMovement } from '../../types';

interface ReceiptLineDraft {
  key: string;
  materialId?: string;
  quantity: number;
  unitCostVnd?: number;
}

interface DocumentRow {
  id: string;
  code: string;
  type: keyof typeof MATERIAL_DOC_TYPE_LABEL;
  status: 'DRAFT' | 'POSTED';
  createdAt: string;
  postedAt?: string;
  related: string;
  itemCount: number;
  valueVnd: number;
  refId: string;
}

export function MaterialsPage() {
  const navigate = useNavigate();
  const { actor, role } = useRole();
  const { message } = App.useApp();
  const { loading, run } = useAction();
  const [filters, setFilters] = useUrlState<{ tab?: string; q?: string }>({ tab: 'materials' });
  const [keyword, setKeyword] = useState(filters.q ?? '');

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptLines, setReceiptLines] = useState<ReceiptLineDraft[]>([{ key: '1', quantity: 1 }]);
  const [receiptForm] = Form.useForm<{ supplierId?: string; note?: string; postNow: boolean }>();

  const [stocktakeTarget, setStocktakeTarget] = useState<Material | null>(null);
  const [stocktakeForm] = Form.useForm<{ actualQty: number; reason: string }>();

  const [materialDrawerOpen, setMaterialDrawerOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [materialForm] = Form.useForm<{ code: string; name: string; unit: string; minQty: number; avgCostVnd: number; active: boolean }>();

  const [docDetailOpen, setDocDetailOpen] = useState(false);
  const [docDetail, setDocDetail] = useState<{ kind: 'RECEIPT' | 'ISSUE' | 'DELIVERY'; receipt?: MaterialReceipt; items?: MaterialReceiptItem[]; related?: string; note?: string } | null>(null);

  const [movementFilter, setMovementFilter] = useState<string | undefined>();

  const materialRows = useLiveQuery(() => listMaterialRows(keyword), [keyword]);
  const productRows = useLiveQuery(() => listProductRows(), []);
  const suppliers = useLiveQuery(() => db.suppliers.filter((s) => s.active).toArray(), []);
  const materials = useLiveQuery(() => db.materials.filter((m) => m.active).toArray(), []);
  const receipts = useLiveQuery(() => db.materialReceipts.toArray(), []);
  const issues = useLiveQuery(() => db.materialIssues.toArray(), []);
  const deliveries = useLiveQuery(() => db.deliveries.toArray(), []);
  const movements = useLiveQuery(() => db.stockMovements.orderBy('at').reverse().limit(80).toArray(), []);
  const productStockRows = useLiveQuery(() => db.productStock.toArray(), []);

  const materialById = useMemo(() => new Map((materials ?? []).map((m) => [m.id, m])), [materials]);
  const productById = useMemo(() => new Map((productRows ?? []).map((r) => [r.product.id, r.product])), [productRows]);
  const materialOptions = useMemo(() => (materials ?? []).map((m) => ({ value: m.id, label: `${m.code} — ${m.name} (${m.unit})` })), [materials]);

  const isStore = role === 'MANAGER' || role === 'STOREKEEPER';
  const isManager = role === 'MANAGER';

  const documents: DocumentRow[] = useMemo(() => {
    const receiptRows: DocumentRow[] = (receipts ?? []).map((r) => ({
      id: r.id,
      code: r.code,
      type: 'RECEIPT',
      status: r.status,
      createdAt: r.createdAt,
      postedAt: r.postedAt,
      related: r.supplierNameSnapshot ?? '—',
      itemCount: 0,
      valueVnd: r.totalVnd,
      refId: r.id,
    }));
    const issueRows: DocumentRow[] = (issues ?? []).map((i) => ({
      id: i.id,
      code: i.code,
      type: 'ISSUE',
      status: i.status,
      createdAt: i.createdAt,
      postedAt: i.postedAt,
      related: i.note ?? `Lệnh ${i.workOrderId}`,
      itemCount: 0,
      valueVnd: i.totalVnd,
      refId: i.id,
    }));
    const deliveryRows: DocumentRow[] = (deliveries ?? []).map((d) => ({
      id: d.id,
      code: d.code,
      type: 'DELIVERY',
      status: d.status,
      createdAt: d.createdAt,
      postedAt: d.deliveredAt,
      related: d.receivedBy ?? '—',
      itemCount: 0,
      valueVnd: d.totalVnd,
      refId: d.id,
    }));
    return [...receiptRows, ...issueRows, ...deliveryRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [receipts, issues, deliveries]);

  const filteredDocuments = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    return documents.filter((doc) => (key ? `${doc.code} ${doc.related}`.toLowerCase().includes(key) : true));
  }, [documents, keyword]);

  const openReceiptDetail = async (receipt: MaterialReceipt) => {
    const items = await db.materialReceiptItems.where('receiptId').equals(receipt.id).toArray();
    setDocDetail({ kind: 'RECEIPT', receipt, items, related: receipt.supplierNameSnapshot, note: receipt.note });
    setDocDetailOpen(true);
  };

  const openIssueDetail = async (issueId: string) => {
    const issue = await db.materialIssues.get(issueId);
    if (!issue) return;
    const items = await db.materialIssueItems.where('issueId').equals(issueId).toArray();
    const workOrder = await db.workOrders.get(issue.workOrderId);
    setDocDetail({
      kind: 'ISSUE',
      items: items.map((i) => ({ ...i, receiptId: i.issueId })),
      related: workOrder ? `Lệnh ${workOrder.code}` : undefined,
      note: issue.note,
      receipt: {
        id: issue.id,
        code: issue.code,
        status: issue.status,
        totalVnd: issue.totalVnd,
        createdAt: issue.createdAt,
        postedAt: issue.postedAt,
        revision: issue.revision,
      },
    });
    setDocDetailOpen(true);
  };

  const materialColumns: TableColumnsType<MaterialRow> = [
    {
      title: 'Nguyên vật liệu',
      key: 'material',
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <span className="text-strong">{row.material.name}</span>
          <span className="text-muted">
            {row.material.code}
            {row.low ? <Tag color="orange" style={{ marginInlineStart: 6 }}>Thiếu</Tag> : null}
          </span>
        </Space>
      ),
    },
    { title: 'ĐVT', dataIndex: ['material', 'unit'], key: 'unit', width: 80 },
    {
      title: 'Tồn kho',
      key: 'stock',
      width: 130,
      align: 'right',
      render: (_, row) => (
        <span style={row.low ? { color: '#d64545', fontWeight: 600 } : undefined}>
          {formatQuantity(row.material.stockQty)} {row.material.unit}
        </span>
      ),
    },
    { title: 'Định mức tối thiểu', key: 'min', width: 140, align: 'right', render: (_, row) => `${formatQuantity(row.material.minQty)} ${row.material.unit}` },
    { title: 'Giá bình quân', key: 'cost', width: 140, align: 'right', render: (_, row) => <MoneyDisplay value={row.material.avgCostVnd} /> },
    { title: 'Giá trị tồn', key: 'value', width: 150, align: 'right', render: (_, row) => <MoneyDisplay value={row.valueVnd} strong /> },
    {
      title: '',
      key: 'actions',
      width: 210,
      render: (_, row) => (
        <Space size={4}>
          {isStore ? (
            <Button
              size="small"
              onClick={() => {
                setStocktakeTarget(row.material);
                stocktakeForm.setFieldsValue({ actualQty: row.material.stockQty, reason: '' });
              }}
            >
              Kiểm kê
            </Button>
          ) : null}
          {isManager ? (
            <Button
              size="small"
              onClick={() => {
                setEditingMaterial(row.material);
                materialForm.setFieldsValue({
                  code: row.material.code,
                  name: row.material.name,
                  unit: row.material.unit,
                  minQty: row.material.minQty,
                  avgCostVnd: row.material.avgCostVnd,
                  active: row.material.active,
                });
                setMaterialDrawerOpen(true);
              }}
            >
              Sửa
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const documentColumns: TableColumnsType<DocumentRow> = [
    {
      title: 'Phiếu',
      key: 'code',
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <a
            className="text-strong"
            onClick={() => {
              if (row.type === 'RECEIPT') {
                const receipt = (receipts ?? []).find((r) => r.id === row.id);
                if (receipt) void openReceiptDetail(receipt);
              } else if (row.type === 'ISSUE') {
                void openIssueDetail(row.id);
              } else {
                setDocDetail({
                  kind: 'DELIVERY',
                  related: row.related,
                  note: undefined,
                  items: undefined,
                  receipt: {
                    id: row.id,
                    code: row.code,
                    status: row.status,
                    totalVnd: row.valueVnd,
                    createdAt: row.createdAt,
                    postedAt: row.postedAt,
                    revision: 1,
                  },
                });
                setDocDetailOpen(true);
              }
            }}
          >
            {row.code}
          </a>
          <span className="text-muted">{MATERIAL_DOC_TYPE_LABEL[row.type]}</span>
        </Space>
      ),
    },
    { title: 'Trạng thái', key: 'status', width: 130, render: (_, row) => <StatusTag kind="doc" status={row.status} /> },
    { title: 'Liên quan', key: 'related', render: (_, row) => row.related },
    { title: 'Giá trị', key: 'value', width: 150, align: 'right', render: (_, row) => <MoneyDisplay value={row.valueVnd} /> },
    { title: 'Ngày lập', key: 'created', width: 150, render: (_, row) => formatDateTime(row.createdAt) },
    { title: 'Ngày ghi sổ', key: 'posted', width: 150, render: (_, row) => formatDateTime(row.postedAt) },
    {
      title: '',
      key: 'actions',
      width: 130,
      render: (_, row) =>
        row.status === 'DRAFT' && isStore ? (
          <Button
            size="small"
            type="primary"
            loading={loading}
            onClick={() => {
              if (row.type === 'RECEIPT') {
                void run(() => postMaterialReceipt(actor, row.id), { successMessage: 'Đã ghi sổ phiếu nhập kho' });
              } else if (row.type === 'ISSUE') {
                void run(() => postMaterialIssue(actor, row.id), { successMessage: 'Đã ghi sổ phiếu xuất vật tư' });
              }
            }}
          >
            Ghi sổ
          </Button>
        ) : null,
    },
  ];

  const movementColumns: TableColumnsType<StockMovement> = [
    { title: 'Loại', key: 'type', width: 170, render: (_, m) => <Tag color={m.type === 'ISSUE_OUT' || m.type === 'DELIVERY_OUT' ? 'volcano' : 'green'}>{MOVEMENT_TYPE_LABEL[m.type]}</Tag> },
    {
      title: 'Đối tượng',
      key: 'item',
      render: (_, m) =>
        m.materialId ? (
          <span>{materialById.get(m.materialId)?.name ?? '—'}</span>
        ) : (
          <span>{productById.get(m.productId ?? '')?.name ?? '—'}</span>
        ),
    },
    { title: 'Số lượng', key: 'qty', width: 110, align: 'right', render: (_, m) => formatQuantity(m.quantity) },
    { title: 'Đơn giá', key: 'cost', width: 130, align: 'right', render: (_, m) => <MoneyDisplay value={m.unitCostVnd ?? 0} /> },
    { title: 'Chứng từ', key: 'ref', width: 170, render: (_, m) => `${m.refCode ?? m.refId}` },
    { title: 'Thời điểm', key: 'at', width: 150, render: (_, m) => formatDateTime(m.at) },
    { title: 'Ghi chú', dataIndex: 'note', key: 'note', ellipsis: true },
  ];

  const submitReceipt = async () => {
    const values = await receiptForm.validateFields();
    const lines = receiptLines
      .filter((l) => l.materialId && l.quantity > 0)
      .map((l) => ({ materialId: l.materialId!, quantity: l.quantity, unitCostVnd: l.unitCostVnd ?? 0 }));
    if (lines.length === 0) {
      message.warning('Phiếu nhập cần ít nhất một dòng vật tư hợp lệ.');
      return;
    }
    const ok = await run(
      (op) => receiveMaterials(actor, { supplierId: values.supplierId, note: values.note, postNow: values.postNow, lines }, { operationId: op }),
      { successMessage: values.postNow ? 'Đã nhập kho và cập nhật giá bình quân' : 'Đã lưu nháp phiếu nhập' },
    );
    if (ok) {
      setReceiptOpen(false);
      receiptForm.resetFields();
      setReceiptLines([{ key: '1', quantity: 1 }]);
    }
  };

  const submitStocktake = async () => {
    const values = await stocktakeForm.validateFields();
    if (!stocktakeTarget) return;
    const ok = await run((op) => adjustMaterialStock(actor, { materialId: stocktakeTarget.id, actualQty: values.actualQty, reason: values.reason }, { operationId: op }), {
      successMessage: 'Đã điều chỉnh tồn theo kiểm kê thực tế',
    });
    if (ok) setStocktakeTarget(null);
  };

  const submitMaterial = async () => {
    const values = await materialForm.validateFields();
    const ok = await run(() => saveMaterial(actor, { ...values, id: editingMaterial?.id }), {
      successMessage: editingMaterial ? 'Đã cập nhật vật tư' : 'Đã thêm vật tư mới',
    });
    if (ok) {
      setMaterialDrawerOpen(false);
      setEditingMaterial(null);
      materialForm.resetFields();
    }
  };

  const stockValue = (materialRows ?? []).reduce((s, r) => s + r.valueVnd, 0);
  const lowCount = (materialRows ?? []).filter((r) => r.low).length;
  const productStockTotal = (productStockRows ?? []).reduce((s, r) => s + r.quantity * (productById.get(r.productId)?.salePriceVnd ?? 0), 0);

  const filteredMovements = (movements ?? []).filter((m) => {
    if (!movementFilter) return true;
    if (movementFilter === 'MATERIAL') return !!m.materialId;
    if (movementFilter === 'PRODUCT') return !!m.productId;
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Kho vật tư & thành phẩm"
        subtitle="Tồn nguyên vật liệu theo giá bình quân gia quyền, thành phẩm nhập từ lệnh hoàn thành và chứng từ kho."
        extra={
          isStore
            ? [
                <Button
                  key="receipt"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setReceiptOpen(true);
                    setReceiptLines([{ key: '1', quantity: 1 }]);
                  }}
                >
                  Nhập kho
                </Button>,
                isManager ? (
                  <Button
                    key="new-material"
                    icon={<SwapOutlined />}
                    onClick={() => {
                      setEditingMaterial(null);
                      materialForm.resetFields();
                      materialForm.setFieldsValue({ unit: 'cái', minQty: 0, avgCostVnd: 0, active: true });
                      setMaterialDrawerOpen(true);
                    }}
                  >
                    Thêm vật tư
                  </Button>
                ) : null,
              ]
            : null
        }
      />

      <Tabs
        activeKey={filters.tab ?? 'materials'}
        onChange={(key) => setFilters({ tab: key })}
        items={[
          {
            key: 'materials',
            label: 'Vật tư',
            children: (
              <Card size="small">
                <div className="page-toolbar">
                  <Input
                    allowClear
                    prefix={<SearchOutlined />}
                    placeholder="Tìm mã hoặc tên vật tư"
                    style={{ width: 300 }}
                    value={keyword}
                    onChange={(e) => {
                      setKeyword(e.target.value);
                      setFilters({ q: e.target.value || undefined });
                    }}
                  />
                  <Button
                    onClick={() =>
                      downloadCsv(
                        `ton-vat-tu-${formatDate(new Date()).replace(/\//g, '-')}.csv`,
                        toCsv(
                          (materialRows ?? []).map((r) => ({
                            code: r.material.code,
                            name: r.material.name,
                            unit: r.material.unit,
                            stock: r.material.stockQty,
                            min: r.material.minQty,
                            avgCost: r.material.avgCostVnd,
                            value: r.valueVnd,
                          })),
                          [
                            { key: 'code', label: 'Mã NVL' },
                            { key: 'name', label: 'Tên' },
                            { key: 'unit', label: 'ĐVT' },
                            { key: 'stock', label: 'Tồn kho' },
                            { key: 'min', label: 'Định mức tối thiểu' },
                            { key: 'avgCost', label: 'Giá bình quân' },
                            { key: 'value', label: 'Giá trị tồn' },
                          ],
                        ),
                      )
                    }
                  >
                    Xuất CSV
                  </Button>
                  <Typography.Text type="secondary">
                    {materialRows ? `${materialRows.length} vật tư · ${lowCount} dưới định mức · tổng giá trị ${formatMoney(stockValue)}` : 'Đang tải...'}
                  </Typography.Text>
                </div>
                <Table<MaterialRow>
                  rowKey={(r) => r.material.id}
                  columns={materialColumns}
                  dataSource={materialRows ?? []}
                  loading={!materialRows}
                  size="middle"
                  scroll={{ x: 1150 }}
                  pagination={{ pageSize: 15, showSizeChanger: false }}
                  locale={{ emptyText: <Empty description="Không có vật tư phù hợp" /> }}
                />
                <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                  Tồn kho cập nhật qua phiếu nhập và phiếu cấp vật tư cho lệnh sản xuất. Giá bình quân tính theo phương pháp bình quân gia quyền sau mỗi
                  lần nhập. Kiểm kê nhanh cho phép điều chỉnh tồn thực tế kèm lý do.
                </Typography.Paragraph>
              </Card>
            ),
          },
          {
            key: 'products',
            label: 'Thành phẩm',
            children: (
              <Card size="small" title="Tồn thành phẩm theo sản phẩm">
                <div className="page-toolbar">
                  <Typography.Text type="secondary">
                    Tồn thành phẩm tăng khi lệnh sản xuất được QC kết luận Đạt và giảm khi lập phiếu giao hàng. Tổng giá trị theo giá bán:{' '}
                    {formatMoney(productStockTotal)}
                  </Typography.Text>
                </div>
                <Table
                  rowKey={(r) => r.product.id}
                  size="middle"
                  scroll={{ x: 1050 }}
                  dataSource={productRows ?? []}
                  pagination={{ pageSize: 15, showSizeChanger: false }}
                  columns={[
                    {
                      title: 'Sản phẩm',
                      key: 'product',
                      render: (_, row: { product: Product }) => (
                        <Space orientation="vertical" size={0}>
                          <span className="text-strong">{row.product.name}</span>
                          <span className="text-muted">
                            {row.product.code} · ĐVT {row.product.unit}
                          </span>
                        </Space>
                      ),
                    },
                    { title: 'Tồn thành phẩm', key: 'stock', width: 150, align: 'right', render: (_, row: { product: Product; stockQty: number }) => formatQuantity(row.stockQty) },
                    { title: 'Giá thành sơ bộ', key: 'cost', width: 160, align: 'right', render: (_, row: { cost: { totalVnd: number } }) => <MoneyDisplay value={row.cost.totalVnd} /> },
                    { title: 'Giá bán', key: 'price', width: 140, align: 'right', render: (_, row: { product: Product }) => <MoneyDisplay value={row.product.salePriceVnd} /> },
                    {
                      title: 'Giá trị tồn (giá bán)',
                      key: 'value',
                      width: 170,
                      align: 'right',
                      render: (_, row: { product: Product; stockQty: number }) => <MoneyDisplay value={Math.round(row.stockQty * row.product.salePriceVnd)} strong />,
                    },
                    {
                      title: 'Lệnh đang sản xuất',
                      key: 'open',
                      width: 160,
                      render: (_, row: { product: Product }) => (
                        <Button size="small" onClick={() => navigate(`/work-orders?status=IN_PROGRESS&q=${encodeURIComponent(row.product.code)}`)}>
                          Xem lệnh
                        </Button>
                      ),
                    },
                  ]}
                />
                <Typography.Title level={5} style={{ marginTop: 16 }}>
                  Giao dịch kho gần đây
                </Typography.Title>
                <div className="page-toolbar">
                  <Select
                    allowClear
                    placeholder="Lọc theo nhóm hàng"
                    style={{ width: 220 }}
                    value={movementFilter}
                    onChange={(value) => setMovementFilter(value)}
                    options={[
                      { value: 'MATERIAL', label: 'Nguyên vật liệu' },
                      { value: 'PRODUCT', label: 'Thành phẩm' },
                    ]}
                  />
                </div>
                <Table<StockMovement>
                  rowKey="id"
                  size="small"
                  columns={movementColumns}
                  dataSource={filteredMovements}
                  loading={!movements}
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  scroll={{ x: 1050 }}
                />
              </Card>
            ),
          },
          {
            key: 'documents',
            label: 'Phiếu kho',
            children: (
              <Card size="small">
                <div className="page-toolbar">
                  <Input
                    allowClear
                    prefix={<SearchOutlined />}
                    placeholder="Tìm mã phiếu hoặc đối tượng liên quan"
                    style={{ width: 320 }}
                    value={keyword}
                    onChange={(e) => {
                      setKeyword(e.target.value);
                      setFilters({ q: e.target.value || undefined });
                    }}
                  />
                  <Typography.Text type="secondary">
                    {documents.length} chứng từ: nhập NVL, xuất NVL theo lệnh, nhập thành phẩm và giao hàng. Phiếu nháp có nút ghi sổ để cập nhật tồn.
                  </Typography.Text>
                </div>
                <Table<DocumentRow>
                  rowKey="id"
                  size="middle"
                  columns={documentColumns}
                  dataSource={filteredDocuments}
                  loading={!receipts || !issues || !deliveries}
                  pagination={{ pageSize: 15, showSizeChanger: false }}
                  scroll={{ x: 1100 }}
                  locale={{ emptyText: <Empty description="Không có chứng từ phù hợp" /> }}
                />
              </Card>
            ),
          },
        ]}
      />

      <Modal
        title="Phiếu nhập kho nguyên vật liệu"
        open={receiptOpen}
        onCancel={() => setReceiptOpen(false)}
        onOk={() => void submitReceipt()}
        okText="Lưu phiếu"
        cancelText="Đóng"
        confirmLoading={loading}
        width={880}
        destroyOnHidden
      >
        <Form form={receiptForm} layout="vertical" initialValues={{ postNow: true }}>
          <Space size={12} style={{ width: '100%' }} wrap>
            <Form.Item name="supplierId" label="Nhà cung cấp" style={{ minWidth: 320 }}>
              <Select allowClear options={(suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))} placeholder="Chọn nhà cung cấp" />
            </Form.Item>
            <Form.Item name="postNow" label="Cách lưu" style={{ width: 240 }}>
              <Select
                options={[
                  { value: true, label: 'Ghi sổ ngay (cộng tồn)' },
                  { value: false, label: 'Lưu nháp (chưa cộng tồn)' },
                ]}
              />
            </Form.Item>
          </Space>
          <Form.Item name="note" label="Ghi chú phiếu">
            <Input placeholder="Số hoá đơn, đợt giao hàng..." />
          </Form.Item>
          <Typography.Text strong>Dòng vật tư</Typography.Text>
          <Space orientation="vertical" style={{ width: '100%', marginTop: 8 }}>
            {receiptLines.map((line, idx) => (
              <Space key={line.key} wrap align="start">
                <Select
                  showSearch
                  optionFilterProp="label"
                  style={{ width: 340 }}
                  placeholder="Chọn vật tư"
                  value={line.materialId}
                  options={materialOptions}
                  onChange={(value) => {
                    const material = materialById.get(value);
                    setReceiptLines(
                      receiptLines.map((l, i) => (i === idx ? { ...l, materialId: value, unitCostVnd: l.unitCostVnd ?? material?.avgCostVnd } : l)),
                    );
                  }}
                />
                <InputNumber
                  style={{ width: 120 }}
                  placeholder="Số lượng"
                  min={0}
                  value={line.quantity}
                  onChange={(value) => setReceiptLines(receiptLines.map((l, i) => (i === idx ? { ...l, quantity: Number(value ?? 0) } : l)))}
                />
                <InputNumber<number>
                  style={{ width: 160 }}
                  placeholder="Đơn giá nhập"
                  min={0}
                  value={line.unitCostVnd}
                  formatter={(v) => (v == null ? '' : Number(v).toLocaleString('vi-VN'))}
                  parser={(v) => parseMoneyInput(v) ?? 0}
                  onChange={(value) => setReceiptLines(receiptLines.map((l, i) => (i === idx ? { ...l, unitCostVnd: value ?? undefined } : l)))}
                />
                <Button type="text" danger onClick={() => setReceiptLines(receiptLines.filter((_, i) => i !== idx))}>
                  Xoá
                </Button>
              </Space>
            ))}
            <Button icon={<PlusOutlined />} onClick={() => setReceiptLines([...receiptLines, { key: Math.random().toString(36).slice(2), quantity: 1 }])}>
              Thêm dòng
            </Button>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
            Tổng giá trị phiếu: {formatMoney(receiptLines.reduce((s, l) => s + Math.round((l.quantity || 0) * (l.unitCostVnd || 0)), 0))} — giá bình quân
            sẽ được tính lại theo bình quân gia quyền sau khi ghi sổ.
          </Typography.Paragraph>
        </Form>
      </Modal>

      <Modal
        title={`Kiểm kê nhanh: ${stocktakeTarget?.name ?? ''}`}
        open={!!stocktakeTarget}
        onCancel={() => setStocktakeTarget(null)}
        onOk={() => void submitStocktake()}
        okText="Ghi điều chỉnh"
        cancelText="Đóng"
        confirmLoading={loading}
        destroyOnHidden
      >
        <Form form={stocktakeForm} layout="vertical">
          <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
            <Descriptions.Item label="Tồn hệ thống">
              {formatQuantity(stocktakeTarget?.stockQty ?? 0)} {stocktakeTarget?.unit}
            </Descriptions.Item>
            <Descriptions.Item label="Giá bình quân">
              <MoneyDisplay value={stocktakeTarget?.avgCostVnd ?? 0} />
            </Descriptions.Item>
          </Descriptions>
          <Form.Item name="actualQty" label="Tồn thực tế kiểm kê" rules={[{ required: true, message: 'Nhập tồn thực tế' }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="Lý do chênh lệch" rules={[{ required: true, min: 5, message: 'Nhập lý do (ít nhất 5 ký tự)' }]}>
            <Input.TextArea rows={2} placeholder="Ví dụ: kiểm kê ngày 18/10 phát hiện thiếu 3 kg do hao hụt khi cắt." />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={editingMaterial ? `Cập nhật ${editingMaterial.code}` : 'Thêm vật tư mới'}
        open={materialDrawerOpen}
        onClose={() => setMaterialDrawerOpen(false)}
        size="default"
        destroyOnHidden
        footer={
          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => setMaterialDrawerOpen(false)}>Đóng</Button>
            <Button type="primary" loading={loading} onClick={() => void submitMaterial()}>
              Lưu vật tư
            </Button>
          </Space>
        }
      >
        <Form form={materialForm} layout="vertical">
          <Form.Item name="code" label="Mã vật tư" rules={[{ required: true, message: 'Nhập mã vật tư' }]}>
            <Input disabled={!!editingMaterial} />
          </Form.Item>
          <Form.Item name="name" label="Tên vật tư" rules={[{ required: true, min: 2, message: 'Nhập tên vật tư' }]}>
            <Input />
          </Form.Item>
          <Space size={12} style={{ width: '100%' }} wrap>
            <Form.Item name="unit" label="ĐVT" rules={[{ required: true }]} style={{ width: 130 }}>
              <Input />
            </Form.Item>
            <Form.Item name="minQty" label="Định mức tối thiểu" style={{ width: 190 }}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="avgCostVnd" label="Giá bình quân (VND)" rules={[{ required: true }]}>
            <InputNumber<number>
              min={0}
              step={1000}
              style={{ width: '100%' }}
              formatter={(v) => (v == null ? '' : Number(v).toLocaleString('vi-VN'))}
              parser={(v) => parseMoneyInput(v) ?? 0}
            />
          </Form.Item>
          <Form.Item name="active" label="Trạng thái">
            <Select options={[{ value: true, label: 'Đang dùng' }, { value: false, label: 'Ngừng dùng' }]} />
          </Form.Item>
          {editingMaterial ? (
            <Typography.Paragraph type="secondary">
              Muốn đổi tồn kho hãy dùng chức năng Kiểm kê hoặc lập phiếu nhập/xuất để giữ đúng dấu vết chứng từ.
            </Typography.Paragraph>
          ) : null}
        </Form>
      </Drawer>

      <Drawer
        title={`Chứng từ ${docDetail?.receipt?.code ?? ''}`}
        open={docDetailOpen}
        onClose={() => setDocDetailOpen(false)}
        size="large"
        destroyOnHidden
      >
        {docDetail ? (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Space wrap>
              <Tag>{docDetail.kind === 'RECEIPT' ? 'Nhập NVL' : docDetail.kind === 'ISSUE' ? 'Xuất NVL theo lệnh' : 'Giao hàng'}</Tag>
              {docDetail.receipt ? <StatusTag kind="doc" status={docDetail.receipt.status} /> : null}
              <span className="text-muted">{formatDateTime(docDetail.receipt?.postedAt ?? docDetail.receipt?.createdAt)}</span>
            </Space>
            {docDetail.related ? <div>Liên quan: {docDetail.related}</div> : null}
            {docDetail.note ? <div>Ghi chú: {docDetail.note}</div> : null}
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={docDetail.items ?? []}
              columns={[
                { title: 'Vật tư', dataIndex: 'materialNameSnapshot', key: 'name' },
                { title: 'ĐVT', dataIndex: 'unitSnapshot', key: 'unit', width: 80 },
                { title: 'Số lượng', key: 'qty', width: 130, align: 'right', render: (_, i: MaterialReceiptItem) => formatQuantity(i.quantity) },
                { title: 'Đơn giá', key: 'cost', width: 140, align: 'right', render: (_, i: MaterialReceiptItem) => <MoneyDisplay value={i.unitCostVnd} /> },
                { title: 'Thành tiền', key: 'amount', width: 150, align: 'right', render: (_, i: MaterialReceiptItem) => <MoneyDisplay value={roundQty(i.quantity * i.unitCostVnd, 0)} strong /> },
              ]}
              locale={{ emptyText: 'Chứng từ giao hàng không hiển thị dòng tại đây' }}
            />
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
