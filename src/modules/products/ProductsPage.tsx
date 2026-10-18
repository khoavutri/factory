import { useMemo, useState } from 'react';
import { Alert, App, Button, Divider, Drawer, Empty, Form, Input, InputNumber, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, CopyOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageHeader } from '../../components/PageHeader';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import { useRole } from '../../app/RoleContext';
import { useAction } from '../../hooks/useAction';
import { db } from '../../db/database';
import { listProductRows, type ProductRow } from '../../repositories/lists';
import { computeProductCost, saveProduct, type ProductInput } from '../../services/catalog';
import { formatMoney, formatQuantity } from '../../utils/money';
import styles from './Products.module.scss';

interface StageDraft {
  key: string;
  name: string;
  teamId?: string;
  pieceRateVnd: number;
  standardMinutes: number;
}

interface MaterialDraft {
  key: string;
  materialId?: string;
  quantityPerUnit: number;
  wastePct: number;
}

export function ProductsPage() {
  const { actor, role } = useRole();
  const { message } = App.useApp();
  const { loading, run } = useAction();
  const [keyword, setKeyword] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [copyFrom, setCopyFrom] = useState<string | undefined>();
  const [stages, setStages] = useState<StageDraft[]>([]);
  const [materials, setMaterials] = useState<MaterialDraft[]>([]);
  const [form] = Form.useForm<{ code: string; name: string; unit: string; salePriceVnd: number; note?: string; active: boolean }>();

  const rows = useLiveQuery(() => listProductRows(), []);
  const teams = useLiveQuery(() => db.teams.filter((t) => t.active).toArray(), []);
  const materialList = useLiveQuery(() => db.materials.filter((m) => m.active).toArray(), []);

  const materialById = useMemo(() => new Map((materialList ?? []).map((m) => [m.id, m])), [materialList]);

  const canManage = role === 'MANAGER' || role === 'PLANNER';

  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    return (rows ?? []).filter((r) => (key ? `${r.product.code} ${r.product.name}`.toLowerCase().includes(key) : true));
  }, [rows, keyword]);

  const draftCost = useMemo(() => {
    const cost = computeProductCost(
      stages.map((s, idx) => ({
        id: s.key,
        productId: 'draft',
        seq: idx + 1,
        name: s.name,
        teamId: s.teamId ?? '',
        pieceRateVnd: s.pieceRateVnd,
        standardMinutes: s.standardMinutes,
      })),
      materials
        .filter((m) => m.materialId)
        .map((m) => ({ id: m.key, productId: 'draft', materialId: m.materialId!, quantityPerUnit: m.quantityPerUnit, wastePct: m.wastePct })),
      materialById,
    );
    return cost;
  }, [stages, materials, materialById]);

  const columns: TableColumnsType<ProductRow> = [
    {
      title: 'Sản phẩm',
      key: 'product',
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <span className="text-strong">{row.product.name}</span>
          <span className="text-muted">
            {row.product.code} · ĐVT {row.product.unit}
          </span>
        </Space>
      ),
    },
    { title: 'Giá bán', key: 'price', width: 140, align: 'right', render: (_, row) => <MoneyDisplay value={row.product.salePriceVnd} /> },
    { title: 'Số NVL', key: 'materials', width: 90, align: 'center', render: (_, row) => row.materialCount },
    { title: 'Số công đoạn', key: 'stages', width: 110, align: 'center', render: (_, row) => row.stageCount },
    {
      title: 'Giá thành sơ bộ',
      key: 'cost',
      width: 190,
      align: 'right',
      render: (_, row) => (
        <Space orientation="vertical" size={0} style={{ width: '100%', textAlign: 'right' }}>
          <MoneyDisplay value={row.cost.totalVnd} strong />
          <span className="text-muted">
            NVL {formatMoney(row.cost.materialCostVnd)} · công {formatMoney(row.cost.laborCostVnd)}
          </span>
        </Space>
      ),
    },
    {
      title: 'Lãi gộp/đơn vị',
      key: 'margin',
      width: 150,
      align: 'right',
      render: (_, row) => {
        const margin = row.product.salePriceVnd - row.cost.totalVnd;
        return <span style={margin < 0 ? { color: '#d64545', fontWeight: 600 } : { color: '#2f9e44' }}>{formatMoney(margin)}</span>;
      },
    },
    { title: 'Tồn TP', key: 'stock', width: 100, align: 'right', render: (_, row) => formatQuantity(row.stockQty) },
    { title: 'Trạng thái', key: 'active', width: 120, render: (_, row) => (row.product.active ? <Tag color="green">Đang dùng</Tag> : <Tag>Ngừng dùng</Tag>) },
    {
      title: '',
      key: 'actions',
      width: 110,
      render: (_, row) => (
        <Button
          size="small"
          onClick={() => {
            setEditing(row);
            setCopyFrom(undefined);
            form.setFieldsValue({
              code: row.product.code,
              name: row.product.name,
              unit: row.product.unit,
              salePriceVnd: row.product.salePriceVnd,
              note: row.product.note,
              active: row.product.active,
            });
            setStages(
              row.stages.map((s) => ({
                key: s.id,
                name: s.name,
                teamId: s.teamId,
                pieceRateVnd: s.pieceRateVnd,
                standardMinutes: s.standardMinutes,
              })),
            );
            setMaterials(
              row.bomMaterials.map((m) => ({
                key: m.id,
                materialId: m.materialId,
                quantityPerUnit: m.quantityPerUnit,
                wastePct: m.wastePct,
              })),
            );
            setDrawerOpen(true);
          }}
        >
          {canManage ? 'Sửa BOM' : 'Xem BOM'}
        </Button>
      ),
    },
  ];

  const moveStage = (index: number, direction: -1 | 1) => {
    const next = [...stages];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setStages(next);
  };

  const applyCopyFrom = (productId: string | undefined) => {
    setCopyFrom(productId);
    if (!productId) return;
    const source = (rows ?? []).find((r) => r.product.id === productId);
    if (!source) return;
    setStages(
      source.stages.map((s) => ({ key: Math.random().toString(36).slice(2), name: s.name, teamId: s.teamId, pieceRateVnd: s.pieceRateVnd, standardMinutes: s.standardMinutes })),
    );
    setMaterials(
      source.bomMaterials.map((m) => ({
        key: Math.random().toString(36).slice(2),
        materialId: m.materialId,
        quantityPerUnit: m.quantityPerUnit,
        wastePct: m.wastePct,
      })),
    );
  };

  const submit = async () => {
    const values = await form.validateFields();
    if (stages.length === 0) {
      message.warning('Cần ít nhất một công đoạn trong BOM.');
      return;
    }
    const invalidStage = stages.find((s) => !s.teamId || s.name.trim().length < 2);
    if (invalidStage) {
      message.warning('Mỗi công đoạn cần tên và tổ thực hiện.');
      return;
    }
    const invalidMaterial = materials.find((m) => !m.materialId || m.quantityPerUnit <= 0);
    if (invalidMaterial) {
      message.warning('Mỗi dòng nguyên vật liệu cần chọn vật tư và định mức lớn hơn 0.');
      return;
    }
    const payload: ProductInput = {
      id: editing?.product.id,
      code: values.code,
      name: values.name,
      unit: values.unit,
      salePriceVnd: values.salePriceVnd,
      note: values.note,
      active: values.active,
      stages: stages.map((s) => ({ name: s.name, teamId: s.teamId!, pieceRateVnd: s.pieceRateVnd, standardMinutes: s.standardMinutes })),
      materials: materials.map((m) => ({ materialId: m.materialId!, quantityPerUnit: m.quantityPerUnit, wastePct: m.wastePct })),
    };
    const saved = await run(() => saveProduct(actor, payload), { successMessage: editing ? 'Đã cập nhật sản phẩm & BOM' : 'Đã thêm sản phẩm mới' });
    if (saved) {
      setDrawerOpen(false);
      setEditing(null);
      setStages([]);
      setMaterials([]);
      form.resetFields();
    }
  };

  return (
    <div>
      <PageHeader
        title="Sản phẩm & Định mức (BOM)"
        subtitle="Danh mục sản phẩm cơ khí kèm công đoạn, tổ thực hiện, đơn giá khoán và định mức nguyên vật liệu."
        extra={
          canManage
            ? [
                <Button
                  key="new"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setEditing(null);
                    setCopyFrom(undefined);
                    form.resetFields();
                    form.setFieldsValue({ unit: 'cái', active: true, salePriceVnd: 0 });
                    setStages([]);
                    setMaterials([]);
                    setDrawerOpen(true);
                  }}
                >
                  Thêm sản phẩm
                </Button>,
              ]
            : null
        }
      />

      <div className="page-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Tìm mã hoặc tên sản phẩm"
          style={{ width: 300 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Typography.Text type="secondary">
          {filtered.length} sản phẩm · giá thành sơ bộ cập nhật theo giá bình quân nguyên vật liệu hiện tại
        </Typography.Text>
      </div>

      <Table<ProductRow>
        rowKey={(r) => r.product.id}
        columns={columns}
        dataSource={filtered}
        loading={!rows}
        size="middle"
        scroll={{ x: 1250 }}
        pagination={{ pageSize: 15, showSizeChanger: false }}
        locale={{ emptyText: <Empty description="Không có sản phẩm phù hợp" /> }}
      />

      <Drawer
        title={editing ? `BOM sản phẩm ${editing.product.code}` : 'Thêm sản phẩm mới'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="large"
        destroyOnHidden
        footer={
          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => setDrawerOpen(false)}>Đóng</Button>
            {canManage ? (
              <Button type="primary" loading={loading} onClick={() => void submit()}>
                Lưu sản phẩm & BOM
              </Button>
            ) : null}
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Space size={12} style={{ width: '100%' }} wrap>
            <Form.Item name="code" label="Mã sản phẩm" rules={[{ required: true, message: 'Nhập mã sản phẩm' }]} style={{ width: 180 }}>
              <Input disabled={!!editing} />
            </Form.Item>
            <Form.Item name="name" label="Tên sản phẩm" rules={[{ required: true, min: 2, message: 'Nhập tên sản phẩm' }]} style={{ width: 380 }}>
              <Input />
            </Form.Item>
            <Form.Item name="unit" label="ĐVT" rules={[{ required: true }]} style={{ width: 110 }}>
              <Input />
            </Form.Item>
            <Form.Item name="salePriceVnd" label="Giá bán (VND)" rules={[{ required: true }]} style={{ width: 160 }}>
              <InputNumber<number>
                min={0}
                step={50000}
                style={{ width: '100%' }}
                formatter={(v) => (v == null ? '' : Number(v).toLocaleString('vi-VN'))}
                parser={(v) => Number((v ?? '').replace(/[^\d]/g, ''))}
              />
            </Form.Item>
          </Space>
          {!editing ? (
            <Form.Item label="Sao chép BOM từ sản phẩm khác (tuỳ chọn)">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Chọn sản phẩm mẫu để sao chép công đoạn và định mức"
                value={copyFrom}
                style={{ maxWidth: 460 }}
                options={(rows ?? []).map((r) => ({ value: r.product.id, label: `${r.product.code} — ${r.product.name}` }))}
                onChange={(value) => applyCopyFrom(value)}
                suffixIcon={<CopyOutlined />}
              />
            </Form.Item>
          ) : null}
          <Form.Item name="note" label="Ghi chú kỹ thuật">
            <Input placeholder="Vật liệu, dung sai, yêu cầu bề mặt..." />
          </Form.Item>
          <Form.Item name="active" label="Trạng thái">
            <Select options={[{ value: true, label: 'Đang sản xuất' }, { value: false, label: 'Ngừng sản xuất' }]} />
          </Form.Item>
        </Form>

        <Divider>Công đoạn (routing)</Divider>
        <Space orientation="vertical" style={{ width: '100%' }}>
          {stages.map((stage, idx) => (
            <Space key={stage.key} wrap align="start" className={styles.bomRow}>
              <Tag color="geekblue" style={{ marginTop: 6 }}>
                Bước {idx + 1}
              </Tag>
              <Input
                style={{ width: 210 }}
                placeholder="Tên công đoạn"
                value={stage.name}
                readOnly={!canManage}
                onChange={(e) => setStages(stages.map((s, i) => (i === idx ? { ...s, name: e.target.value } : s)))}
              />
              <Select
                style={{ width: 190 }}
                placeholder="Tổ thực hiện"
                value={stage.teamId}
                disabled={!canManage}
                options={(teams ?? []).map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }))}
                onChange={(value) => setStages(stages.map((s, i) => (i === idx ? { ...s, teamId: value } : s)))}
              />
              <InputNumber<number>
                style={{ width: 150 }}
                placeholder="Đơn giá khoán"
                value={stage.pieceRateVnd}
                min={0}
                step={5000}
                formatter={(v) => (v == null ? '' : Number(v).toLocaleString('vi-VN'))}
                parser={(v) => Number((v ?? '').replace(/[^\d]/g, ''))}
                onChange={(value) => setStages(stages.map((s, i) => (i === idx ? { ...s, pieceRateVnd: Number(value ?? 0) } : s)))}
              />
              <InputNumber
                style={{ width: 120 }}
                placeholder="Phút/ĐV"
                value={stage.standardMinutes}
                min={0}
                onChange={(value) => setStages(stages.map((s, i) => (i === idx ? { ...s, standardMinutes: Number(value ?? 0) } : s)))}
              />
              <Tooltip title="Đưa lên">
                <Button icon={<ArrowUpOutlined />} disabled={idx === 0 || !canManage} onClick={() => moveStage(idx, -1)} />
              </Tooltip>
              <Tooltip title="Đưa xuống">
                <Button icon={<ArrowDownOutlined />} disabled={idx === stages.length - 1 || !canManage} onClick={() => moveStage(idx, 1)} />
              </Tooltip>
              <Button type="text" danger disabled={!canManage} onClick={() => setStages(stages.filter((_, i) => i !== idx))}>
                Xoá
              </Button>
            </Space>
          ))}
          {canManage ? (
            <Button
              icon={<PlusOutlined />}
              onClick={() =>
                setStages([
                  ...stages,
                  { key: Math.random().toString(36).slice(2), name: '', pieceRateVnd: 15000, standardMinutes: 15 },
                ])
              }
            >
              Thêm công đoạn
            </Button>
          ) : null}
        </Space>

        <Divider>Nguyên vật liệu theo định mức</Divider>
        <Space orientation="vertical" style={{ width: '100%' }}>
          {materials.map((line, idx) => {
            const material = line.materialId ? materialById.get(line.materialId) : undefined;
            const unitCost = material ? Math.round(line.quantityPerUnit * (1 + line.wastePct / 100) * material.avgCostVnd) : 0;
            return (
              <Space key={line.key} wrap align="start" className={styles.bomRow}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  style={{ width: 340 }}
                  placeholder="Chọn nguyên vật liệu"
                  value={line.materialId}
                  disabled={!canManage}
                  options={(materialList ?? []).map((m) => ({ value: m.id, label: `${m.code} — ${m.name} (${m.unit})` }))}
                  onChange={(value) => setMaterials(materials.map((m, i) => (i === idx ? { ...m, materialId: value } : m)))}
                />
                <InputNumber
                  style={{ width: 130 }}
                  placeholder="Định mức/1 SP"
                  min={0}
                  value={line.quantityPerUnit}
                  disabled={!canManage}
                  onChange={(value) => setMaterials(materials.map((m, i) => (i === idx ? { ...m, quantityPerUnit: Number(value ?? 0) } : m)))}
                />
                <InputNumber
                  style={{ width: 110 }}
                  placeholder="% hao hụt"
                  min={0}
                  max={100}
                  value={line.wastePct}
                  disabled={!canManage}
                  onChange={(value) => setMaterials(materials.map((m, i) => (i === idx ? { ...m, wastePct: Number(value ?? 0) } : m)))}
                />
                <Typography.Text type="secondary" style={{ lineHeight: '34px', minWidth: 130 }}>
                  {material ? `${formatMoney(unitCost)} (${material.unit})` : '—'}
                </Typography.Text>
                <Button type="text" danger disabled={!canManage} onClick={() => setMaterials(materials.filter((_, i) => i !== idx))}>
                  Xoá
                </Button>
              </Space>
            );
          })}
          {canManage ? (
            <Button icon={<PlusOutlined />} onClick={() => setMaterials([...materials, { key: Math.random().toString(36).slice(2), quantityPerUnit: 1, wastePct: 0 }])}>
              Thêm nguyên vật liệu
            </Button>
          ) : null}
        </Space>

        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          title={
            <span>
              Giá thành sơ bộ 1 đơn vị: <strong>{formatMoney(draftCost.totalVnd)}</strong> — NVL {formatMoney(draftCost.materialCostVnd)} + công đoạn{' '}
              {formatMoney(draftCost.laborCostVnd)}. Công thức: Σ định mức × (1 + hao hụt) × giá bình quân + Σ đơn giá khoán.
            </span>
          }
        />
      </Drawer>
    </div>
  );
}
