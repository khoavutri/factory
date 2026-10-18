import { useMemo, useState } from 'react';
import { Alert, Button, Card, DatePicker, Empty, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { CheckCircleOutlined, DownloadOutlined } from '@ant-design/icons';
import { useLiveQuery } from 'dexie-react-hooks';
import dayjs, { type Dayjs } from 'dayjs';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { useRole } from '../../app/RoleContext';
import { useAction } from '../../hooks/useAction';
import { db } from '../../db/database';
import { downloadCsv, toCsv } from '../../repositories/reports';
import { computePayroll, lockPayrollPeriod, type PayrollRow } from '../../services/payroll';
import { formatMoney, formatQuantity } from '../../utils/money';
import { formatDateTime, monthRange } from '../../utils/format';

export function PayrollPage() {
  const { actor } = useRole();
  const { loading, run } = useAction();
  const [monthKey, setMonthKey] = useState(dayjs().format('YYYY-MM'));
  const [expanded, setExpanded] = useState(false);

  const range = useMemo(() => monthRange(monthKey), [monthKey]);
  const periods = useLiveQuery(() => db.payrollPeriods.toArray(), []);
  const teams = useLiveQuery(() => db.teams.toArray(), []);
  const computation = useLiveQuery(() => computePayroll(range.from, range.to), [range.from, range.to]);

  const currentPeriod = (periods ?? []).find((p) => p.periodKey === monthKey);
  const isLocked = currentPeriod?.status === 'LOCKED';
  const teamById = useMemo(() => new Map((teams ?? []).map((t) => [t.id, t])), [teams]);

  const rowsWithTeam = useMemo(
    () =>
      (computation?.rows ?? []).map((row) => ({
        ...row,
        teamName: row.teamId ? teamById.get(row.teamId)?.name ?? '—' : '—',
      })),
    [computation, teamById],
  );

  const columns: TableColumnsType<PayrollRow & { teamName: string }> = [
    { title: 'Mã NV', dataIndex: 'employeeCode', key: 'code', width: 110 },
    { title: 'Nhân viên', dataIndex: 'employeeName', key: 'name' },
    { title: 'Tổ', dataIndex: 'teamName', key: 'team', width: 170 },
    { title: 'Số phiếu', dataIndex: 'logCount', key: 'logs', width: 100, align: 'center' },
    { title: 'SL tốt', key: 'good', width: 110, align: 'right', render: (_, row) => formatQuantity(row.quantityGood) },
    {
      title: 'SL lỗi',
      key: 'bad',
      width: 100,
      align: 'right',
      render: (_, row) => (row.quantityBad > 0 ? <span style={{ color: '#d64545' }}>{formatQuantity(row.quantityBad)}</span> : 0),
    },
    { title: 'Thành tiền khoán', key: 'amount', width: 180, align: 'right', render: (_, row) => <strong>{formatMoney(row.amountVnd)}</strong> },
  ];

  return (
    <div>
      <PageHeader
        title="Lương khoán"
        subtitle="Tính theo kỳ tháng: Σ sản lượng tốt theo từng công đoạn × đơn giá khoán của công đoạn đó."
        extra={[
          <DatePicker
            key="month"
            picker="month"
            value={dayjs(`${monthKey}-01`)}
            allowClear={false}
            onChange={(value: Dayjs | null) => setMonthKey((value ?? dayjs()).format('YYYY-MM'))}
          />,
          <Button
            key="csv"
            icon={<DownloadOutlined />}
            onClick={() =>
              downloadCsv(
                `luong-khoan-${monthKey}.csv`,
                toCsv(
                  rowsWithTeam.map((r) => ({
                    code: r.employeeCode,
                    name: r.employeeName,
                    team: r.teamName,
                    logs: r.logCount,
                    good: r.quantityGood,
                    bad: r.quantityBad,
                    amount: r.amountVnd,
                  })),
                  [
                    { key: 'code', label: 'Mã NV' },
                    { key: 'name', label: 'Nhân viên' },
                    { key: 'team', label: 'Tổ' },
                    { key: 'logs', label: 'Số phiếu' },
                    { key: 'good', label: 'SL tốt' },
                    { key: 'bad', label: 'SL lỗi' },
                    { key: 'amount', label: 'Thành tiền khoán' },
                  ],
                ),
              )
            }
          >
            Xuất CSV
          </Button>,
          currentPeriod && currentPeriod.status === 'OPEN' ? (
            <Button
              key="lock"
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={loading}
              onClick={() =>
                void run(
                  (op) =>
                    lockPayrollPeriod(actor, { periodKey: monthKey, from: range.from, to: range.to }, { operationId: op }),
                  { successMessage: `Đã chốt kỳ lương ${monthKey}` },
                )
              }
            >
              Chốt kỳ lương
            </Button>
          ) : null,
          !currentPeriod && computation && computation.rows.length > 0 ? (
            <Button
              key="lock-open"
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={loading}
              onClick={() =>
                void run(
                  (op) =>
                    lockPayrollPeriod(actor, { periodKey: monthKey, from: range.from, to: range.to }, { operationId: op }),
                  { successMessage: `Đã chốt kỳ lương ${monthKey}` },
                )
              }
            >
              Chốt kỳ lương
            </Button>
          ) : null,
        ]}
      />

      {currentPeriod ? (
        <Alert
          style={{ marginBottom: 12 }}
          type={isLocked ? 'success' : 'info'}
          showIcon
          title={
            <Space wrap>
              <span>
                Kỳ {currentPeriod.periodKey} — mã {currentPeriod.code}
              </span>
              <StatusTag kind="payroll" status={currentPeriod.status} />
              {isLocked ? (
                <span className="text-muted">
                  Chốt lúc {formatDateTime(currentPeriod.lockedAt)} · tổng {formatMoney(currentPeriod.totalVnd)} (số liệu đã lưu snapshot)
                </span>
              ) : (
                <span className="text-muted">Kỳ đang mở — số liệu tính trực tiếp từ phiếu sản lượng.</span>
              )}
            </Space>
          }
          description={
            isLocked
              ? 'Kỳ đã chốt không tính lại; nếu cần điều chỉnh hãy ghi phiếu bù ở kỳ sau hoặc liên hệ quản trị để khôi phục dữ liệu.'
              : 'Khi chốt kỳ, hệ thống lưu snapshot lương từng nhân viên vào bảng payrollLines và không cho chốt lại kỳ này.'
          }
        />
      ) : (
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          title="Kỳ này chưa được chốt"
          description="Số liệu bên dưới được tính trực tiếp từ phiếu sản lượng trong tháng. Chốt kỳ để lưu snapshot lương."
        />
      )}

      <Card size="small" style={{ marginBottom: 14 }}>
        <Space size={40} wrap>
          <Statistic title="Tổng lương khoán kỳ này" value={formatMoney(computation?.totalVnd ?? 0)} />
          <Statistic title="Sản lượng tốt" value={formatQuantity(computation?.totalGood ?? 0)} />
          <Statistic title="Sản lượng lỗi" value={formatQuantity(computation?.totalBad ?? 0)} styles={{ content: { color: '#d64545' } }} />
          <Statistic title="Số phiếu sản lượng" value={computation?.logCount ?? 0} />
          <Statistic title="Số nhân viên có lương" value={rowsWithTeam.length} />
        </Space>
      </Card>

      <Card size="small" title={`Bảng lương khoán ${range.label}`}>
        <div className="page-toolbar">
          <Button size="small" type={expanded ? 'primary' : 'default'} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Thu gọn chi tiết công đoạn' : 'Mở rộng chi tiết công đoạn'}
          </Button>
          <Typography.Text type="secondary">Bấm vào dòng để xem chi tiết theo công đoạn (SL × đơn giá khoán).</Typography.Text>
        </div>
        <Table<PayrollRow & { teamName: string }>
          rowKey="employeeId"
          columns={columns}
          dataSource={rowsWithTeam}
          loading={!computation}
          size="middle"
          scroll={{ x: 1000 }}
          pagination={false}
          locale={{ emptyText: <Empty description="Kỳ này chưa có phiếu sản lượng nào" /> }}
          expandable={{
            expandedRowKeys: expanded ? undefined : [],
            expandedRowRender: (row) => (
              <Table
                rowKey="stageId"
                size="small"
                pagination={false}
                dataSource={row.details}
                columns={[
                  { title: 'Công đoạn', dataIndex: 'stageName', key: 'stage' },
                  { title: 'Tổ', key: 'team', render: (_, d) => teamById.get(d.teamId)?.name ?? '—' },
                  { title: 'Đơn giá khoán', key: 'rate', width: 150, align: 'right', render: (_, d) => formatMoney(d.pieceRateVnd) },
                  { title: 'SL tốt', key: 'good', width: 110, align: 'right', render: (_, d) => formatQuantity(d.quantityGood) },
                  { title: 'SL lỗi', key: 'bad', width: 100, align: 'right', render: (_, d) => formatQuantity(d.quantityBad) },
                  { title: 'Thành tiền', key: 'amount', width: 160, align: 'right', render: (_, d) => <strong>{formatMoney(d.amountVnd)}</strong> },
                ]}
              />
            ),
          }}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4}>
                <strong>Tổng cộng</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right">
                <strong>{formatQuantity(computation?.totalGood ?? 0)}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right">
                <strong>{formatQuantity(computation?.totalBad ?? 0)}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right">
                <strong>{formatMoney(computation?.totalVnd ?? 0)}</strong>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          Cách tính: với mỗi phiếu sản lượng, thành tiền = SL tốt × đơn giá khoán của công đoạn. Lương kỳ = tổng thành tiền các phiếu của nhân viên trong
          kỳ. Sản phẩm lỗi không tính tiền khoán nhưng vẫn theo dõi để đánh giá chất lượng.
        </Typography.Paragraph>
      </Card>

      <Card size="small" title="Lịch sử kỳ lương đã chốt" style={{ marginTop: 14 }}>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={(periods ?? []).sort((a, b) => b.periodKey.localeCompare(a.periodKey))}
          locale={{ emptyText: 'Chưa có kỳ lương nào được chốt' }}
          columns={[
            { title: 'Kỳ', dataIndex: 'periodKey', key: 'key', width: 110 },
            { title: 'Mã kỳ', dataIndex: 'code', key: 'code', width: 190 },
            { title: 'Trạng thái', key: 'status', width: 130, render: (_, p) => <StatusTag kind="payroll" status={p.status} /> },
            { title: 'Tổng lương', key: 'total', width: 170, align: 'right', render: (_, p) => formatMoney(p.totalVnd) },
            { title: 'Chốt lúc', key: 'locked', width: 170, render: (_, p) => formatDateTime(p.lockedAt) },
            {
              title: '',
              key: 'action',
              width: 120,
              render: (_, p) => (
                <Button size="small" onClick={() => setMonthKey(p.periodKey)}>
                  Xem kỳ
                </Button>
              ),
            },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          <Tag color="green">Đã chốt</Tag> lưu số liệu tại thời điểm chốt để đối chiếu về sau; kỳ tháng hiện tại ở trạng thái mở và cập nhật theo phiếu sản
          lượng mới.
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
