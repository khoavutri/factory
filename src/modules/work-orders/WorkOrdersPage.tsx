import { useMemo, useState } from 'react';
import { Button, Card, Empty, Input, Progress, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { useUrlState } from '../../hooks/useUrlState';
import { db } from '../../db/database';
import { listWorkOrderRows, type WorkOrderRow } from '../../repositories/lists';
import { formatDate } from '../../utils/format';
import { formatQuantity } from '../../utils/money';
import { WORK_ORDER_PRIORITY_META, WORK_ORDER_STATUS_META } from '../../utils/status';
import type { WorkOrderPriority, WorkOrderStatus } from '../../types';

export function WorkOrdersPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useUrlState<{ status?: string; priority?: string; team?: string; overdue?: string; q?: string }>({});
  const [keyword, setKeyword] = useState(filters.q ?? '');

  const rows = useLiveQuery(() => listWorkOrderRows(), []);
  const teams = useLiveQuery(() => db.teams.toArray(), []);

  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    return (rows ?? []).filter((row) => {
      if (filters.status && row.workOrder.status !== filters.status) return false;
      if (filters.priority && row.workOrder.priority !== filters.priority) return false;
      if (filters.team && row.currentStage?.teamId !== filters.team) return false;
      if (filters.overdue === '1' && !row.overdue) return false;
      if (key) {
        const haystack = `${row.workOrder.code} ${row.product?.name ?? ''} ${row.salesOrder?.code ?? ''} ${row.customer?.name ?? ''}`.toLowerCase();
        if (!haystack.includes(key)) return false;
      }
      return true;
    });
  }, [rows, filters.status, filters.priority, filters.team, filters.overdue, keyword]);

  const columns: TableColumnsType<WorkOrderRow> = [
    {
      title: 'Mã lệnh',
      key: 'code',
      width: 170,
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <a className="text-strong" onClick={() => navigate(`/work-orders/${row.workOrder.id}`)}>
            {row.workOrder.code}
          </a>
          <span className="text-muted">{row.salesOrder?.code ?? '—'}</span>
        </Space>
      ),
    },
    {
      title: 'Sản phẩm',
      key: 'product',
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <span>{row.product?.name ?? '—'}</span>
          <span className="text-muted">
            {row.product?.code ?? '—'} · {row.customer?.name ?? '—'}
          </span>
        </Space>
      ),
    },
    { title: 'SL', key: 'qty', width: 90, align: 'right', render: (_, row) => formatQuantity(row.workOrder.quantity) },
    {
      title: 'Tổ hiện tại',
      key: 'team',
      width: 190,
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <span>{row.teamName ?? '—'}</span>
          <span className="text-muted">
            Bước {row.currentStage?.seq ?? 0}/{row.stages.length} — {row.currentStage?.name ?? '—'}
          </span>
        </Space>
      ),
    },
    {
      title: 'Tiến độ công đoạn',
      key: 'progress',
      width: 170,
      render: (_, row) => (
        <Space orientation="vertical" size={0} style={{ width: '100%' }}>
          <Progress
            percent={row.stages.length > 0 ? Math.round((row.doneStages / row.stages.length) * 100) : 0}
            size="small"
            status={row.workOrder.reworkCount > 0 ? 'exception' : 'normal'}
          />
          <span className="text-muted">
            {row.doneStages}/{row.stages.length} công đoạn · SL tốt {formatQuantity(row.goodQty)}
          </span>
        </Space>
      ),
    },
    {
      title: 'Hạn',
      key: 'due',
      width: 120,
      render: (_, row) => (
        <span style={row.overdue ? { color: '#d64545', fontWeight: 600 } : undefined}>
          {formatDate(row.workOrder.dueDate)}
          {row.overdue ? ' (trễ)' : ''}
        </span>
      ),
    },
    { title: 'Ưu tiên', key: 'priority', width: 110, render: (_, row) => <StatusTag kind="priority" status={row.workOrder.priority} /> },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 140,
      render: (_, row) => (
        <Space size={4} wrap>
          <StatusTag kind="workOrder" status={row.workOrder.status} />
          {row.workOrder.reworkCount > 0 ? <Tag color="red">Làm lại {row.workOrder.reworkCount}</Tag> : null}
        </Space>
      ),
    },
    {
      title: '',
      key: 'open',
      width: 90,
      render: (_, row) => (
        <Button size="small" onClick={() => navigate(`/work-orders/${row.workOrder.id}`)}>
          Mở
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Lệnh sản xuất"
        subtitle="Lệnh được sinh từ đơn hàng đã duyệt; theo dõi công đoạn, tổ đang thực hiện và tiến độ ghi sản lượng."
      />

      <div className="page-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Tìm mã lệnh, sản phẩm, đơn hàng, khách"
          style={{ width: 300 }}
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
          options={(Object.keys(WORK_ORDER_STATUS_META) as WorkOrderStatus[]).map((s) => ({ value: s, label: WORK_ORDER_STATUS_META[s].label }))}
        />
        <Select
          allowClear
          placeholder="Ưu tiên"
          style={{ width: 150 }}
          value={filters.priority}
          onChange={(value) => setFilters({ priority: value })}
          options={(Object.keys(WORK_ORDER_PRIORITY_META) as WorkOrderPriority[]).map((p) => ({ value: p, label: WORK_ORDER_PRIORITY_META[p].label }))}
        />
        <Select
          allowClear
          placeholder="Tổ hiện tại"
          style={{ width: 190 }}
          value={filters.team}
          onChange={(value) => setFilters({ team: value })}
          options={(teams ?? []).map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }))}
        />
        <Button type={filters.overdue === '1' ? 'primary' : 'default'} danger={filters.overdue === '1'} onClick={() => setFilters({ overdue: filters.overdue === '1' ? undefined : '1' })}>
          Quá hạn
        </Button>
        <Typography.Text type="secondary">
          {filtered.length} lệnh · {filtered.filter((r) => r.workOrder.status === 'IN_PROGRESS').length} đang sản xuất ·{' '}
          {filtered.filter((r) => r.workOrder.status === 'AWAITING_QC').length} chờ QC
        </Typography.Text>
      </div>

      <Card size="small">
        <Table<WorkOrderRow>
          rowKey={(r) => r.workOrder.id}
          columns={columns}
          dataSource={filtered}
          loading={!rows}
          size="middle"
          scroll={{ x: 1350 }}
          pagination={{ pageSize: 15, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="Không có lệnh sản xuất phù hợp" /> }}
        />
      </Card>
    </div>
  );
}
