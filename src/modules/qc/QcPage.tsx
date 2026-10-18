import { useMemo, useState } from 'react';
import { Alert, Button, Card, DatePicker, Empty, Progress, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { ExperimentOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import dayjs, { type Dayjs } from 'dayjs';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { QcCheckModal } from '../../components/QcCheckModal';
import { useRole } from '../../app/RoleContext';
import { useUrlState } from '../../hooks/useUrlState';
import { db } from '../../db/database';
import { listQcCheckRows, listWorkOrderRows, type QcCheckRow } from '../../repositories/lists';
import { DATE_FORMAT, formatDateTime } from '../../utils/format';
import { formatQuantity } from '../../utils/money';
import { DEFECT_TYPE_LABEL } from '../../utils/status';
import type { DefectType } from '../../types';

export function QcPage() {
  const navigate = useNavigate();
  const { role } = useRole();
  const [filters, setFilters] = useUrlState<{ from?: string; to?: string; result?: string; defect?: string }>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string | undefined>();

  const checks = useLiveQuery(() => listQcCheckRows(), []);
  const workOrderRows = useLiveQuery(() => listWorkOrderRows(), []);
  const employees = useLiveQuery(() => db.employees.toArray(), []);

  const employeeById = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e])), [employees]);

  const waiting = (workOrderRows ?? []).filter((r) => r.workOrder.status === 'AWAITING_QC');
  const canQc = role === 'MANAGER' || role === 'QC';

  const filtered = useMemo(() => {
    return (checks ?? []).filter((row) => {
      const key = row.check.checkedAt.slice(0, 10);
      if (filters.from && key < filters.from) return false;
      if (filters.to && key > filters.to) return false;
      if (filters.result && row.check.result !== filters.result) return false;
      if (filters.defect && row.check.defectType !== filters.defect) return false;
      return true;
    });
  }, [checks, filters.from, filters.to, filters.result, filters.defect]);

  const stats30 = useMemo(() => {
    const from = dayjs().subtract(29, 'day').startOf('day').toISOString();
    const rows30 = (checks ?? []).filter((r) => r.check.checkedAt >= from);
    const passed = rows30.filter((r) => r.check.result === 'PASSED').length;
    const failedRows = rows30.filter((r) => r.check.result === 'FAILED');
    const byDefect = new Map<DefectType, { count: number; failedQty: number }>();
    for (const row of failedRows) {
      const entry = byDefect.get(row.check.defectType) ?? { count: 0, failedQty: 0 };
      entry.count += 1;
      entry.failedQty += row.check.failedQty;
      byDefect.set(row.check.defectType, entry);
    }
    const byTeam = new Map<string, number>();
    for (const row of failedRows) {
      const name = row.teamName ?? 'Chưa rõ tổ';
      byTeam.set(name, (byTeam.get(name) ?? 0) + row.check.failedQty);
    }
    return {
      total: rows30.length,
      passed,
      passRate: rows30.length > 0 ? Math.round((passed / rows30.length) * 100) : 100,
      reworkCount: (workOrderRows ?? []).filter((r) => r.workOrder.reworkCount > 0).length,
      byDefect: [...byDefect.entries()].sort((a, b) => b[1].count - a[1].count),
      byTeam: [...byTeam.entries()].sort((a, b) => b[1] - a[1]),
      failedQty: failedRows.reduce((s, r) => s + r.check.failedQty, 0),
    };
  }, [checks, workOrderRows]);

  const maxDefect = Math.max(1, ...stats30.byDefect.map(([, v]) => v.count));
  const maxTeamFailed = Math.max(1, ...stats30.byTeam.map(([, v]) => v));

  const columns: TableColumnsType<QcCheckRow> = [
    { title: 'Mã phiếu', key: 'code', width: 160, render: (_, row) => <span className="text-strong">{row.check.code}</span> },
    {
      title: 'Lệnh / sản phẩm',
      key: 'workOrder',
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <a onClick={() => navigate(`/work-orders/${row.check.workOrderId}`)}>{row.workOrder?.code ?? '—'}</a>
          <span className="text-muted">{row.product?.name ?? '—'}</span>
        </Space>
      ),
    },
    { title: 'SL kiểm', key: 'checked', width: 90, align: 'right', render: (_, row) => formatQuantity(row.check.checkedQty) },
    { title: 'SL đạt', key: 'passed', width: 90, align: 'right', render: (_, row) => formatQuantity(row.check.passedQty) },
    {
      title: 'SL lỗi',
      key: 'failed',
      width: 90,
      align: 'right',
      render: (_, row) => (row.check.failedQty > 0 ? <span style={{ color: '#d64545' }}>{formatQuantity(row.check.failedQty)}</span> : 0),
    },
    { title: 'Loại lỗi', key: 'defect', width: 140, render: (_, row) => DEFECT_TYPE_LABEL[row.check.defectType] },
    {
      title: 'Kết quả',
      key: 'result',
      width: 170,
      render: (_, row) => (
        <Space size={4} wrap>
          <StatusTag kind="qc" status={row.check.result} />
          {row.check.afterRework ? <Tag color="volcano">Làm lại</Tag> : null}
        </Space>
      ),
    },
    { title: 'Tổ cuối', key: 'team', width: 150, render: (_, row) => row.teamName ?? '—' },
    { title: 'Người kiểm', key: 'checker', width: 160, render: (_, row) => employeeById.get(row.check.checkedById)?.name ?? '—' },
    { title: 'Ngày kiểm', key: 'at', width: 150, render: (_, row) => formatDateTime(row.check.checkedAt) },
  ];

  return (
    <div>
      <PageHeader
        title="Kiểm tra chất lượng"
        subtitle="Danh sách lệnh chờ kiểm, lịch sử phiếu QC và thống kê lỗi theo loại/tổ trong 30 ngày."
      />

      <Card size="small" title={`Lệnh đang chờ kiểm (${waiting.length})`} style={{ marginBottom: 14 }}>
        {waiting.length === 0 ? (
          <Alert type="success" showIcon title="Không có lệnh nào đang chờ QC." />
        ) : (
          <Space orientation="vertical" style={{ width: '100%' }} size={8}>
            {waiting.map((row) => (
              <div key={row.workOrder.id} className="qc-waiting-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderBottom: '1px dashed #edf1f6', paddingBottom: 6 }}>
                <div>
                  <div>
                    <a className="text-strong" onClick={() => navigate(`/work-orders/${row.workOrder.id}`)}>
                      {row.workOrder.code}
                    </a>{' '}
                    — {row.product?.name ?? '—'}{' '}
                    <Tag style={{ marginInlineStart: 6 }}>
                      SL {formatQuantity(row.workOrder.quantity)} {row.product?.unit ?? ''}
                    </Tag>
                    {row.workOrder.reworkCount > 0 ? <Tag color="red">Làm lại {row.workOrder.reworkCount}</Tag> : null}
                  </div>
                  <div className="text-muted">
                    Tổ cuối: {row.teamName ?? '—'} · chờ từ {formatDateTime(row.workOrder.awaitingQcAt)}
                    {row.workOrder.startedAt ? ` · bắt đầu ${formatDateTime(row.workOrder.startedAt)}` : ''}
                  </div>
                </div>
                {canQc ? (
                  <Button
                    type="primary"
                    icon={<ExperimentOutlined />}
                    onClick={() => {
                      setSelectedWorkOrderId(row.workOrder.id);
                      setModalOpen(true);
                    }}
                  >
                    Kiểm tra
                  </Button>
                ) : null}
              </div>
            ))}
          </Space>
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 14, alignItems: 'start', marginBottom: 14 }}>
        <Card size="small" title="Thống kê chất lượng 30 ngày">
          <Space size={36} wrap>
            <div style={{ textAlign: 'center' }}>
              <Progress type="circle" percent={stats30.passRate} strokeColor={stats30.passRate >= 85 ? '#2f9e44' : '#e8930c'} size={110} />
              <div className="text-muted" style={{ marginTop: 6 }}>
                Tỷ lệ đạt QC
              </div>
            </div>
            <Statistic title="Phiếu QC trong 30 ngày" value={stats30.total} />
            <Statistic title="Phiếu đạt" value={stats30.passed} styles={{ content: { color: '#2f9e44' } }} />
            <Statistic title="SL lỗi ghi nhận" value={formatQuantity(stats30.failedQty)} styles={{ content: { color: '#d64545' } }} />
            <Statistic title="Lệnh từng phải làm lại" value={stats30.reworkCount} />
          </Space>
        </Card>

        <Card size="small" title="Lỗi theo loại & tổ (30 ngày)">
          {stats30.byDefect.length === 0 ? (
            <Typography.Text type="secondary">Chưa có lỗi nào trong 30 ngày.</Typography.Text>
          ) : (
            <Space orientation="vertical" style={{ width: '100%' }} size={10}>
              {stats30.byDefect.map(([defect, value]) => (
                <div key={defect}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{DEFECT_TYPE_LABEL[defect]}</span>
                    <span>
                      {value.count} phiếu · {formatQuantity(value.failedQty)} SL lỗi
                    </span>
                  </div>
                  <Progress percent={Math.round((value.count / maxDefect) * 100)} showInfo={false} strokeColor="#e8930c" />
                </div>
              ))}
              {stats30.byTeam.length > 0 ? (
                <>
                  <Typography.Text strong>Top lỗi theo tổ (SL lỗi)</Typography.Text>
                  {stats30.byTeam.map(([team, value]) => (
                    <div key={team}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>{team}</span>
                        <span>{formatQuantity(value)}</span>
                      </div>
                      <Progress percent={Math.round((value / maxTeamFailed) * 100)} showInfo={false} strokeColor="#d64545" />
                    </div>
                  ))}
                </>
              ) : null}
            </Space>
          )}
        </Card>
      </div>

      <Card size="small" title={`Phiếu kiểm tra chất lượng (${filtered.length})`}>
        <div className="page-toolbar">
          <DatePicker
            placeholder="Từ ngày"
            format={DATE_FORMAT}
            value={filters.from ? dayjs(filters.from) : null}
            onChange={(value: Dayjs | null) => setFilters({ from: value ? value.format('YYYY-MM-DD') : undefined })}
          />
          <DatePicker
            placeholder="Đến ngày"
            format={DATE_FORMAT}
            value={filters.to ? dayjs(filters.to) : null}
            onChange={(value: Dayjs | null) => setFilters({ to: value ? value.format('YYYY-MM-DD') : undefined })}
          />
          <Select
            allowClear
            placeholder="Kết quả"
            style={{ width: 150 }}
            value={filters.result}
            onChange={(value) => setFilters({ result: value })}
            options={[
              { value: 'PASSED', label: 'Đạt' },
              { value: 'FAILED', label: 'Không đạt' },
            ]}
          />
          <Select
            allowClear
            placeholder="Loại lỗi"
            style={{ width: 170 }}
            value={filters.defect}
            onChange={(value) => setFilters({ defect: value })}
            options={(Object.keys(DEFECT_TYPE_LABEL) as DefectType[]).map((d) => ({ value: d, label: DEFECT_TYPE_LABEL[d] }))}
          />
        </div>
        <Table<QcCheckRow>
          rowKey={(r) => r.check.id}
          columns={columns}
          dataSource={filtered}
          loading={!checks}
          size="middle"
          scroll={{ x: 1350 }}
          pagination={{ pageSize: 15, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="Không có phiếu QC phù hợp" /> }}
        />
      </Card>

      <QcCheckModal open={modalOpen} onClose={() => setModalOpen(false)} defaultWorkOrderId={selectedWorkOrderId} />
    </div>
  );
}
