import { Alert, Badge, Card, Space, Tag, Tooltip, Typography } from 'antd';
import {
  AlertOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  DollarOutlined,
  FileDoneOutlined,
  InboxOutlined,
  LineChartOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import dayjs from 'dayjs';
import { db } from '../../db/database';
import { getDashboardData } from '../../repositories/reports';
import { formatDate, formatDateTime } from '../../utils/format';
import { formatMoney, formatMoneyShort, formatQuantity } from '../../utils/money';
import { useRole } from '../../app/RoleContext';
import styles from './Dashboard.module.scss';

export function DashboardPage() {
  const navigate = useNavigate();
  const { role } = useRole();
  const data = useLiveQuery(() => getDashboardData(), []);
  const lastUpdate = useLiveQuery(() => db.activityLogs.orderBy('at').reverse().first().then((l) => l?.at), []);

  if (!data) {
    return <Card loading />;
  }

  const showMoney = role === 'MANAGER' || role === 'PLANNER' || role === 'STOREKEEPER';
  const maxOutput = Math.max(1, ...data.output14.map((d) => d.good + d.bad));

  const kpis = [
    {
      key: 'running',
      label: 'Lệnh SX đang chạy',
      icon: <DeploymentUnitOutlined />,
      value: data.runningWorkOrders,
      hint: 'Lệnh đang ở trạng thái đang sản xuất tại các tổ',
      onClick: () => navigate('/scheduling'),
    },
    {
      key: 'today',
      label: 'Sản lượng hôm nay',
      icon: <LineChartOutlined />,
      value: formatQuantity(data.todayGood, 1),
      hint: 'Tổng sản lượng tốt ghi nhận trong ngày',
      onClick: () => navigate('/logs'),
    },
    {
      key: 'due-soon',
      label: 'Đơn đến hạn 7 ngày',
      icon: <ClockCircleOutlined />,
      value: data.dueSoonOrders,
      hint: 'Đơn chưa giao có hạn trong 7 ngày tới',
      onClick: () => navigate('/orders'),
    },
    {
      key: 'overdue',
      label: 'Đơn trễ hạn',
      icon: <AlertOutlined />,
      value: data.overdueOrders,
      hint: 'Cần ưu tiên xử lý ngay',
      danger: data.overdueOrders > 0,
      onClick: () => navigate('/orders?status=IN_PROGRESS'),
    },
    {
      key: 'qc',
      label: 'Tỷ lệ đạt QC 30 ngày',
      icon: <CheckCircleOutlined />,
      value: `${data.qcPassRate30}%`,
      hint: 'Tỷ lệ phiếu QC kết luận Đạt',
      onClick: () => navigate('/qc'),
    },
    {
      key: 'stock',
      label: 'Vật tư dưới định mức',
      icon: <InboxOutlined />,
      value: data.lowStockCount,
      hint: 'Cần nhập bổ sung để không gián đoạn sản xuất',
      danger: data.lowStockCount > 0,
      onClick: () => navigate('/materials'),
    },
  ];

  const moneyCards = [
    {
      key: 'waiting-delivery',
      label: 'Giá trị đơn chờ giao',
      icon: <DollarOutlined />,
      value: data.waitingDeliveryValueVnd,
      hint: 'Giá trị phần chưa giao của các đơn đang xử lý',
      onClick: () => navigate('/orders'),
    },
    {
      key: 'revenue',
      label: 'Doanh thu 30 ngày',
      icon: <DollarOutlined />,
      value: data.revenue30Vnd,
      hint: 'Giá trị thành phẩm đã giao trong 30 ngày',
      onClick: () => navigate('/reports?tab=progress'),
    },
    {
      key: 'material-cost',
      label: 'Chi phí NVL 30 ngày',
      icon: <DatabaseOutlined />,
      value: data.materialCost30Vnd,
      hint: 'Giá trị vật tư xuất theo lệnh sản xuất',
      onClick: () => navigate('/materials?tab=documents'),
    },
    {
      key: 'payroll',
      label: 'Lương khoán kỳ này',
      icon: <WalletOutlined />,
      value: data.payrollThisMonthVnd,
      hint: 'Σ sản lượng tốt × đơn giá công đoạn trong tháng',
      onClick: () => navigate('/payroll'),
    },
  ];

  const hasAlerts = data.overdueList.length > 0 || data.shortageList.length > 0 || data.reworkList.length > 0;

  return (
    <div>
      <div className="page-toolbar" style={{ justifyContent: 'space-between' }}>
        <Space wrap>
          <Typography.Text type="secondary">
            Số liệu theo thời điểm hiện tại · Cập nhật gần nhất: {formatDateTime(lastUpdate ?? undefined)}
          </Typography.Text>
        </Space>
        <Space wrap>
          <Badge count={data.reworkList.length} size="small">
            <Tag color={data.reworkList.length > 0 ? 'red' : 'default'}>Lệnh làm lại: {data.reworkList.length}</Tag>
          </Badge>
          <Tag color={data.qcPassRate30 >= 85 ? 'green' : 'orange'}>Tỷ lệ đạt QC: {data.qcPassRate30}%</Tag>
        </Space>
      </div>

      <div className={styles.kpiGrid}>
        {kpis.map((kpi) => (
          <div
            key={kpi.key}
            className={styles.kpiCard}
            onClick={kpi.onClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && kpi.onClick()}
          >
            <div className={styles.kpiLabel}>
              {kpi.icon} {kpi.label}
            </div>
            <div className={styles.kpiValue} style={kpi.danger ? { color: '#d64545' } : undefined}>
              {kpi.value}
            </div>
            <div className={styles.kpiHint}>{kpi.hint}</div>
          </div>
        ))}
      </div>

      {showMoney ? (
        <div className={styles.moneyRow}>
          {moneyCards.map((card) => (
            <div key={card.key} className={styles.moneyCard} onClick={card.onClick}>
              <div className={styles.moneyLabel}>
                {card.icon} {card.label}
              </div>
              <div className={styles.moneyValue}>{formatMoney(card.value)}</div>
              <div className={styles.kpiHint}>{card.hint}</div>
            </div>
          ))}
        </div>
      ) : null}

      <Card
        size="small"
        title="Sản lượng 14 ngày gần đây (tốt / lỗi)"
        style={{ marginBottom: 14 }}
        extra={
          <Space size={12}>
            <span className={styles.legend}>
              <span className={styles.legendDot} style={{ background: '#4f46e5' }} /> Tốt
            </span>
            <span className={styles.legend}>
              <span className={styles.legendDot} style={{ background: '#f0a020' }} /> Lỗi
            </span>
          </Space>
        }
      >
        <div className={styles.chart}>
          {data.output14.map((day) => {
            const goodHeight = Math.round(((day.good || 0) / maxOutput) * 130);
            const badHeight = Math.round(((day.bad || 0) / maxOutput) * 130);
            const total = day.good + day.bad;
            return (
              <div key={day.dateKey} className={styles.chartCol}>
                <Tooltip
                  title={
                    <div>
                      <div>
                        <strong>{formatDate(day.dateKey)}</strong>
                      </div>
                      <div>Sản lượng tốt: {formatQuantity(day.good, 1)}</div>
                      <div>Sản lượng lỗi: {formatQuantity(day.bad, 1)}</div>
                      <div>Tổng ghi nhận: {formatQuantity(total, 1)}</div>
                    </div>
                  }
                >
                  <div className={styles.bars}>
                    <div className={styles.barBad} style={{ height: Math.max(day.bad > 0 ? 3 : 0, badHeight) }} />
                    <div className={styles.barGood} style={{ height: Math.max(day.good > 0 ? 3 : 0, goodHeight) }} />
                  </div>
                </Tooltip>
                <div className={styles.chartLabel}>{dayjs(day.dateKey).format('DD/MM')}</div>
                <div className={styles.chartValue}>{formatQuantity(total, 0)}</div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className={styles.columns}>
        <div>
          <Card title="Lệnh sản xuất theo công đoạn hiện tại" size="small" style={{ marginBottom: 14 }}>
            {data.stageCounts.length === 0 ? (
              <Alert type="info" showIcon title="Chưa có lệnh sản xuất nào đang chạy tại các tổ." />
            ) : (
              data.stageCounts.map((stage) => (
                <div key={stage.teamId} className={styles.stageRow} onClick={() => navigate(`/scheduling?team=${stage.teamId}`)}>
                  <div>
                    <div className="text-strong">{stage.teamName}</div>
                    <div className="text-muted">
                      {stage.running} đang làm · {stage.count - stage.running} chờ bắt đầu
                    </div>
                  </div>
                  <span className={styles.kpiValue} style={{ fontSize: 18 }}>
                    {stage.count}
                  </span>
                </div>
              ))
            )}
          </Card>

          <Card title="Cảnh báo cần xử lý" size="small">
            {!hasAlerts ? (
              <Alert type="success" showIcon title="Không có cảnh báo. Đơn hàng và vật tư đang trong tầm kiểm soát." />
            ) : (
              <Space orientation="vertical" style={{ width: '100%' }} size={4}>
                {data.overdueList.map((row) => (
                  <div key={row.orderId} className={styles.alertItem}>
                    <AlertOutlined style={{ color: '#d64545', marginTop: 3 }} />
                    <div>
                      <a onClick={() => navigate(`/orders/${row.orderId}`)}>
                        <strong>{row.code}</strong> — {row.customerName} trễ {row.daysLate} ngày
                      </a>
                      <div className="text-muted">
                        Hạn giao {formatDate(row.dueDate)} · giá trị {formatMoneyShort(row.valueVnd)}
                      </div>
                    </div>
                  </div>
                ))}
                {data.shortageList.map((row, idx) => (
                  <div key={`${row.workOrderId}-${idx}`} className={styles.alertItem}>
                    <InboxOutlined style={{ color: '#e8930c', marginTop: 3 }} />
                    <div>
                      <a onClick={() => navigate(`/work-orders/${row.workOrderId}`)}>
                        Thiếu <strong>{formatQuantity(row.missingQty, 2)}</strong> {row.unit} {row.materialName}
                      </a>
                      <div className="text-muted">
                        Lệnh {row.workOrderCode} — {row.productName}
                      </div>
                    </div>
                  </div>
                ))}
                {data.reworkList.map((row) => (
                  <div key={row.workOrderId} className={styles.alertItem}>
                    <FileDoneOutlined style={{ color: '#d64545', marginTop: 3 }} />
                    <div>
                      <a onClick={() => navigate(`/work-orders/${row.workOrderId}`)}>
                        Lệnh <strong>{row.code}</strong> đã làm lại {row.reworkCount} lần
                      </a>
                      <div className="text-muted">
                        {row.productName} · hạn {formatDate(row.dueDate)}
                      </div>
                    </div>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </div>

        <div>
          <Card title="Hoạt động gần đây" size="small">
            <div>
              {data.recentActivities.map((item) => (
                <div key={item.id} className={styles.activityRow}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Tooltip title={item.summary}>
                      <span className={styles.activityText}>{item.summary}</span>
                    </Tooltip>
                    <span className="text-muted">
                      {formatDateTime(item.at)}
                      {item.actorName ? ` · ${item.actorName}` : ''}
                    </span>
                  </div>
                  {item.entityType === 'WORK_ORDER' ? <a onClick={() => navigate(`/work-orders/${item.entityId}`)}>Mở</a> : null}
                  {item.entityType === 'SALES_ORDER' ? <a onClick={() => navigate(`/orders/${item.entityId}`)}>Mở</a> : null}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
