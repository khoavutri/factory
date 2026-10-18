import { useMemo } from 'react';
import { Button, Card, DatePicker, Empty, Progress, Select, Space, Statistic, Table, Tabs, Tag, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useLiveQuery } from 'dexie-react-hooks';
import dayjs, { type Dayjs } from 'dayjs';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { useUrlState } from '../../hooks/useUrlState';
import {
  costByWorkOrder,
  defectsByTeam,
  defectsByType,
  downloadCsv,
  leadTimeReport,
  materialCostByProduct,
  orderProgressReport,
  outputByDay,
  outputByProduct,
  outputByStage,
  outputByTeam,
  payrollByTeam,
  qualityByEmployee,
  qualityByWeek,
  runningWorkOrders,
  toCsv,
  type DefectRow,
  type LeadTimeRow,
  type OrderProgressRow,
  type OutputByDayRow,
  type QualityWeeklyRow,
} from '../../repositories/reports';
import { DATE_FORMAT, formatDate } from '../../utils/format';
import { formatMoney, formatQuantity } from '../../utils/money';
import { DEFECT_TYPE_LABEL, ORDER_STATUS_META, SHIFT_LABEL } from '../../utils/status';
import type { SalesOrderStatus } from '../../types';

type TabKey = 'output' | 'quality' | 'cost' | 'progress';

