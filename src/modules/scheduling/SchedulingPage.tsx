import { useMemo, useState } from 'react';
import { App, Button, Card, Empty, Input, Progress, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { CheckCircleOutlined, PlayCircleOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { useRole } from '../../app/RoleContext';
import { useAction } from '../../hooks/useAction';
import { useUrlState } from '../../hooks/useUrlState';
import { db } from '../../db/database';
import { kanbanCards, type KanbanCard } from '../../repositories/reports';
import { completeWorkOrderStage, startWorkOrderStage } from '../../services/production';
import { formatDate, formatDateTime, formatMinutes } from '../../utils/format';
import { formatQuantity } from '../../utils/money';
import { WORK_ORDER_PRIORITY_META } from '../../utils/status';
import type { WorkOrderPriority } from '../../types';
import styles from './Scheduling.module.scss';

export function SchedulingPage() {
  const navigate = useNavigate();
  const { actor, role } = useRole();
  const { message } = App.useApp();
  const { loading, run } = useAction();
  const [filters, setFilters] = useUrlState<{ team?: string; priority?: string; q?: string }>({});
  const [keyword, setKeyword] = useState(filters.q ?? '');

  const cards = useLiveQuery(() => kanbanCards(), []);
  const teams = useLiveQuery(() => db.teams.filter((t) => t.active).toArray(), []);
  const logs = useLiveQuery(() => db.productionLogs.toArray(), []);

  const canRun = role === 'MANAGER' || role === 'SUPERVISOR';

  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    return (cards ?? []).filter((card) => {
      if (filters.priority && card.workOrder.priority !== filters.priority) return false;
      if (key) {
        const haystack = `${card.workOrder.code} ${card.productName} ${card.orderCode} ${card.customerName} ${card.stage.name}`.toLowerCase();
        if (!haystack.includes(key)) return false;
      }
      return true;
    });
  }, [cards, filters.priority, keyword]);

  const byTeam = useMemo(() => {
    const map = new Map<string, KanbanCard[]>();
    for (const team of teams ?? []) map.set(team.id, []);
    for (const card of filtered) {
      const list = map.get(card.stage.teamId) ?? [];
      list.push(card);
      map.set(card.stage.teamId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const weight: Record<WorkOrderPriority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
        const diff = weight[a.workOrder.priority] - weight[b.workOrder.priority];
        if (diff !== 0) return diff;
        return a.workOrder.dueDate.localeCompare(b.workOrder.dueDate);
      });
    }
    return map;
  }, [filtered, teams]);

  const visibleTeams = (teams ?? []).filter((team) => (filters.team ? team.id === filters.team : true));

  const start = async (card: KanbanCard) => {
    await run((op) => startWorkOrderStage(actor, card.workOrder.id, card.stage.id, { operationId: op }), {
      successMessage: `Đã bắt đầu "${card.stage.name}" cho lệnh ${card.workOrder.code}`,
    });
  };

  const finish = async (card: KanbanCard) => {
    const isLast = card.stage.seq === card.totalStages;
    const result = await run((op) => completeWorkOrderStage(actor, card.workOrder.id, card.stage.id, { operationId: op }), {
      successMessage: isLast ? `Đã xong công đoạn cuối "${card.stage.name}" — chờ QC` : `Đã xong "${card.stage.name}" — chuyển tổ kế tiếp`,
    });
    if (result) {
      message.info(
        result.nextStage
          ? `Lệnh ${card.workOrder.code} đã đẩy sang bước "${result.nextStage.name}".`
          : `Lệnh ${card.workOrder.code} đã sang trạng thái Chờ QC.`,
      );
    }
  };

  const totalCards = filtered.length;

  return (
    <div>
      <PageHeader
        title="Điều độ xưởng"
        subtitle="Kanban theo tổ sản xuất: bắt đầu và hoàn thành công đoạn để đẩy lệnh sang tổ kế tiếp theo thứ tự công nghệ."
        extra={[
          <Select
            key="team"
            allowClear
            placeholder="Tất cả các tổ"
            style={{ width: 220 }}
            value={filters.team}
            onChange={(value) => setFilters({ team: value })}
            options={(teams ?? []).map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }))}
          />,
        ]}
      />

      <div className="page-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Tìm mã lệnh, sản phẩm, đơn hàng, khách"
          style={{ width: 320 }}
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setFilters({ q: e.target.value || undefined });
          }}
        />
        <Select
          allowClear
          placeholder="Ưu tiên"
          style={{ width: 150 }}
          value={filters.priority}
          onChange={(value) => setFilters({ priority: value })}
          options={(Object.keys(WORK_ORDER_PRIORITY_META) as WorkOrderPriority[]).map((p) => ({ value: p, label: WORK_ORDER_PRIORITY_META[p].label }))}
        />
        <Space size={12} wrap>
          <span className={styles.legend}>
            <span className={styles.legendDot} style={{ background: '#4f46e5' }} /> Đang làm
          </span>
          <span className={styles.legend}>
            <span className={styles.legendDot} style={{ background: '#c9c9dd' }} /> Chưa bắt đầu
          </span>
          <span className={styles.legend}>
            <span className={styles.legendDot} style={{ background: '#d64545' }} /> Quá hạn
          </span>
        </Space>
        <Typography.Text type="secondary">{totalCards} công đoạn đang chờ/đang làm tại xưởng</Typography.Text>
      </div>

      <div className={styles.board}>
        {visibleTeams.map((team) => {
          const teamCards = byTeam.get(team.id) ?? [];
          const running = teamCards.filter((c) => c.stage.status === 'IN_PROGRESS').length;
          const pending = teamCards.length - running;
          const totalMinutes = teamCards.reduce((s, c) => s + c.stage.standardMinutes * c.workOrder.quantity, 0);
          return (
            <div key={team.id} className={styles.column}>
              <div className={styles.columnHead}>
                <div>
                  <div className="text-strong">{team.name}</div>
                  <div className="text-muted">
                    {running} đang làm · {pending} chờ · {formatMinutes(Math.round(totalMinutes))} tải
                  </div>
                </div>
                <Tag color={running > 0 ? 'geekblue' : 'default'}>{teamCards.length}</Tag>
              </div>
              <div className={styles.columnBody}>
                {teamCards.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-muted">Không có lệnh</span>} /> : null}
                {teamCards.map((card) => {
                  const progressPct = card.workOrder.quantity > 0 ? Math.min(100, Math.round((card.loggedGood / card.workOrder.quantity) * 100)) : 0;
                  return (
                    <div key={card.stage.id} className={styles.card}>
                      <div className={styles.cardTop}>
                        <a className="text-strong" onClick={() => navigate(`/work-orders/${card.workOrder.id}`)}>
                          {card.workOrder.code}
                        </a>
                        <StatusTag kind="priority" status={card.workOrder.priority} />
                      </div>
                      <div className={styles.productLine}>{card.productName}</div>
                      <div className={styles.metaLine}>
                        <Tag style={{ marginInlineEnd: 0 }}>
                          SL {formatQuantity(card.workOrder.quantity)}
                        </Tag>
                        <Tag style={{ marginInlineEnd: 0 }}>
                          Bước {card.stage.seq}/{card.totalStages}
                        </Tag>
                        <Tag color={card.stage.status === 'IN_PROGRESS' ? 'geekblue' : 'default'} style={{ marginInlineEnd: 0 }}>
                          {card.stage.status === 'IN_PROGRESS' ? 'Đang làm' : 'Chưa làm'}
                        </Tag>
                        {card.workOrder.reworkCount > 0 ? <Tag color="red" style={{ marginInlineEnd: 0 }}>Làm lại {card.workOrder.reworkCount}</Tag> : null}
                      </div>
                      <div className={styles.metaLine}>
                        <span className="text-muted">{card.stage.name}</span>
                        <span className="text-muted">·</span>
                        <span className="text-muted">{card.customerName}</span>
                      </div>
                      <Progress percent={progressPct} size="small" status={card.overdue ? 'exception' : 'normal'} />
                      <div className={styles.footer}>
                        <span className={card.overdue ? styles.overdue : undefined}>Hạn {formatDate(card.workOrder.dueDate)}</span>
                        <span>
                          SL đã làm: <strong>{formatQuantity(card.loggedGood)}</strong>
                        </span>
                      </div>
                      {card.stage.startedAt ? (
                        <div className={styles.startedAt}>Bắt đầu {formatDateTime(card.stage.startedAt)}</div>
                      ) : null}
                      <Space style={{ marginTop: 8 }} size={6} wrap>
                        {canRun && card.stage.status === 'PENDING' ? (
                          <Button size="small" type="primary" icon={<PlayCircleOutlined />} loading={loading} onClick={() => void start(card)}>
                            Bắt đầu
                          </Button>
                        ) : null}
                        {canRun && card.stage.status === 'IN_PROGRESS' ? (
                          <Button size="small" type="primary" icon={<CheckCircleOutlined />} loading={loading} onClick={() => void finish(card)}>
                            Xong công đoạn
                          </Button>
                        ) : null}
                        <Tooltip title="Ghi sản lượng cho công đoạn này">
                          <Button size="small" onClick={() => navigate(`/work-orders/${card.workOrder.id}`)}>
                            Chi tiết
                          </Button>
                        </Tooltip>
                      </Space>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <Card size="small" style={{ marginTop: 12 }}>
        <Typography.Text type="secondary">
          Thẻ hiển thị công đoạn hiện tại của lệnh tại từng tổ. Bấm "Bắt đầu" để ghi nhận thời điểm triển khai, bấm "Xong công đoạn" để hệ thống tự đẩy
          lệnh sang tổ của bước kế tiếp; bước cuối hoàn thành thì lệnh chuyển sang Chờ QC.
          {logs ? ` Tổng ${logs.length} phiếu sản lượng đã ghi.` : ''}
        </Typography.Text>
      </Card>
    </div>
  );
}
