import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  InputNumber,
  Modal,
  Progress,
  Row,
  Space,
  Steps,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import type { StepsProps } from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ExperimentOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  PrinterOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import { PrintPreview } from '../../components/PrintPreview';
import { PrintLetterhead } from '../../components/PrintLetterhead';
import { ProductionLogModal } from '../../components/ProductionLogModal';
import { QcCheckModal } from '../../components/QcCheckModal';
import { useRole } from '../../app/RoleContext';
import { useAction } from '../../hooks/useAction';
import { db } from '../../db/database';
import { getWorkOrderRow } from '../../repositories/lists';
import { materialDemand, issueMaterialsToWorkOrder, type MaterialDemandRow } from '../../services/inventory';
import { completeWorkOrderStage, startWorkOrderStage } from '../../services/production';
import { formatDate, formatDateTime, formatMinutes } from '../../utils/format';
import { formatMoney, formatMoneyShort, formatQuantity } from '../../utils/money';
import { DEFECT_TYPE_LABEL, SHIFT_LABEL } from '../../utils/status';
import { DEFAULT_WORKSHOP_INFO, getSetting, SETTING_KEYS, type WorkshopInfo } from '../../services/settings';
import type { ActivityLog, ProductionLog, QcCheck, WorkOrderStage } from '../../types';