export function ReportsPage() {
  const [filters, setFilters] = useUrlState<{ tab?: string; from?: string; to?: string }>({
    tab: 'output',
    from: dayjs().subtract(29, 'day').format('YYYY-MM-DD'),
    to: dayjs().format('YYYY-MM-DD'),
  });

  const fromIso = dayjs(filters.from ?? undefined).startOf('day').toISOString();
  const toIso = dayjs(filters.to ?? undefined).endOf('day').toISOString();
  const tab = (filters.tab ?? 'output') as TabKey;

  const byDay = useLiveQuery(() => outputByDay(fromIso, toIso), [fromIso, toIso]);
  const byTeam = useLiveQuery(() => outputByTeam(fromIso, toIso), [fromIso, toIso]);
  const byStage = useLiveQuery(() => outputByStage(fromIso, toIso), [fromIso, toIso]);
  const byProduct = useLiveQuery(() => outputByProduct(fromIso, toIso), [fromIso, toIso]);
  const qualityWeeks = useLiveQuery(() => qualityByWeek(fromIso, toIso), [fromIso, toIso]);
  const defects = useLiveQuery(() => defectsByType(fromIso, toIso), [fromIso, toIso]);
  const defectTeams = useLiveQuery(() => defectsByTeam(fromIso, toIso), [fromIso, toIso]);
  const qualityEmployees = useLiveQuery(() => qualityByEmployee(fromIso, toIso), [fromIso, toIso]);
  const materialCosts = useLiveQuery(() => materialCostByProduct(fromIso, toIso), [fromIso, toIso]);
  const costs = useLiveQuery(() => costByWorkOrder(fromIso, toIso), [fromIso, toIso]);
  const payrollTeams = useLiveQuery(() => payrollByTeam(fromIso, toIso), [fromIso, toIso]);
  const leadTime = useLiveQuery(() => leadTimeReport(fromIso, toIso), [fromIso, toIso]);
  const progress = useLiveQuery(() => orderProgressReport(), []);
  const running = useLiveQuery(() => runningWorkOrders(), []);

  const outputTotals = useMemo(() => {
    const good = (byDay ?? []).reduce((s, r) => s + r.good, 0);
    const bad = (byDay ?? []).reduce((s, r) => s + r.bad, 0);
    return { good, bad, errorRate: good + bad > 0 ? Math.round((bad / (good + bad)) * 1000) / 10 : 0, amount: (byDay ?? []).reduce((s, r) => s + r.amountVnd, 0) };
  }, [byDay]);

  const costTotals = useMemo(
    () => ({
      material: (costs ?? []).reduce((s, r) => s + r.materialCostVnd, 0),
      labor: (costs ?? []).reduce((s, r) => s + r.laborCostVnd, 0),
      revenue: (costs ?? []).reduce((s, r) => s + r.revenueVnd, 0),
      total: (costs ?? []).reduce((s, r) => s + r.totalCostVnd, 0),
    }),
    [costs],
  );

  const maxDayGood = Math.max(1, ...(byDay ?? []).map((r) => r.good));
  const maxDefect = Math.max(1, ...(defects ?? []).map((r) => r.count));

  const exportCurrent = () => {
    if (tab === 'output') {
      downloadCsv(
        `bao-cao-san-luong-${filters.from}-${filters.to}.csv`,
        toCsv(byDay ?? [], [
          { key: 'dateKey', label: 'Ngày' },
          { key: 'good', label: 'SL tốt' },
          { key: 'bad', label: 'SL lỗi' },
          { key: 'logCount', label: 'Số phiếu' },
          { key: 'amountVnd', label: 'Tiền khoán' },
        ]),
      );
      return;
    }
    if (tab === 'quality') {
      downloadCsv(
        `bao-cao-chat-luong-${filters.from}-${filters.to}.csv`,
        toCsv(qualityWeeks ?? [], [
          { key: 'weekStart', label: 'Tuần bắt đầu' },
          { key: 'total', label: 'Số phiếu QC' },
          { key: 'passed', label: 'Đạt' },
          { key: 'failed', label: 'Không đạt' },
          { key: 'passRate', label: 'Tỷ lệ đạt (%)' },
        ]),
      );
      return;
    }
    if (tab === 'cost') {
      downloadCsv(
        `bao-cao-chi-phi-${filters.from}-${filters.to}.csv`,
        toCsv(costs ?? [], [
          { key: 'code', label: 'Lệnh SX' },
          { key: 'productName', label: 'Sản phẩm' },
          { key: 'quantity', label: 'SL' },
          { key: 'materialCostVnd', label: 'Chi phí NVL' },
          { key: 'laborCostVnd', label: 'Lương khoán' },
          { key: 'totalCostVnd', label: 'Tổng chi phí' },
          { key: 'unitCostVnd', label: 'Giá thành/đơn vị' },
          { key: 'revenueVnd', label: 'Giá trị theo giá bán' },
          { key: 'marginVnd', label: 'Chênh lệch' },
        ]),
      );
      return;
    }
    downloadCsv(
      `bao-cao-tien-do-${filters.from}-${filters.to}.csv`,
      toCsv(progress ?? [], [
        { key: 'code', label: 'Đơn hàng' },
        { key: 'customerName', label: 'Khách hàng' },
        { key: 'status', label: 'Trạng thái' },
        { key: 'dueDate', label: 'Hạn giao' },
        { key: 'progressPct', label: 'Tiến độ (%)' },
        { key: 'workOrdersTotal', label: 'Số lệnh SX' },
        { key: 'workOrdersDone', label: 'Lệnh hoàn thành' },
        { key: 'overdue', label: 'Trễ hạn' },
      ]),
    );
  };

  const items = [
    {
      key: 'output',
      label: 'Sản lượng',
      children: (
        <Space orientation="vertical" style={{ width: '100%' }} size={12}>
          <Card size="small">
            <Space size={40} wrap>
              <Statistic title="Sản lượng tốt" value={formatQuantity(outputTotals.good)} />
              <Statistic title="Sản lượng lỗi" value={formatQuantity(outputTotals.bad)} styles={{ content: { color: '#d64545' } }} />
              <Statistic title="Tỷ lệ lỗi" value={outputTotals.errorRate} suffix="%" />
              <Statistic title="Tiền khoán ghi nhận" value={formatMoney(outputTotals.amount)} />
            </Space>
          </Card>
          <Card size="small" title="Sản lượng theo ngày">
            <Table
              rowKey="dateKey"
              size="small"
              pagination={{ pageSize: 15, showSizeChanger: false }}
              dataSource={byDay ?? []}
              locale={{ emptyText: <Empty description="Không có sản lượng trong kỳ" /> }}
              columns={[
                { title: 'Ngày', key: 'date', width: 120, render: (_, r: OutputByDayRow) => formatDate(r.dateKey) },
                { title: 'SL tốt', dataIndex: 'good', key: 'good', width: 110, align: 'right', render: (v: number) => formatQuantity(v) },
                { title: 'SL lỗi', dataIndex: 'bad', key: 'bad', width: 100, align: 'right', render: (v: number) => formatQuantity(v) },
                { title: 'Số phiếu', dataIndex: 'logCount', key: 'logs', width: 100, align: 'center' },
                { title: 'Tiền khoán', dataIndex: 'amountVnd', key: 'amount', width: 160, align: 'right', render: (v: number) => formatMoney(v) },
                {
                  title: 'Tỷ trọng',
                  key: 'bar',
                  render: (_, r: OutputByDayRow) => <Progress percent={Math.round((r.good / maxDayGood) * 100)} showInfo={false} strokeColor="#4f46e5" />,
                },
              ]}
            />
          </Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
            <Card size="small" title="Theo tổ">
              <Table
                rowKey="teamId"
                size="small"
                pagination={false}
                dataSource={byTeam ?? []}
                columns={[
                  { title: 'Tổ', dataIndex: 'teamName', key: 'team' },
                  { title: 'SL tốt', dataIndex: 'good', key: 'good', width: 100, align: 'right', render: (v: number) => formatQuantity(v) },
                  { title: 'SL lỗi', dataIndex: 'bad', key: 'bad', width: 90, align: 'right', render: (v: number) => formatQuantity(v) },
                  { title: 'Tỷ lệ lỗi', dataIndex: 'errorRate', key: 'rate', width: 100, align: 'right', render: (v: number) => `${v}%` },
                  { title: 'Tiền khoán', dataIndex: 'amountVnd', key: 'amount', width: 150, align: 'right', render: (v: number) => formatMoney(v) },
                ]}
              />
            </Card>
            <Card size="small" title="Theo công đoạn">
              <Table
                rowKey="stageName"
                size="small"
                pagination={false}
                dataSource={byStage ?? []}
                columns={[
                  { title: 'Công đoạn', dataIndex: 'stageName', key: 'stage' },
                  { title: 'Tổ', dataIndex: 'teamName', key: 'team', width: 160 },
                  { title: 'SL tốt', dataIndex: 'good', key: 'good', width: 100, align: 'right', render: (v: number) => formatQuantity(v) },
                  { title: 'SL lỗi', dataIndex: 'bad', key: 'bad', width: 90, align: 'right', render: (v: number) => formatQuantity(v) },
                  { title: 'Tiền khoán', dataIndex: 'amountVnd', key: 'amount', width: 150, align: 'right', render: (v: number) => formatMoney(v) },
                ]}
              />
            </Card>
            <Card size="small" title="Theo sản phẩm">
              <Table
                rowKey="productId"
                size="small"
                pagination={false}
                dataSource={byProduct ?? []}
                columns={[
                  { title: 'Sản phẩm', dataIndex: 'productName', key: 'product' },
                  { title: 'SL tốt ghi nhận', dataIndex: 'good', key: 'good', width: 140, align: 'right', render: (v: number) => formatQuantity(v) },
                  { title: 'SL lỗi', dataIndex: 'bad', key: 'bad', width: 90, align: 'right', render: (v: number) => formatQuantity(v) },
                  {
                    title: 'SL lệnh hoàn thành',
                    dataIndex: 'goodQtyCompleted',
                    key: 'completed',
                    width: 160,
                    align: 'right',
                    render: (v: number) => formatQuantity(v),
                  },
                ]}
              />
            </Card>
          </div>
        </Space>
      ),
    },
    {
      key: 'quality',
      label: 'Chất lượng',
      children: (
        <Space orientation="vertical" style={{ width: '100%' }} size={12}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
            <Card size="small" title="Tỷ lệ đạt theo tuần">
              <Table
                rowKey="weekStart"
                size="small"
                pagination={false}
                dataSource={qualityWeeks ?? []}
                locale={{ emptyText: 'Không có phiếu QC trong kỳ' }}
                columns={[
                  { title: 'Tuần', key: 'week', width: 130, render: (_, r: QualityWeeklyRow) => `Từ ${formatDate(r.weekStart)}` },
                  { title: 'Số phiếu', dataIndex: 'total', key: 'total', width: 90, align: 'center' },
                  { title: 'Đạt', dataIndex: 'passed', key: 'passed', width: 80, align: 'center' },
                  { title: 'Không đạt', dataIndex: 'failed', key: 'failed', width: 100, align: 'center' },
                  {
                    title: 'Tỷ lệ đạt',
                    key: 'rate',
                    render: (_, r: QualityWeeklyRow) => <Progress percent={r.passRate} size="small" status={r.passRate >= 85 ? 'success' : 'exception'} />,
                  },
                ]}
              />
            </Card>
            <Card size="small" title="Lỗi theo loại">
              {defects && defects.length > 0 ? (
                <Table
                  rowKey="defectType"
                  size="small"
                  pagination={false}
                  dataSource={defects}
                  columns={[
                    { title: 'Loại lỗi', key: 'type', render: (_, r: DefectRow) => DEFECT_TYPE_LABEL[r.defectType] },
                    { title: 'Số phiếu', dataIndex: 'count', key: 'count', width: 90, align: 'center' },
                    { title: 'SL lỗi', dataIndex: 'failedQty', key: 'qty', width: 90, align: 'right', render: (v: number) => formatQuantity(v) },
                    {
                      title: 'Tỷ trọng',
                      key: 'bar',
                      render: (_, r: DefectRow) => <Progress percent={Math.round((r.count / maxDefect) * 100)} showInfo={false} strokeColor="#e8930c" />,
                    },
                  ]}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có lỗi trong kỳ" />
              )}
            </Card>
            <Card size="small" title="Lỗi theo tổ">
              <Table
                rowKey="teamName"
                size="small"
                pagination={false}
                dataSource={defectTeams ?? []}
                locale={{ emptyText: 'Không có dữ liệu' }}
                columns={[
                  { title: 'Tổ', dataIndex: 'teamName', key: 'team' },
                  { title: 'Số phiếu QC', dataIndex: 'total', key: 'total', width: 110, align: 'center' },
                  { title: 'Số phiếu không đạt', dataIndex: 'failed', key: 'failed', width: 150, align: 'center' },
                  { title: 'SL lỗi', dataIndex: 'failedQty', key: 'qty', width: 100, align: 'right', render: (v: number) => formatQuantity(v) },
                ]}
              />
            </Card>
            <Card size="small" title="Chất lượng theo nhân viên (tỷ lệ lỗi)">
              <Table
                rowKey="employeeName"
                size="small"
                pagination={{ pageSize: 10, showSizeChanger: false }}
                dataSource={qualityEmployees ?? []}
                columns={[
                  { title: 'Nhân viên', dataIndex: 'employeeName', key: 'name' },
                  { title: 'SL tốt', dataIndex: 'good', key: 'good', width: 100, align: 'right', render: (v: number) => formatQuantity(v) },
                  { title: 'SL lỗi', dataIndex: 'bad', key: 'bad', width: 90, align: 'right', render: (v: number) => formatQuantity(v) },
                  {
                    title: 'Tỷ lệ lỗi',
                    dataIndex: 'errorRate',
                    key: 'rate',
                    width: 110,
                    align: 'right',
                    render: (v: number) => <Tag color={v > 5 ? 'red' : 'green'}>{v}%</Tag>,
                  },
                ]}
              />
            </Card>
          </div>
        </Space>
      ),
    },
    {
      key: 'cost',
      label: 'Chi phí',
      children: (
        <Space orientation="vertical" style={{ width: '100%' }} size={12}>
          <Card size="small">
            <Space size={40} wrap>
              <Statistic title="Chi phí NVL (theo lệnh)" value={formatMoney(costTotals.material)} />
              <Statistic title="Lương khoán theo lệnh" value={formatMoney(costTotals.labor)} />
              <Statistic title="Tổng chi phí ước tính" value={formatMoney(costTotals.total)} />
              <Statistic title="Giá trị theo giá bán" value={formatMoney(costTotals.revenue)} />
              <Statistic
                title="Chênh lệch"
                value={formatMoney(costTotals.revenue - costTotals.total)}
                styles={{ content: { color: costTotals.revenue - costTotals.total >= 0 ? '#2f9e44' : '#d64545' } }}
              />
            </Space>
          </Card>
          <Card size="small" title="Chi phí theo lệnh sản xuất">
            <Table
              rowKey="workOrderId"
              size="small"
              pagination={{ pageSize: 15, showSizeChanger: false }}
              dataSource={costs ?? []}
              scroll={{ x: 1150 }}
              locale={{ emptyText: <Empty description="Không có lệnh nào trong kỳ" /> }}
              columns={[
                { title: 'Lệnh', dataIndex: 'code', key: 'code', width: 170 },
                { title: 'Sản phẩm', dataIndex: 'productName', key: 'product' },
                { title: 'SL', dataIndex: 'quantity', key: 'qty', width: 80, align: 'right', render: (v: number) => formatQuantity(v) },
                { title: 'Chi phí NVL', dataIndex: 'materialCostVnd', key: 'material', width: 150, align: 'right', render: (v: number) => formatMoney(v) },
                { title: 'Lương khoán', dataIndex: 'laborCostVnd', key: 'labor', width: 140, align: 'right', render: (v: number) => formatMoney(v) },
                { title: 'Tổng chi phí', dataIndex: 'totalCostVnd', key: 'total', width: 150, align: 'right', render: (v: number) => <strong>{formatMoney(v)}</strong> },
                { title: 'Giá thành/đơn vị', dataIndex: 'unitCostVnd', key: 'unit', width: 150, align: 'right', render: (v: number) => formatMoney(v) },
                { title: 'Giá trị theo giá bán', dataIndex: 'revenueVnd', key: 'revenue', width: 170, align: 'right', render: (v: number) => formatMoney(v) },
                {
                  title: 'Chênh lệch',
                  dataIndex: 'marginVnd',
                  key: 'margin',
                  width: 150,
                  align: 'right',
                  render: (v: number) => <span style={{ color: v >= 0 ? '#2f9e44' : '#d64545' }}>{formatMoney(v)}</span>,
                },
              ]}
            />
          </Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
            <Card size="small" title="Chi phí NVL theo sản phẩm">
              <Table
                rowKey="productId"
                size="small"
                pagination={false}
                dataSource={materialCosts ?? []}
                locale={{ emptyText: 'Không có phiếu cấp vật tư trong kỳ' }}
                columns={[
                  { title: 'Sản phẩm', dataIndex: 'productName', key: 'product' },
                  { title: 'SL sản xuất', dataIndex: 'producedQty', key: 'qty', width: 110, align: 'right', render: (v: number) => formatQuantity(v) },
                  { title: 'Chi phí NVL', dataIndex: 'materialCostVnd', key: 'cost', width: 160, align: 'right', render: (v: number) => formatMoney(v) },
                  { title: 'NVL/đơn vị', dataIndex: 'unitCostVnd', key: 'unit', width: 140, align: 'right', render: (v: number) => formatMoney(v) },
                ]}
              />
            </Card>
            <Card size="small" title="Lương khoán theo tổ">
              <Table
                rowKey="teamId"
                size="small"
                pagination={false}
                dataSource={payrollTeams ?? []}
                columns={[
                  { title: 'Tổ', dataIndex: 'teamName', key: 'team' },
                  { title: 'SL tốt', dataIndex: 'quantityGood', key: 'good', width: 110, align: 'right', render: (v: number) => formatQuantity(v) },
                  { title: 'Số nhân viên', dataIndex: 'employeeCount', key: 'emp', width: 120, align: 'center' },
                  { title: 'Tiền khoán', dataIndex: 'amountVnd', key: 'amount', width: 160, align: 'right', render: (v: number) => formatMoney(v) },
                ]}
              />
            </Card>
          </div>
        </Space>
      ),
    },
    {
      key: 'progress',
      label: 'Tiến độ',
      children: (
        <Space orientation="vertical" style={{ width: '100%' }} size={12}>
          <Card size="small">
            <Space size={40} wrap>
              <Statistic title="Đơn trễ hạn" value={(progress ?? []).filter((r) => r.overdue).length} styles={{ content: { color: '#d64545' } }} />
              <Statistic title="Lead time trung bình (ngày)" value={leadTime?.averageDays ?? '—'} />
              <Statistic title="Lệnh đang chạy tại xưởng" value={(running ?? []).length} />
              <Statistic title="Đơn đang xử lý" value={(progress ?? []).filter((r) => r.status !== 'DELIVERED' && r.status !== 'CANCELLED').length} />
            </Space>
          </Card>
          <Card size="small" title="Tiến độ đơn hàng">
            <Table
              rowKey="orderId"
              size="small"
              pagination={{ pageSize: 15, showSizeChanger: false }}
              dataSource={progress ?? []}
              locale={{ emptyText: <Empty description="Không có đơn hàng" /> }}
              columns={[
                { title: 'Đơn hàng', dataIndex: 'code', key: 'code', width: 170 },
                { title: 'Khách hàng', dataIndex: 'customerName', key: 'customer' },
                {
                  title: 'Trạng thái',
                  key: 'status',
                  width: 140,
                  render: (_, r: OrderProgressRow) => <StatusTag kind="order" status={r.status} />,
                },
                { title: 'Hạn giao', key: 'due', width: 120, render: (_, r: OrderProgressRow) => formatDate(r.dueDate) },
                {
                  title: 'Tiến độ',
                  key: 'progress',
                  width: 190,
                  render: (_, r: OrderProgressRow) => <Progress percent={r.progressPct} size="small" status={r.overdue ? 'exception' : 'normal'} />,
                },
                {
                  title: 'Lệnh SX',
                  key: 'workOrders',
                  width: 120,
                  align: 'center',
                  render: (_, r: OrderProgressRow) => `${r.workOrdersDone}/${r.workOrdersTotal}`,
                },
                { title: '', key: 'flag', width: 110, render: (_, r: OrderProgressRow) => (r.overdue ? <Tag color="red">Trễ hạn</Tag> : <Tag color="green">Đúng hạn</Tag>) },
              ]}
            />
          </Card>
          <Card size="small" title="Lead time giao hàng (từ duyệt đơn đến giao) và lệnh đang chạy">
            <Table
              rowKey="orderId"
              size="small"
              pagination={{ pageSize: 10, showSizeChanger: false }}
              dataSource={(leadTime?.rows ?? []).filter((r) => r.deliveredAt)}
              locale={{ emptyText: 'Chưa có đơn giao trong kỳ' }}
              columns={[
                { title: 'Đơn', dataIndex: 'code', key: 'code', width: 170 },
                { title: 'Khách', dataIndex: 'customerName', key: 'customer' },
                { title: 'Duyệt lúc', key: 'approved', width: 130, render: (_, r: LeadTimeRow) => formatDate(r.approvedAt) },
                { title: 'Giao lúc', key: 'delivered', width: 130, render: (_, r: LeadTimeRow) => formatDate(r.deliveredAt) },
                { title: 'Lead time', key: 'lead', width: 120, align: 'right', render: (_, r: LeadTimeRow) => (r.leadTimeDays != null ? `${r.leadTimeDays} ngày` : '—') },
                { title: 'Trễ so với hạn', key: 'late', width: 140, align: 'right', render: (_, r: LeadTimeRow) => (r.lateDays > 0 ? <Tag color="red">{r.lateDays} ngày</Tag> : '0') },
              ]}
            />
            <Typography.Title level={5} style={{ marginTop: 16 }}>
              Lệnh đang chờ/đang sản xuất
            </Typography.Title>
            <Table
              rowKey="workOrderId"
              size="small"
              pagination={{ pageSize: 10, showSizeChanger: false }}
              dataSource={running ?? []}
              scroll={{ x: 1000 }}
              locale={{ emptyText: 'Không có lệnh nào đang chạy' }}
              columns={[
                { title: 'Lệnh', dataIndex: 'code', key: 'code', width: 170 },
                { title: 'Sản phẩm', dataIndex: 'productName', key: 'product' },
                { title: 'SL', dataIndex: 'quantity', key: 'qty', width: 80, align: 'right', render: (v: number) => formatQuantity(v) },
                { title: 'Tổ hiện tại', dataIndex: 'teamName', key: 'team', width: 170 },
                { title: 'Công đoạn', dataIndex: 'stageName', key: 'stage', width: 160 },
                { title: 'Hạn', key: 'due', width: 120, render: (_, r: { dueDate: string }) => formatDate(r.dueDate) },
                { title: 'Làm lại', dataIndex: 'reworkCount', key: 'rework', width: 100, align: 'center', render: (v: number) => (v > 0 ? <Tag color="red">{v}</Tag> : 0) },              ]}
            />
          </Card>
          <Card size="small" title="Ghi chú nghiệp vụ">
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              Lead time = số ngày từ khi duyệt đơn đến lần giao hàng đầu tiên. Cột trạng thái dùng cùng bộ nhãn với màn Đơn hàng (
              {Object.values(ORDER_STATUS_META)
                .map((m) => m.label)
                .join(' / ')}
              ). Ca làm việc được ghi trên phiếu sản lượng: {Object.values(SHIFT_LABEL).join(', ')}.
            </Typography.Paragraph>
          </Card>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Báo cáo"
        subtitle="Sản lượng, chất lượng, chi phí và tiến độ theo khoảng ngày; mỗi bảng xuất CSV để gửi đối tác hoặc lưu hồ sơ."
        extra={[
          <DatePicker
            key="from"
            placeholder="Từ ngày"
            format={DATE_FORMAT}
            value={filters.from ? dayjs(filters.from) : null}
            onChange={(value: Dayjs | null) => setFilters({ from: value ? value.format('YYYY-MM-DD') : undefined })}
          />,
          <DatePicker
            key="to"
            placeholder="Đến ngày"
            format={DATE_FORMAT}
            value={filters.to ? dayjs(filters.to) : null}
            onChange={(value: Dayjs | null) => setFilters({ to: value ? value.format('YYYY-MM-DD') : undefined })}
          />,
          <Select
            key="range"
            style={{ width: 170 }}
            value="custom"
            onChange={(value) => {
              if (value === '7') setFilters({ from: dayjs().subtract(6, 'day').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') });
              if (value === '30') setFilters({ from: dayjs().subtract(29, 'day').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') });
              if (value === '90') setFilters({ from: dayjs().subtract(89, 'day').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') });
            }}
            options={[
              { value: 'custom', label: 'Khoảng tự chọn' },
              { value: '7', label: '7 ngày gần đây' },
              { value: '30', label: '30 ngày gần đây' },
              { value: '90', label: '90 ngày gần đây' },
            ]}
          />,
          <Button key="export" icon={<DownloadOutlined />} onClick={exportCurrent}>
            Xuất CSV tab đang xem
          </Button>,
        ]}
      />
      <Tabs activeKey={tab} onChange={(key) => setFilters({ tab: key })} items={items} />
      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
        Khoảng ngày đang xem: {formatDate(fromIso)} — {formatDate(toIso)}. Trạng thái đơn hiển thị theo bộ nhãn{' '}
        {(Object.keys(ORDER_STATUS_META) as SalesOrderStatus[]).length} giá trị của đơn hàng.
      </Typography.Paragraph>
    </div>
  );
}
