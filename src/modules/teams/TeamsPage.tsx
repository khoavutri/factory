import { useMemo, useState } from 'react';
import { Button, Card, Col, Empty, Form, Input, Modal, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useLiveQuery } from 'dexie-react-hooks';
import dayjs from 'dayjs';
import { PageHeader } from '../../components/PageHeader';
import { useRole } from '../../app/RoleContext';
import { useAction } from '../../hooks/useAction';
import { useUrlState } from '../../hooks/useUrlState';
import { db } from '../../db/database';
import { saveEmployee, saveTeam, type EmployeeInput, type TeamInput } from '../../services/catalog';
import { formatMoney, formatQuantity } from '../../utils/money';
import { POSITION_LABEL, ROLE_LABEL } from '../../utils/status';
import type { Employee, PositionId, RoleId, Team } from '../../types';
import styles from './Teams.module.scss';

interface EmployeeRow {
  employee: Employee;
  teamName?: string;
  good30: number;
  bad30: number;
  amount30: number;
}

export function TeamsPage() {
  const { actor, role } = useRole();
  const { loading, run } = useAction();
  const [filters, setFilters] = useUrlState<{ tab?: string }>({ tab: 'teams' });
  const [teamOpen, setTeamOpen] = useState(false);
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [teamForm] = Form.useForm<TeamInput>();
  const [employeeForm] = Form.useForm<EmployeeInput>();

  const teams = useLiveQuery(() => db.teams.toArray(), []);
  const employees = useLiveQuery(() => db.employees.toArray(), []);
  const logs = useLiveQuery(() => db.productionLogs.toArray(), []);
  const boms = useLiveQuery(() => db.bomStages.toArray(), []);
  const workOrders = useLiveQuery(() => db.workOrders.toArray(), []);

  const isManager = role === 'MANAGER';
  const from30 = dayjs().subtract(29, 'day').format('YYYY-MM-DD');

  const employeeRows: EmployeeRow[] = useMemo(() => {
    const teamById = new Map((teams ?? []).map((t) => [t.id, t]));
    return (employees ?? [])
      .map((employee) => {
        const employeeLogs = (logs ?? []).filter((l) => l.employeeId === employee.id && l.date >= from30);
        return {
          employee,
          teamName: employee.teamId ? teamById.get(employee.teamId)?.name : undefined,
          good30: employeeLogs.reduce((s, l) => s + l.quantityGood, 0),
          bad30: employeeLogs.reduce((s, l) => s + l.quantityBad, 0),
          amount30: employeeLogs.reduce((s, l) => s + l.amountVnd, 0),
        };
      })
      .sort((a, b) => a.employee.code.localeCompare(b.employee.code));
  }, [employees, teams, logs, from30]);

  const employeeColumns: TableColumnsType<EmployeeRow> = [
    { title: 'Mã NV', dataIndex: ['employee', 'code'], key: 'code', width: 110 },
    {
      title: 'Nhân viên',
      key: 'name',
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <span className="text-strong">{row.employee.name}</span>
          <span className="text-muted">{row.employee.phone}</span>
        </Space>
      ),
    },
    { title: 'Vai trò sử dụng', key: 'role', width: 170, render: (_, row) => <Tag color="geekblue">{ROLE_LABEL[row.employee.role]}</Tag> },
    { title: 'Chức danh', key: 'position', width: 150, render: (_, row) => POSITION_LABEL[row.employee.position] },
    { title: 'Tổ', key: 'team', width: 170, render: (_, row) => row.teamName ?? <span className="text-muted">—</span> },
    { title: 'SL tốt 30 ngày', key: 'good', width: 130, align: 'right', render: (_, row) => formatQuantity(row.good30) },
    {
      title: 'SL lỗi 30 ngày',
      key: 'bad',
      width: 120,
      align: 'right',
      render: (_, row) => (row.bad30 > 0 ? <span style={{ color: '#d64545' }}>{formatQuantity(row.bad30)}</span> : 0),
    },
    { title: 'Tiền khoán 30 ngày', key: 'amount', width: 170, align: 'right', render: (_, row) => <strong>{formatMoney(row.amount30)}</strong> },
    { title: 'Trạng thái', key: 'active', width: 130, render: (_, row) => (row.employee.active ? <Tag color="green">Đang làm</Tag> : <Tag>Đã nghỉ</Tag>) },
    ...(isManager
      ? [
          {
            title: '',
            key: 'actions',
            width: 90,
            render: (_: unknown, row: EmployeeRow) => (
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  setEditingEmployee(row.employee);
                  employeeForm.setFieldsValue({
                    code: row.employee.code,
                    name: row.employee.name,
                    role: row.employee.role,
                    position: row.employee.position,
                    teamId: row.employee.teamId,
                    phone: row.employee.phone,
                    active: row.employee.active,
                  });
                  setEmployeeOpen(true);
                }}
              >
                Sửa
              </Button>
            ),
          },
        ]
      : []),
  ];

  const submitTeam = async () => {
    const values = await teamForm.validateFields();
    const ok = await run(() => saveTeam(actor, { ...values, id: editingTeam?.id }), {
      successMessage: editingTeam ? 'Đã cập nhật tổ sản xuất' : 'Đã thêm tổ sản xuất',
    });
    if (ok) {
      setTeamOpen(false);
      setEditingTeam(null);
      teamForm.resetFields();
    }
  };

  const submitEmployee = async () => {
    const values = await employeeForm.validateFields();
    const ok = await run(() => saveEmployee(actor, { ...values, id: editingEmployee?.id }), {
      successMessage: editingEmployee ? 'Đã cập nhật nhân viên' : 'Đã thêm nhân viên',
    });
    if (ok) {
      setEmployeeOpen(false);
      setEditingEmployee(null);
      employeeForm.resetFields();
    }
  };

  const employeeOptions = (teams ?? []).map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }));

  return (
    <div>
      <PageHeader
        title="Tổ sản xuất & Nhân sự"
        subtitle="Cơ cấu tổ, phân công tổ trưởng, công đoạn phụ trách và năng suất 30 ngày của từng tổ và nhân viên."
      />

      <Tabs
        activeKey={filters.tab ?? 'teams'}
        onChange={(key) => setFilters({ tab: key })}
        items={[
          {
            key: 'teams',
            label: 'Tổ sản xuất',
            children: (
              <Row gutter={[12, 12]}>
                {(teams ?? []).map((team) => {
                  const teamEmployees = (employees ?? []).filter((e) => e.teamId === team.id && e.active);
                  const teamLogs = (logs ?? []).filter((l) => l.teamId === team.id && l.date >= from30);
                  const stageNames = [...new Set((boms ?? []).filter((b) => b.teamId === team.id).map((b) => b.name))];
                  const openWorkOrders = (workOrders ?? []).filter(
                    (w) => (w.status === 'IN_PROGRESS' || w.status === 'WAITING') && (boms ?? []).some((b) => b.teamId === team.id && b.productId === w.productId),
                  ).length;
                  const leader = (employees ?? []).find((e) => e.id === team.leaderId);
                  return (
                    <Col key={team.id} xs={24} md={12} xl={8}>
                      <Card
                        size="small"
                        title={
                          <Space>
                            <Tag color="geekblue">{team.code}</Tag>
                            {team.name}
                          </Space>
                        }
                        extra={
                          isManager ? (
                            <Button
                              size="small"
                              icon={<EditOutlined />}
                              onClick={() => {
                                setEditingTeam(team);
                                teamForm.setFieldsValue({ code: team.code, name: team.name, leaderId: team.leaderId, note: team.note, active: team.active });
                                setTeamOpen(true);
                              }}
                            >
                              Sửa
                            </Button>
                          ) : null
                        }
                      >
                        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                          {team.note ?? '—'}
                        </Typography.Paragraph>
                        <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                          <div>
                            Tổ trưởng: <strong>{leader?.name ?? 'Chưa phân công'}</strong>
                          </div>
                          <div>Nhân viên: {teamEmployees.length}</div>
                          <div>
                            Công đoạn:{' '}
                            {stageNames.length > 0 ? stageNames.map((name) => <Tag key={name}>{name}</Tag>) : <span className="text-muted">Chưa khai báo</span>}
                          </div>
                          <div>
                            Lệnh liên quan đang chạy: <strong>{openWorkOrders}</strong>
                          </div>
                        </Space>
                        <div className={styles.statsRow}>
                          <Statistic title="SL tốt 30 ngày" value={formatQuantity(teamLogs.reduce((s, l) => s + l.quantityGood, 0))} />
                          <Statistic title="Tiền khoán 30 ngày" value={formatMoney(teamLogs.reduce((s, l) => s + l.amountVnd, 0))} />
                        </div>
                      </Card>
                    </Col>
                  );
                })}
                {isManager ? (
                  <Col xs={24} md={12} xl={8}>
                    <Card size="small" style={{ borderStyle: 'dashed', textAlign: 'center' }}>
                      <Button
                        icon={<PlusOutlined />}
                        onClick={() => {
                          setEditingTeam(null);
                          teamForm.resetFields();
                          teamForm.setFieldsValue({ active: true });
                          setTeamOpen(true);
                        }}
                      >
                        Thêm tổ sản xuất
                      </Button>
                    </Card>
                  </Col>
                ) : null}
              </Row>
            ),
          },
          {
            key: 'employees',
            label: 'Nhân viên',
            children: (
              <Card
                size="small"
                extra={
                  isManager ? (
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        setEditingEmployee(null);
                        employeeForm.resetFields();
                        employeeForm.setFieldsValue({ role: 'SUPERVISOR', position: 'MAIN_WORKER', active: true });
                        setEmployeeOpen(true);
                      }}
                    >
                      Thêm nhân viên
                    </Button>
                  ) : null
                }
              >
                <Table<EmployeeRow>
                  rowKey={(r) => r.employee.id}
                  columns={employeeColumns}
                  dataSource={employeeRows}
                  loading={!employees}
                  size="middle"
                  scroll={{ x: 1250 }}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  locale={{ emptyText: <Empty description="Không có nhân viên" /> }}
                />
              </Card>
            ),
          },
        ]}
      />

      <Modal
        title={editingTeam ? `Cập nhật tổ ${editingTeam.code}` : 'Thêm tổ sản xuất'}
        open={teamOpen}
        onCancel={() => setTeamOpen(false)}
        onOk={() => void submitTeam()}
        okText="Lưu tổ"
        cancelText="Đóng"
        confirmLoading={loading}
        destroyOnHidden
      >
        <Form form={teamForm} layout="vertical">
          <Form.Item name="code" label="Mã tổ" rules={[{ required: true, message: 'Nhập mã tổ' }]}>
            <Input disabled={!!editingTeam} placeholder="TO6" />
          </Form.Item>
          <Form.Item name="name" label="Tên tổ" rules={[{ required: true, min: 2, message: 'Nhập tên tổ' }]}>
            <Input placeholder="Tổ Đột dập" />
          </Form.Item>
          <Form.Item name="leaderId" label="Tổ trưởng">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={(employees ?? []).map((e) => ({ value: e.id, label: `${e.code} — ${e.name}` }))}
            />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú / nhiệm vụ">
            <Input />
          </Form.Item>
          <Form.Item name="active" label="Trạng thái">
            <Select options={[{ value: true, label: 'Đang hoạt động' }, { value: false, label: 'Ngừng hoạt động' }]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingEmployee ? `Cập nhật ${editingEmployee.code}` : 'Thêm nhân viên'}
        open={employeeOpen}
        onCancel={() => setEmployeeOpen(false)}
        onOk={() => void submitEmployee()}
        okText="Lưu nhân viên"
        cancelText="Đóng"
        confirmLoading={loading}
        destroyOnHidden
      >
        <Form form={employeeForm} layout="vertical">
          <Space size={12} style={{ width: '100%' }} wrap>
            <Form.Item name="code" label="Mã nhân viên" rules={[{ required: true, message: 'Nhập mã nhân viên' }]} style={{ width: 170 }}>
              <Input disabled={!!editingEmployee} placeholder="NV-015" />
            </Form.Item>
            <Form.Item name="name" label="Họ tên" rules={[{ required: true, min: 2, message: 'Nhập họ tên' }]} style={{ width: 260 }}>
              <Input />
            </Form.Item>
          </Space>
          <Space size={12} style={{ width: '100%' }} wrap>
            <Form.Item name="role" label="Vai trò sử dụng hệ thống" rules={[{ required: true }]} style={{ width: 230 }}>
              <Select options={(Object.keys(ROLE_LABEL) as RoleId[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
            </Form.Item>
            <Form.Item name="position" label="Chức danh" rules={[{ required: true }]} style={{ width: 190 }}>
              <Select options={(Object.keys(POSITION_LABEL) as PositionId[]).map((p) => ({ value: p, label: POSITION_LABEL[p] }))} />
            </Form.Item>
            <Form.Item name="teamId" label="Tổ" style={{ width: 200 }}>
              <Select allowClear options={employeeOptions} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ width: '100%' }} wrap>
            <Form.Item name="phone" label="Số điện thoại" rules={[{ required: true, message: 'Nhập số điện thoại' }]} style={{ width: 200 }}>
              <Input />
            </Form.Item>
            <Form.Item name="active" label="Trạng thái" style={{ width: 170 }}>
              <Select options={[{ value: true, label: 'Đang làm việc' }, { value: false, label: 'Đã nghỉ' }]} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