export function WorkOrderDetailPage() {
  const { workOrderId } = useParams<{ workOrderId: string }>();
  const navigate = useNavigate();
  const { actor, role } = useRole();
  const { message } = App.useApp();
  const { loading, run } = useAction();
  const [printOpen, setPrintOpen] = useState(false);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [qcModalOpen, setQcModalOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueLines, setIssueLines] = useState<Array<{ materialId: string; quantity: number }>>([]);
  const [issueNote, setIssueNote] = useState('');

  const row = useLiveQuery(() => (workOrderId ? getWorkOrderRow(workOrderId) : Promise.resolve(undefined)), [workOrderId]);
  const demand = useLiveQuery(() => (workOrderId ? materialDemand(workOrderId) : Promise.resolve([])), [workOrderId]);
  const logs = useLiveQuery(
    () => (workOrderId ? db.productionLogs.where('workOrderId').equals(workOrderId).toArray() : Promise.resolve<ProductionLog[]>([])),
    [workOrderId],
  );
  const checks = useLiveQuery(
    () => (workOrderId ? db.qcChecks.where('workOrderId').equals(workOrderId).toArray() : Promise.resolve<QcCheck[]>([])),
    [workOrderId],
  );
  const activities = useLiveQuery(
    () => (workOrderId ? db.activityLogs.where('[entityType+entityId]').equals(['WORK_ORDER', workOrderId]).toArray() : Promise.resolve<ActivityLog[]>([])),
    [workOrderId],
  );
  const employees = useLiveQuery(() => db.employees.toArray(), []);
  const teams = useLiveQuery(() => db.teams.toArray(), []);
  const workshop = useLiveQuery(() => getSetting<WorkshopInfo>(SETTING_KEYS.WORKSHOP_INFO, DEFAULT_WORKSHOP_INFO), [], DEFAULT_WORKSHOP_INFO);

  const employeeById = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e])), [employees]);
  const teamById = useMemo(() => new Map((teams ?? []).map((t) => [t.id, t])), [teams]);
  const stageById = useMemo(() => new Map((row?.stages ?? []).map((s) => [s.id, s])), [row]);

  if (!row) {
    return <Card loading />;
  }

  const { workOrder } = row;
  const canRun = role === 'MANAGER' || role === 'SUPERVISOR';
  const canLog = role === 'MANAGER' || role === 'SUPERVISOR';
  const canIssue = role === 'MANAGER' || role === 'SUPERVISOR' || role === 'STOREKEEPER';
  const canQc = role === 'MANAGER' || role === 'QC';

  const currentStage = row.stages.find((s) => s.status === 'IN_PROGRESS');
  const nextPending = row.stages.find((s) => s.status === 'PENDING');
  const lastStage = row.stages[row.stages.length - 1];
  const stageIndex = row.stages.findIndex((s) => s.id === (currentStage?.id ?? nextPending?.id));

  const startStage = async (stage: WorkOrderStage) => {
    await run((op) => startWorkOrderStage(actor, workOrder.id, stage.id, { operationId: op }), {
      successMessage: `Đã bắt đầu công đoạn "${stage.name}"`,
    });
  };

  const finishMessage = (stage: WorkOrderStage) =>
    stage.seq === lastStage?.seq ? `Đã hoàn thành công đoạn cuối "${stage.name}" — lệnh chờ QC` : `Đã hoàn thành công đoạn "${stage.name}"`;

  const finishStage = async (stage: WorkOrderStage) => {
    const result = await run((op) => completeWorkOrderStage(actor, workOrder.id, stage.id, { operationId: op }), {
      successMessage: finishMessage(stage),
    });
    if (result) {
      message.info(
        result.nextStage
          ? `Lệnh đã chuyển sang tổ ${teamById.get(result.nextStage.teamId)?.name ?? ''} cho bước "${result.nextStage.name}".`
          : 'Lệnh đã chuyển sang trạng thái Chờ QC — mời QC kiểm tra.',
      );
    }
  };

  const openIssueModal = () => {
    const prefilled = (demand ?? [])
      .filter((line) => line.missingQty > 0)
      .map((line) => ({ materialId: line.material.id, quantity: Math.min(line.missingQty, line.material.stockQty) }));
    setIssueLines(prefilled.length > 0 ? prefilled : [{ materialId: demand?.[0]?.material.id ?? '', quantity: 0 }]);
    setIssueNote(`Cấp vật tư theo định mức cho lệnh ${workOrder.code}`);
    setIssueOpen(true);
  };

  const submitIssue = async () => {
    const lines = issueLines.filter((l) => l.materialId && l.quantity > 0);
    if (lines.length === 0) {
      message.warning('Chưa có dòng vật tư hợp lệ để cấp.');
      return;
    }
    const issue = await run((op) => issueMaterialsToWorkOrder(actor, workOrder.id, lines, { note: issueNote, operationId: op }), {
      successMessage: 'Đã lập phiếu cấp vật tư và trừ tồn kho NVL',
    });
    if (issue) setIssueOpen(false);
  };

  const stageSteps: StepsProps['items'] = row.stages.map((stage, idx) => ({
    title: (
      <Space size={6}>
        <span>{stage.name}</span>
        <StatusTag kind="stage" status={stage.status} />
        {idx === stageIndex && workOrder.status === 'IN_PROGRESS' ? <Tag color="processing">Đang ở bước này</Tag> : null}
      </Space>
    ),
    content: (      <div>
        <div className="text-muted">
          Tổ {teamById.get(stage.teamId)?.name ?? '—'} · đơn giá khoán {formatMoney(stage.pieceRateVnd)}/
          {row.product?.unit ?? 'đv'} · định mức {formatMinutes(stage.standardMinutes)}
        </div>
        <div className="text-muted">
          Bắt đầu: {formatDateTime(stage.startedAt)} · Kết thúc: {formatDateTime(stage.finishedAt)} · SL đã ghi:{' '}
          {formatQuantity((logs ?? []).filter((l) => l.stageId === stage.id).reduce((s, l) => s + l.quantityGood, 0))}
        </div>
        <Space style={{ marginTop: 6 }} size={6} wrap>
          {canRun && stage.status === 'PENDING' && idx === stageIndex && workOrder.status !== 'AWAITING_QC' ? (
            <Button size="small" type="primary" icon={<PlayCircleOutlined />} loading={loading} onClick={() => void startStage(stage)}>
              Bắt đầu
            </Button>
          ) : null}
          {canRun && stage.status === 'IN_PROGRESS' ? (
            <Button size="small" type="primary" icon={<CheckCircleOutlined />} loading={loading} onClick={() => void finishStage(stage)}>
              Hoàn thành công đoạn
            </Button>
          ) : null}
          {canLog && stage.status === 'IN_PROGRESS' ? (
            <Button size="small" icon={<PlusOutlined />} onClick={() => setLogModalOpen(true)}>
              Ghi sản lượng
            </Button>
          ) : null}
        </Space>
      </div>
    ),
    status: stage.status === 'DONE' ? 'finish' : stage.status === 'IN_PROGRESS' ? 'process' : 'wait',
  }));

  const demandColumns: TableColumnsType<MaterialDemandRow> = [
    {
      title: 'Nguyên vật liệu',
      key: 'material',
      render: (_, line) => (
        <Space orientation="vertical" size={0}>
          <span>{line.material.name}</span>
          <span className="text-muted">
            {line.material.code} · tồn {formatQuantity(line.material.stockQty)} {line.material.unit}
          </span>
        </Space>
      ),
    },
    { title: 'Định mức', key: 'need', width: 120, align: 'right', render: (_, line) => `${formatQuantity(line.neededQty)} ${line.material.unit}` },
    {
      title: 'Đã cấp',
      key: 'issued',
      width: 120,
      align: 'right',
      render: (_, line) => (
        <span style={line.issuedQty >= line.neededQty ? { color: '#2f9e44' } : undefined}>
          {formatQuantity(line.issuedQty)} {line.material.unit}
        </span>
      ),
    },
    {
      title: 'Còn thiếu',
      key: 'missing',
      width: 130,
      align: 'right',
      render: (_, line) =>
        line.missingQty > 0 ? (
          <span style={{ color: '#d64545', fontWeight: 600 }}>
            {formatQuantity(line.missingQty)} {line.material.unit}
          </span>
        ) : (
          <Tag color="green">Đủ</Tag>
        ),
    },
    {
      title: 'Giá trị đã cấp',
      key: 'value',
      width: 140,
      align: 'right',
      render: (_, line) => <MoneyDisplay value={Math.round(line.issuedQty * line.material.avgCostVnd)} muted />,
    },
  ];

  const logColumns: TableColumnsType<ProductionLog> = [
    { title: 'Mã phiếu', dataIndex: 'code', key: 'code', width: 150 },
    { title: 'Ngày', key: 'date', width: 110, render: (_, log) => formatDate(log.date) },
    { title: 'Ca', key: 'shift', width: 80, render: (_, log) => SHIFT_LABEL[log.shift] },
    { title: 'Công đoạn', key: 'stage', render: (_, log) => stageById.get(log.stageId)?.name ?? '—' },
    { title: 'Nhân viên', key: 'employee', render: (_, log) => employeeById.get(log.employeeId)?.name ?? '—' },
    { title: 'SL tốt', dataIndex: 'quantityGood', key: 'good', width: 90, align: 'right' },
    { title: 'SL lỗi', dataIndex: 'quantityBad', key: 'bad', width: 90, align: 'right', render: (v: number) => (v > 0 ? <span style={{ color: '#d64545' }}>{v}</span> : 0) },
    { title: 'Thành tiền khoán', key: 'amount', width: 140, align: 'right', render: (_, log) => <MoneyDisplay value={log.amountVnd} strong /> },
  ];

  const qcColumns: TableColumnsType<QcCheck> = [
    { title: 'Mã phiếu', dataIndex: 'code', key: 'code', width: 150 },
    { title: 'Ngày kiểm', key: 'at', width: 150, render: (_, c) => formatDateTime(c.checkedAt) },
    { title: 'SL kiểm', dataIndex: 'checkedQty', key: 'checked', width: 90, align: 'right' },
    { title: 'SL đạt', dataIndex: 'passedQty', key: 'passed', width: 90, align: 'right' },
    { title: 'SL lỗi', dataIndex: 'failedQty', key: 'failed', width: 90, align: 'right' },
    { title: 'Loại lỗi', key: 'defect', width: 140, render: (_, c) => DEFECT_TYPE_LABEL[c.defectType] },
    { title: 'Kết quả', key: 'result', width: 120, render: (_, c) => <StatusTag kind="qc" status={c.result} /> },
    { title: 'Người kiểm', key: 'checker', width: 150, render: (_, c) => employeeById.get(c.checkedById)?.name ?? '—' },
    { title: 'Ghi chú', dataIndex: 'note', key: 'note', render: (v?: string) => v ?? '—' },
  ];

  const materialValueIssued = (demand ?? []).reduce((s, line) => s + Math.round(line.issuedQty * line.material.avgCostVnd), 0);
  const laborValue = (logs ?? []).reduce((s, l) => s + l.amountVnd, 0);

  return (
    <div>
      <PageHeader
        title={
          <Space wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/work-orders')} />
            Lệnh {workOrder.code}
            <StatusTag kind="workOrder" status={workOrder.status} />
            <StatusTag kind="priority" status={workOrder.priority} />
            {workOrder.reworkCount > 0 ? <Tag color="red">Làm lại {workOrder.reworkCount} lần</Tag> : null}
            {row.overdue ? <Tag color="volcano">Quá hạn</Tag> : null}
          </Space>
        }
        subtitle={
          <span>
            {row.product?.name ?? '—'} · SL {formatQuantity(workOrder.quantity)} {row.product?.unit ?? ''} · Đơn{' '}
            {row.salesOrder ? <a onClick={() => navigate(`/orders/${row.salesOrder!.id}`)}>{row.salesOrder.code}</a> : '—'}
            {row.customer ? ` · ${row.customer.name}` : ''}
          </span>
        }
        extra={[
          <Button key="print" icon={<PrinterOutlined />} onClick={() => setPrintOpen(true)}>
            In lệnh SX
          </Button>,
          canIssue && workOrder.status !== 'DONE' && workOrder.status !== 'CANCELLED' ? (
            <Button key="issue" icon={<SafetyOutlined />} onClick={openIssueModal}>
              Cấp vật tư
            </Button>
          ) : null,
          canLog && workOrder.status !== 'CANCELLED' && workOrder.status !== 'DONE' ? (
            <Button key="log" icon={<PlusOutlined />} onClick={() => setLogModalOpen(true)}>
              Thêm phiếu sản lượng
            </Button>
          ) : null,
          canQc && workOrder.status === 'AWAITING_QC' ? (
            <Button key="qc" type="primary" icon={<ExperimentOutlined />} onClick={() => setQcModalOpen(true)}>
              Kiểm tra QC
            </Button>
          ) : null,
        ]}
      />

      {workOrder.status === 'AWAITING_QC' ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title="Lệnh đã hoàn thành tất cả công đoạn và đang chờ QC kiểm tra."
          description="QC đạt sẽ nhập kho thành phẩm và kết thúc lệnh; QC không đạt sẽ đưa lệnh về công đoạn cuối để làm lại và tăng số lần làm lại."
        />
      ) : null}

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={14}>
          <Card
            size="small"
            title="Công đoạn sản xuất"
            extra={<span className="text-muted">{formatMinutes(row.stages.reduce((s, st) => s + st.standardMinutes, 0))} định mức toàn lệnh</span>}
          >
            {row.stages.length === 0 ? <Empty description="Lệnh chưa có công đoạn" /> : <Steps orientation="vertical" current={stageIndex} items={stageSteps} />}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" title="Thông tin lệnh" style={{ marginBottom: 12 }}>
            <Descriptions size="small" column={2}>
              <Descriptions.Item label="Sản phẩm">{row.product?.name ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Mã SP">{row.product?.code ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Số lượng">{formatQuantity(workOrder.quantity)}</Descriptions.Item>
              <Descriptions.Item label="Hạn giao">
                <span style={row.overdue ? { color: '#d64545', fontWeight: 600 } : undefined}>{formatDate(workOrder.dueDate)}</span>
              </Descriptions.Item>
              <Descriptions.Item label="Bắt đầu">{formatDateTime(workOrder.startedAt)}</Descriptions.Item>
              <Descriptions.Item label="Chờ QC từ">{formatDateTime(workOrder.awaitingQcAt)}</Descriptions.Item>
              <Descriptions.Item label="Hoàn thành">{formatDateTime(workOrder.finishedAt)}</Descriptions.Item>
              <Descriptions.Item label="Làm lại">{workOrder.reworkCount} lần</Descriptions.Item>
              <Descriptions.Item label="SL tốt ghi nhận">{formatQuantity(row.goodQty)}</Descriptions.Item>
              <Descriptions.Item label="SL lỗi ghi nhận">
                {row.badQty > 0 ? <span style={{ color: '#d64545' }}>{formatQuantity(row.badQty)}</span> : 0}
              </Descriptions.Item>
            </Descriptions>
            <Divider style={{ margin: '8px 0' }} />
            <Space wrap size={16}>
              <span>
                Chi phí NVL đã cấp: <strong>{formatMoney(materialValueIssued)}</strong>
              </span>
              <span>
                Lương khoán ghi nhận: <strong>{formatMoney(laborValue)}</strong>
              </span>
              <span>
                Giá trị lệnh:{' '}
                <strong>{formatMoneyShort(Math.round(workOrder.quantity * (row.product?.salePriceVnd ?? 0)))}</strong>
              </span>
            </Space>
            <Progress
              style={{ marginTop: 10 }}
              percent={row.stages.length > 0 ? Math.round((row.doneStages / row.stages.length) * 100) : 0}
              status={workOrder.reworkCount > 0 ? 'exception' : 'normal'}
            />
          </Card>

          <Card size="small" title="Nhật ký lệnh">
            {(activities ?? []).length === 0 ? (
              <Typography.Text type="secondary">Chưa có hoạt động nào.</Typography.Text>
            ) : (
              <Timeline
                items={[...(activities ?? [])]
                  .sort((a, b) => b.at.localeCompare(a.at))
                  .slice(0, 12)
                  .map((log) => ({
                    color: log.action === 'QC_FAILED' ? 'red' : log.action === 'QC_PASSED' ? 'green' : 'blue',
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
        </Col>

        <Col xs={24} lg={14}>
          <Card
            size="small"
            title="Nhu cầu & cấp phát vật tư theo định mức"
            extra={
              canIssue && workOrder.status !== 'DONE' && workOrder.status !== 'CANCELLED' ? (
                <Button size="small" type="primary" onClick={openIssueModal}>
                  Cấp vật tư
                </Button>
              ) : null
            }
          >
            <Table<MaterialDemandRow>
              rowKey={(l) => l.material.id}
              size="small"
              pagination={false}
              columns={demandColumns}
              dataSource={demand ?? []}
              locale={{ emptyText: 'Lệnh chưa có định mức vật tư' }}
            />
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card size="small" title="Lịch sử kiểm tra chất lượng (QC)">
            <Table<QcCheck> rowKey="id" size="small" pagination={false} columns={qcColumns} dataSource={[...(checks ?? [])].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))} scroll={{ x: 800 }} locale={{ emptyText: 'Chưa có phiếu QC nào' }} />
          </Card>
        </Col>

        <Col xs={24}>
          <Card
            size="small"
            title={`Phiếu sản lượng của lệnh (${(logs ?? []).length})`}
            extra={
              canLog && workOrder.status !== 'CANCELLED' && workOrder.status !== 'DONE' ? (
                <Button size="small" icon={<PlusOutlined />} onClick={() => setLogModalOpen(true)}>
                  Thêm phiếu
                </Button>
              ) : null
            }
          >
            <Table<ProductionLog>
              rowKey="id"
              size="small"
              columns={logColumns}
              dataSource={[...(logs ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              scroll={{ x: 1000 }}
              locale={{ emptyText: 'Chưa có phiếu sản lượng nào cho lệnh này' }}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={5}>
                    <strong>Tổng</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right">
                    <strong>{formatQuantity(row.goodQty)}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={6} align="right">
                    <strong>{formatQuantity(row.badQty)}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={7} align="right">
                    <strong>{formatMoney(laborValue)}</strong>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
          </Card>
        </Col>
      </Row>

      <ProductionLogModal open={logModalOpen} onClose={() => setLogModalOpen(false)} defaultWorkOrderId={workOrder.id} />
      <QcCheckModal open={qcModalOpen} onClose={() => setQcModalOpen(false)} defaultWorkOrderId={workOrder.id} />

      <Modal
        title={`Cấp vật tư cho lệnh ${workOrder.code}`}
        open={issueOpen}
        onCancel={() => setIssueOpen(false)}
        onOk={() => void submitIssue()}
        okText="Lập phiếu cấp vật tư"
        cancelText="Đóng"
        confirmLoading={loading}
        width={760}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title="Phiếu cấp vật tư trừ tồn NVL ngay khi lập. Số lượng được điền sẵn theo định mức còn thiếu, có thể sửa."
        />
        <Space orientation="vertical" style={{ width: '100%' }}>
          {issueLines.map((line, idx) => {
            const demandLine = (demand ?? []).find((d) => d.material.id === line.materialId);
            return (
              <Space key={`${line.materialId}-${idx}`} wrap align="start">
                <Typography.Text style={{ width: 300, lineHeight: '34px' }}>
                  {demandLine?.material.name ?? 'Vật tư khác'}
                  {demandLine ? <span className="text-muted"> (còn thiếu {formatQuantity(demandLine.missingQty)} {demandLine.material.unit})</span> : null}
                </Typography.Text>
                <InputNumber
                  style={{ width: 140 }}
                  min={0}
                  value={line.quantity}
                  onChange={(value) => setIssueLines(issueLines.map((l, i) => (i === idx ? { ...l, quantity: Number(value ?? 0) } : l)))}
                />
                <Tooltip title="Xoá dòng">
                  <Button type="text" danger onClick={() => setIssueLines(issueLines.filter((_, i) => i !== idx))}>
                    Xoá
                  </Button>
                </Tooltip>
              </Space>
            );
          })}
          <Space wrap>
            <Button
              icon={<PlusOutlined />}
              onClick={() => setIssueLines([...issueLines, { materialId: (demand ?? [])[issueLines.length]?.material.id ?? '', quantity: 0 }])}
            >
              Thêm dòng
            </Button>
            <Typography.Text type="secondary">Tổng giá trị cấp: {formatMoney(
              issueLines.reduce((s, l) => {
                const line = (demand ?? []).find((d) => d.material.id === l.materialId);
                return s + Math.round(l.quantity * (line?.material.avgCostVnd ?? 0));
              }, 0),
            )}</Typography.Text>
          </Space>
        </Space>
      </Modal>

      <PrintPreview open={printOpen} onClose={() => setPrintOpen(false)} title={`Lệnh sản xuất ${workOrder.code}`} printLabel="In lệnh sản xuất">
        <PrintLetterhead
          title="Lệnh sản xuất"
          right={
            <>
              <div>
                <strong>Số: {workOrder.code}</strong>
              </div>
              <div>Ngày lập: {formatDate(workOrder.createdAt)}</div>
              <div>Hạn hoàn thành: {formatDate(workOrder.dueDate)}</div>
            </>
          }
        />
        <table>
          <tbody>
            <tr>
              <th style={{ width: 150 }}>Sản phẩm</th>
              <td>
                {row.product?.name ?? '—'} ({row.product?.code ?? '—'})
              </td>
              <th style={{ width: 120 }}>Số lượng</th>
              <td>
                {formatQuantity(workOrder.quantity)} {row.product?.unit ?? ''}
              </td>
            </tr>
            <tr>
              <th>Đơn hàng</th>
              <td>{row.salesOrder?.code ?? '—'}</td>
              <th>Khách hàng</th>
              <td>{row.customer?.name ?? '—'}</td>
            </tr>
            <tr>
              <th>Ưu tiên</th>
              <td>{workOrder.priority === 'URGENT' ? 'Gấp' : workOrder.priority === 'HIGH' ? 'Cao' : workOrder.priority === 'LOW' ? 'Thấp' : 'Thường'}</td>
              <th>Làm lại</th>
              <td>{workOrder.reworkCount} lần</td>
            </tr>
          </tbody>
        </table>
        <h3 style={{ fontSize: 14, margin: '10px 0 4px' }}>Công đoạn sản xuất</h3>
        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}>Bước</th>
              <th>Công đoạn</th>
              <th style={{ width: 160 }}>Tổ thực hiện</th>
              <th style={{ width: 130 }} className="amount">
                Đơn giá khoán
              </th>
              <th style={{ width: 110 }} className="amount">
                Định mức
              </th>
            </tr>
          </thead>
          <tbody>
            {row.stages.map((stage) => (
              <tr key={stage.id}>
                <td>{stage.seq}</td>
                <td>{stage.name}</td>
                <td>{teamById.get(stage.teamId)?.name ?? '—'}</td>
                <td className="amount">{formatMoney(stage.pieceRateVnd)}</td>
                <td className="amount">{stage.standardMinutes} phút</td>
              </tr>
            ))}
            <tr>
              <th colSpan={3}>Tổng đơn giá khoán / đơn vị</th>
              <th className="amount">{formatMoney(row.stages.reduce((s, st) => s + st.pieceRateVnd, 0))}</th>
              <th className="amount">{row.stages.reduce((s, st) => s + st.standardMinutes, 0)} phút</th>
            </tr>
          </tbody>
        </table>
        <h3 style={{ fontSize: 14, margin: '10px 0 4px' }}>Nguyên vật liệu theo định mức</h3>
        <table>
          <thead>
            <tr>
              <th>Mã NVL</th>
              <th>Tên vật tư</th>
              <th style={{ width: 70 }}>ĐVT</th>
              <th style={{ width: 120 }} className="amount">
                Định mức/đv
              </th>
              <th style={{ width: 110 }} className="amount">
                Tổng cần
              </th>
            </tr>
          </thead>
          <tbody>
            {(demand ?? []).map((line) => (
              <tr key={line.material.id}>
                <td>{line.material.code}</td>
                <td>{line.material.name}</td>
                <td>{line.material.unit}</td>
                <td className="amount">{formatQuantity(line.neededQty / Math.max(1, workOrder.quantity))}</td>
                <td className="amount">
                  {formatQuantity(line.neededQty)} {line.material.unit}
                </td>
              </tr>
            ))}
            {(!demand || demand.length === 0) && (
              <tr>
                <td colSpan={5}>Chưa có định mức nguyên vật liệu.</td>
              </tr>
            )}
          </tbody>
        </table>
        <div style={{ fontSize: 12.5 }}>Yêu cầu: gia công đúng bản vẽ kỹ thuật, kiểm tra kích thước và mối hàn trước khi chuyển công đoạn.</div>
        <div className="print-signatures">
          <div>
            <strong>Người lập lệnh</strong>
            <div style={{ height: 56 }} />
            <div>{workshop.representative}</div>
          </div>
          <div>
            <strong>Tổ trưởng</strong>
            <div style={{ height: 56 }} />
            <div>{teamById.get(currentStage?.teamId ?? lastStage?.teamId ?? '')?.name ?? ''}</div>
          </div>
          <div>
            <strong>Giám đốc xưởng</strong>
            <div style={{ height: 56 }} />
            <div>{workshop.representative}</div>
          </div>
        </div>
      </PrintPreview>
    </div>
  );
}
