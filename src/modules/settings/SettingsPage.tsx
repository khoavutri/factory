import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Col, Descriptions, Form, Input, Progress, Row, Space, Table, Typography, Upload } from 'antd';
import { CloudDownloadOutlined, CloudUploadOutlined, DeleteOutlined, SaveOutlined, SafetyOutlined } from '@ant-design/icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { useRole } from '../../app/RoleContext';
import { useAction } from '../../hooks/useAction';
import { db } from '../../db/database';
import {
  DEFAULT_APP_META,
  DEFAULT_PRINT_CONFIG,
  DEFAULT_WORKSHOP_INFO,
  getSetting,
  SETTING_KEYS,
  upsertSetting,
  type AppMetaSetting,
  type PrintConfig,
  type WorkshopInfo,
} from '../../services/settings';
import {
  APP_VERSION,
  currentDbInfo,
  downloadBackup,
  getStorageEstimate,
  importBackup,
  readBackupFile,
  requestPersistentStorage,
  resetInitialData,
  validateBackupShape,
} from '../../services/backup';
import { ROLE_LABEL } from '../../utils/status';
import { formatBytes, formatDate, formatDateTime } from '../../utils/format';

export function SettingsPage() {
  const { actor, options, setRole, role } = useRole();
  const { message, modal } = App.useApp();
  const { loading, run } = useAction();
  const [workshopForm] = Form.useForm<WorkshopInfo>();
  const [printForm] = Form.useForm<PrintConfig>();
  const [metaForm] = Form.useForm<AppMetaSetting>();
  const [busy, setBusy] = useState(false);

  const workshop = useLiveQuery(() => getSetting<WorkshopInfo>(SETTING_KEYS.WORKSHOP_INFO, DEFAULT_WORKSHOP_INFO), [], DEFAULT_WORKSHOP_INFO);
  const print = useLiveQuery(() => getSetting<PrintConfig>(SETTING_KEYS.PRINT_CONFIG, DEFAULT_PRINT_CONFIG), [], DEFAULT_PRINT_CONFIG);
  const meta = useLiveQuery(() => getSetting<AppMetaSetting>(SETTING_KEYS.APP_META, DEFAULT_APP_META), [], DEFAULT_APP_META);
  const dbInfo = useLiveQuery(() => currentDbInfo(), []);
  const storage = useLiveQuery(() => getStorageEstimate(), []);
  const sequences = useLiveQuery(() => db.documentSequences.toArray(), []);
  const periods = useLiveQuery(() => db.payrollPeriods.toArray(), []);

  const counts = useLiveQuery(async () => {
    const names = [
      'teams',
      'employees',
      'materials',
      'products',
      'bomStages',
      'bomMaterials',
      'customers',
      'salesOrders',
      'salesOrderItems',
      'workOrders',
      'workOrderStages',
      'productionLogs',
      'qcChecks',
      'materialReceipts',
      'materialIssues',
      'deliveries',
      'stockMovements',
      'payrollLines',
      'activityLogs',
    ] as const;
    const rows: Array<{ name: string; label: string; count: number }> = [];
    const labels: Record<string, string> = {
      teams: 'Tổ sản xuất',
      employees: 'Nhân viên',
      materials: 'Nguyên vật liệu',
      products: 'Sản phẩm',
      bomStages: 'Công đoạn BOM',
      bomMaterials: 'Định mức vật tư',
      customers: 'Khách hàng',
      salesOrders: 'Đơn hàng',
      salesOrderItems: 'Dòng đơn hàng',
      workOrders: 'Lệnh sản xuất',
      workOrderStages: 'Công đoạn lệnh',
      productionLogs: 'Phiếu sản lượng',
      qcChecks: 'Phiếu QC',
      materialReceipts: 'Phiếu nhập NVL',
      materialIssues: 'Phiếu xuất NVL',
      deliveries: 'Phiếu giao hàng',
      stockMovements: 'Giao dịch kho',
      payrollLines: 'Dòng lương',
      activityLogs: 'Nhật ký hoạt động',
    };
    for (const name of names) {
      rows.push({ name, label: labels[name] ?? name, count: await db.table(name).count() });
    }
    return rows;
  }, []);

  useEffect(() => {
    workshopForm.setFieldsValue(workshop);
  }, [workshop, workshopForm]);
  useEffect(() => {
    printForm.setFieldsValue(print);
  }, [print, printForm]);
  useEffect(() => {
    metaForm.setFieldsValue(meta);
  }, [meta, metaForm]);

  const handleImport = async (file: File) => {
    try {
      setBusy(true);
      const raw = await readBackupFile(file);
      const validation = validateBackupShape(raw);
      if (!validation.ok) {
        modal.error({
          title: 'Không thể nhập bản sao lưu',
          content: (
            <ul style={{ paddingInlineStart: 18 }}>
              {validation.errors.slice(0, 6).map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          ),
        });
        return;
      }
      modal.confirm({
        title: 'Thay thế toàn bộ dữ liệu hiện tại?',
        content: `Tệp chứa ${validation.summary?.records.toLocaleString('vi-VN')} bản ghi (${validation.summary?.tables} bảng), xuất lúc ${
          validation.summary?.exportedAt ? formatDateTime(validation.summary.exportedAt) : '—'
        }. Toàn bộ dữ liệu đang có trong trình duyệt này sẽ bị thay thế. Không hỗ trợ trộn hai bộ dữ liệu.`,
        okText: 'Thay toàn bộ',
        okButtonProps: { danger: true },
        onOk: async () => {
          const result = await run(() => importBackup(actor, raw), { successMessage: 'Đã khôi phục bản sao lưu' });
          if (result) message.info(`Đã nhập ${result.importedRecords.toLocaleString('vi-VN')} bản ghi từ ${result.importedTables} bảng.`);
        },
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Không đọc được tệp sao lưu.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Thiết lập"
        subtitle="Thông tin xưởng, cấu hình in, sao lưu/khôi phục dữ liệu và thông tin phiên bản hệ thống."
      />

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title="Thông tin xưởng"
            extra={
              <Button
                size="small"
                icon={<SaveOutlined />}
                loading={loading}
                onClick={async () => {
                  const values = await workshopForm.validateFields();
                  await run(() => upsertSetting(actor, SETTING_KEYS.WORKSHOP_INFO, values), {
                    successMessage: 'Đã lưu thông tin xưởng (dùng chung cho mẫu in)',
                  });
                }}
              >
                Lưu
              </Button>
            }
          >
            <Form form={workshopForm} layout="vertical" initialValues={workshop}>
              <Form.Item name="name" label="Tên xưởng" rules={[{ required: true, min: 2, message: 'Nhập tên xưởng' }]}>
                <Input />
              </Form.Item>
              <Form.Item name="address" label="Địa chỉ">
                <Input />
              </Form.Item>
              <Space size={12} style={{ width: '100%' }} wrap>
                <Form.Item name="taxCode" label="Mã số thuế" style={{ flex: 1, minWidth: 160 }}>
                  <Input />
                </Form.Item>
                <Form.Item name="phone" label="Điện thoại" style={{ flex: 1, minWidth: 160 }}>
                  <Input />
                </Form.Item>
                <Form.Item name="representative" label="Người đại diện" style={{ flex: 1, minWidth: 160 }}>
                  <Input />
                </Form.Item>
              </Space>
              <Space size={12} style={{ width: '100%' }} wrap>
                <Form.Item name="email" label="Email" style={{ flex: 1, minWidth: 160 }}>
                  <Input />
                </Form.Item>
                <Form.Item name="website" label="Website" style={{ flex: 1, minWidth: 160 }}>
                  <Input placeholder="khoadev.vn" />
                </Form.Item>
                <Form.Item name="slogan" label="Slogan" style={{ flex: 1, minWidth: 160 }}>
                  <Input />
                </Form.Item>
              </Space>
            </Form>
          </Card>

          <Card
            size="small"
            title="Cấu hình in"
            style={{ marginTop: 12 }}
            extra={
              <Button
                size="small"
                icon={<SaveOutlined />}
                loading={loading}
                onClick={async () => {
                  const values = await printForm.validateFields();
                  await run(() => upsertSetting(actor, SETTING_KEYS.PRINT_CONFIG, values), { successMessage: 'Đã lưu cấu hình mẫu in' });
                }}
              >
                Lưu
              </Button>
            }
          >
            <Form form={printForm} layout="vertical" initialValues={print}>
              <Form.Item name="footerNote" label="Ghi chú chân trang chứng từ">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Form>
            <Alert
              type="info"
              showIcon
              title="Các mẫu in dùng chung tiêu đề xưởng: Lệnh sản xuất, Phiếu giao hàng và Đơn hàng (khổ A4)."
            />
          </Card>

          <Card
            size="small"
            title="Thông tin ứng dụng"
            style={{ marginTop: 12 }}
            extra={
              <Button
                size="small"
                icon={<SaveOutlined />}
                loading={loading}
                onClick={async () => {
                  const values = await metaForm.validateFields();
                  await run(() => upsertSetting(actor, SETTING_KEYS.APP_META, values), { successMessage: 'Đã lưu thông tin ứng dụng' });
                }}
              >
                Lưu
              </Button>
            }
          >
            <Form form={metaForm} layout="vertical" initialValues={meta}>
              <Space size={12} style={{ width: '100%' }} wrap>
                <Form.Item name="appName" label="Tên ứng dụng" style={{ width: 240 }}>
                  <Input />
                </Form.Item>
                <Form.Item name="version" label="Phiên bản hiển thị" style={{ width: 160 }}>
                  <Input />
                </Form.Item>
              </Space>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card size="small" title="Vai trò trải nghiệm" style={{ marginBottom: 12 }}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              Chuyển vai trò chỉ mô phỏng trải nghiệm sử dụng; dữ liệu trình duyệt không tạo ranh giới bảo mật. Khi có máy chủ, quyền sẽ được kiểm tra lại.
            </Typography.Paragraph>
            <Space wrap>
              {options.map((option) => (
                <Button key={option.value} type={role === option.value ? 'primary' : 'default'} onClick={() => setRole(option.value)}>
                  {ROLE_LABEL[option.value]} {option.employeeName ? `— ${option.employeeName}` : ''}
                </Button>
              ))}
            </Space>
          </Card>

          <Card size="small" title="Định dạng chứng từ" style={{ marginBottom: 12 }}>
            <Descriptions size="small" column={2}>
              <Descriptions.Item label="Đơn hàng">DH-{new Date().getFullYear()}-xxxx</Descriptions.Item>
              <Descriptions.Item label="Lệnh sản xuất">LSX-{new Date().getFullYear()}-xxxx</Descriptions.Item>
              <Descriptions.Item label="Phiếu sản lượng">SL-YYYYMM-xxxx</Descriptions.Item>
              <Descriptions.Item label="Phiếu QC">QC-{new Date().getFullYear()}-xxxx</Descriptions.Item>
              <Descriptions.Item label="Nhập kho NVL">PN-{new Date().getFullYear()}-xxxx</Descriptions.Item>
              <Descriptions.Item label="Xuất NVL theo lệnh">PX-{new Date().getFullYear()}-xxxx</Descriptions.Item>
              <Descriptions.Item label="Giao hàng">GH-{new Date().getFullYear()}-xxxx</Descriptions.Item>
              <Descriptions.Item label="Kỳ lương">LK-YYYYMM-xxxx</Descriptions.Item>
            </Descriptions>
            <Table
              size="small"
              rowKey="id"
              pagination={{ pageSize: 6, showSizeChanger: false }}
              dataSource={[...(sequences ?? [])].sort((a, b) => a.id.localeCompare(b.id))}
              columns={[
                { title: 'Loại chứng từ', dataIndex: 'documentType', key: 'type' },
                { title: 'Kỳ', dataIndex: 'period', key: 'period', width: 110, render: (v: string) => v || '—' },
                { title: 'Số kế tiếp', dataIndex: 'nextValue', key: 'next', width: 110, align: 'right' },
              ]}
            />
          </Card>

          <Card
            size="small"
            title="Dung lượng và sao lưu"
            style={{ marginBottom: 12 }}
            extra={
              <Button
                size="small"
                icon={<SafetyOutlined />}
                onClick={async () => {
                  const granted = await requestPersistentStorage();
                  message.info(
                    granted
                      ? 'Trình duyệt đã cho phép lưu trữ bền vững.'
                      : 'Trình duyệt chưa cấp lưu trữ bền vững — dữ liệu có thể bị xóa khi bộ nhớ thiếu.',
                  );
                }}
              >
                Xin lưu trữ bền vững
              </Button>
            }
          >
            {storage ? (
              <>
                <Progress percent={Math.min(100, Number(storage.percentage.toFixed(2)))} status="normal" />
                <Typography.Text type="secondary">
                  Đang dùng {formatBytes(storage.usage)} / hạn mức khoảng {formatBytes(storage.quota)}. Dữ liệu lưu theo tên miền và cổng truy cập của
                  trình duyệt; đổi địa chỉ truy cập có thể tạo vùng dữ liệu khác.
                </Typography.Text>
              </>
            ) : (
              <Typography.Text type="secondary">Trình duyệt không hỗ trợ đọc ước lượng dung lượng.</Typography.Text>
            )}
            <Space style={{ marginTop: 12 }} wrap>
              <Button
                icon={<CloudDownloadOutlined />}
                loading={busy}
                onClick={() => void run(() => downloadBackup(actor), { successMessage: 'Đã tạo tệp sao lưu JSON toàn bộ dữ liệu' })}
              >
                Xuất bản sao lưu
              </Button>
              <Upload accept="application/json" showUploadList={false} beforeUpload={(file) => { void handleImport(file as unknown as File); return false; }}>
                <Button icon={<CloudUploadOutlined />}>Nhập bản sao lưu (thay toàn bộ)</Button>
              </Upload>
            </Space>
            <Alert
              style={{ marginTop: 12 }}
              type="info"
              showIcon
              title="Tệp sao lưu chứa phiên bản lược đồ, phiên bản ứng dụng, thời điểm xuất và toàn bộ bảng dữ liệu. Nhập sẽ kiểm tra lược đồ, ID trùng và liên kết thiếu trước khi thay dữ liệu."
            />
          </Card>

          <Card size="small" title="Thông tin phiên bản và liên hệ" style={{ marginBottom: 12 }}>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="Phiên bản ứng dụng">{APP_VERSION}</Descriptions.Item>
              <Descriptions.Item label="Phiên bản lược đồ dữ liệu">v{dbInfo?.schemaVersion}</Descriptions.Item>
              <Descriptions.Item label="Phiên bản dữ liệu mẫu">v{dbInfo?.seedVersion ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Khởi tạo lúc">{dbInfo?.seededAt ? formatDateTime(dbInfo.seededAt) : '—'}</Descriptions.Item>
              <Descriptions.Item label="Tên vùng dữ liệu">{dbInfo?.dbName}</Descriptions.Item>
              <Descriptions.Item label="Số kỳ lương đã lưu">{(periods ?? []).length}</Descriptions.Item>
              <Descriptions.Item label="Phát triển bởi">KhoaDev</Descriptions.Item>
              <Descriptions.Item label="Website">khoadev.vn</Descriptions.Item>
              <Descriptions.Item label="Email liên hệ">khoadev.company@gmail.com</Descriptions.Item>
            </Descriptions>
            <Typography.Title level={5} style={{ marginTop: 8 }}>
              Dữ liệu hiện có
            </Typography.Title>
            <Table
              size="small"
              rowKey="name"
              pagination={{ pageSize: 10, showSizeChanger: false }}
              dataSource={counts ?? []}
              columns={[
                { title: 'Bảng dữ liệu', dataIndex: 'label', key: 'label' },
                { title: 'Khóa', dataIndex: 'name', key: 'name', width: 170 },
                { title: 'Số bản ghi', dataIndex: 'count', key: 'count', align: 'right', width: 120 },
              ]}
            />
          </Card>

          <Card size="small" title="Khôi phục dữ liệu mẫu (chỉ quản lý)">
            <Typography.Paragraph type="secondary">
              Xóa toàn bộ dữ liệu đang lưu trong trình duyệt và tạo lại bộ dữ liệu mẫu của xưởng. Thao tác này không thể hoàn tác — hãy xuất bản sao lưu
              trước nếu cần giữ dữ liệu đã thao tác.
            </Typography.Paragraph>
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={busy || loading}
              onClick={() =>
                modal.confirm({
                  title: 'Khôi phục dữ liệu mẫu?',
                  content: 'Toàn bộ đơn hàng, lệnh sản xuất, phiếu kho và dữ liệu lương hiện có sẽ bị thay thế bằng bộ dữ liệu mẫu. Bạn có chắc chắn?',
                  okText: 'Xóa và tạo lại dữ liệu mẫu',
                  okButtonProps: { danger: true },
                  onOk: async () => {
                    setBusy(true);
                    try {
                      await resetInitialData(actor);
                      message.success('Đã tạo lại dữ liệu mẫu. Ứng dụng sẽ tải lại.');
                      window.setTimeout(() => window.location.reload(), 600);
                    } finally {
                      setBusy(false);
                    }
                  },
                })
              }
            >
              Khôi phục dữ liệu mẫu
            </Button>
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
              Trạng thái kỳ lương gần nhất: {(periods ?? []).sort((a, b) => b.periodKey.localeCompare(a.periodKey))[0] ? (
                <StatusTag kind="payroll" status={(periods ?? []).sort((a, b) => b.periodKey.localeCompare(a.periodKey))[0].status} />
              ) : (
                '—'
              )}{' '}
              · Ngày dữ liệu gần nhất: {formatDate(dbInfo?.seededAt)}
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
