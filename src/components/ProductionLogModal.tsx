import { useMemo, useState } from 'react';
import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { useRole } from '../app/RoleContext';
import { useAction } from '../hooks/useAction';
import { createProductionLog, updateProductionLog } from '../services/production';
import { DATE_FORMAT } from '../utils/format';
import { formatQuantity } from '../utils/money';
import { SHIFT_LABEL } from '../utils/status';
import type { ProductionLog, ShiftId, WorkOrder, WorkOrderStage } from '../types';

interface FormValues {
  workOrderId: string;
  stageId: string;
  employeeId: string;
  shift: ShiftId;
  date: Dayjs;
  quantityGood: number;
  quantityBad: number;
  note?: string;
}

/** Nội dung phiếu sản lượng: chọn lệnh → công đoạn đang chạy → nhân viên thuộc tổ */
function ProductionLogForm({
  defaultWorkOrderId,
  logToEdit,
  onClose,
  onSaved,
}: {
  defaultWorkOrderId?: string;
  logToEdit?: ProductionLog;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { actor } = useRole();
  const { message } = App.useApp();
  const { loading, run } = useAction();
  const [form] = Form.useForm<FormValues>();
  const initialWorkOrderId = logToEdit?.workOrderId ?? defaultWorkOrderId;
  const [workOrderId, setWorkOrderId] = useState<string | undefined>(initialWorkOrderId);
  const [stageId, setStageId] = useState<string | undefined>(logToEdit?.stageId);

  const workOrders = useLiveQuery(
    () => db.workOrders.filter((w) => w.status === 'WAITING' || w.status === 'IN_PROGRESS' || w.status === 'AWAITING_QC').toArray(),
    [],
  );
  // Lệnh đang mở có thể không nằm trong danh sách lệnh đang chạy (ví dụ lệnh đã xong) — vẫn hiển thị đúng nhãn
  const fallbackWorkOrder = useLiveQuery<WorkOrder | undefined>(
    () => (initialWorkOrderId ? db.workOrders.get(initialWorkOrderId) : Promise.resolve(undefined)),
    [initialWorkOrderId],
  );
  const selectableWorkOrders = useMemo(() => {
    const list = workOrders ?? [];
    if (fallbackWorkOrder && !list.some((w) => w.id === fallbackWorkOrder.id)) return [fallbackWorkOrder, ...list];
    return list;
  }, [workOrders, fallbackWorkOrder]);
  const stages = useLiveQuery(
    () => (workOrderId ? db.workOrderStages.where('workOrderId').equals(workOrderId).toArray() : Promise.resolve<WorkOrderStage[]>([])),
    [workOrderId],
  );
  const employees = useLiveQuery(() => db.employees.filter((e) => e.active).toArray(), []);
  const products = useLiveQuery(() => db.products.toArray(), []);

  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);
  const currentWorkOrder = (workOrders ?? []).find((w) => w.id === workOrderId);

  const stageOptions = useMemo(
    () =>
      (stages ?? [])
        .filter((s) => s.status === 'IN_PROGRESS' || s.status === 'DONE')
        .sort((a, b) => a.seq - b.seq)
        .map((s) => ({ value: s.id, label: `Bước ${s.seq} — ${s.name} (${s.status === 'DONE' ? 'đã xong' : 'đang làm'})` })),
    [stages],
  );

  const teamId = (stages ?? []).find((s) => s.id === stageId)?.teamId;
  const employeeOptions = useMemo(
    () =>
      (employees ?? [])
        .filter((e) => (teamId ? e.teamId === teamId : true))
        .map((e) => ({ value: e.id, label: `${e.code} — ${e.name}` })),
    [employees, teamId],
  );

  const submit = async () => {
    const values = await form.validateFields();
    const ok = logToEdit
      ? await run(
          (op) =>
            updateProductionLog(
              actor,
              logToEdit.id,
              {
                quantityGood: values.quantityGood,
                quantityBad: values.quantityBad ?? 0,
                shift: values.shift,
                employeeId: values.employeeId,
                note: values.note,
              },
              { operationId: op },
            ),
          { successMessage: 'Đã cập nhật phiếu sản lượng' },
        )
      : await run(
          (op) =>
            createProductionLog(
              actor,
              {
                workOrderId: values.workOrderId,
                stageId: values.stageId,
                employeeId: values.employeeId,
                shift: values.shift,
                date: values.date.format('YYYY-MM-DD'),
                quantityGood: values.quantityGood,
                quantityBad: values.quantityBad ?? 0,
                note: values.note,
              },
              { operationId: op },
            ),
          { successMessage: 'Đã ghi phiếu sản lượng' },
        );
    if (ok) {
      onSaved?.();
      onClose();
    } else {
      message.info('Kiểm tra lại công đoạn đang chạy và số lượng còn lại của lệnh.');
    }
  };

  return (
    <>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          workOrderId: initialWorkOrderId,
          stageId: logToEdit?.stageId,
          employeeId: logToEdit?.employeeId,
          shift: logToEdit?.shift ?? ('MORNING' as ShiftId),
          date: logToEdit ? dayjs(logToEdit.date) : dayjs(),
          quantityGood: logToEdit?.quantityGood,
          quantityBad: logToEdit?.quantityBad ?? 0,
          note: logToEdit?.note,
        }}
      >
        <Form.Item name="workOrderId" label="Lệnh sản xuất" rules={[{ required: true, message: 'Chọn lệnh sản xuất' }]}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="Chọn lệnh sản xuất"
            disabled={!!logToEdit}
            options={selectableWorkOrders.map((w) => ({
              value: w.id,
              label: `${w.code} — ${productById.get(w.productId)?.name ?? ''} (SL ${formatQuantity(w.quantity)})`,
            }))}
            onChange={(value) => {
              setWorkOrderId(value);
              setStageId(undefined);
              form.setFieldsValue({ stageId: undefined, employeeId: undefined });
            }}
          />
        </Form.Item>
        <Space size={12} style={{ width: '100%' }} wrap>
          <Form.Item name="stageId" label="Công đoạn đang chạy" rules={[{ required: true, message: 'Chọn công đoạn' }]} style={{ minWidth: 300 }}>
            <Select
              placeholder="Chọn công đoạn đã bắt đầu"
              options={stageOptions}
              disabled={!!logToEdit}
              onChange={(value) => {
                setStageId(value);
                form.setFieldValue('employeeId', undefined);
              }}
            />
          </Form.Item>
          <Form.Item name="employeeId" label="Nhân viên thực hiện" rules={[{ required: true, message: 'Chọn nhân viên' }]} style={{ minWidth: 240 }}>
            <Select showSearch optionFilterProp="label" placeholder="Nhân viên thuộc tổ" options={employeeOptions} />
          </Form.Item>
        </Space>
        <Space size={12} style={{ width: '100%' }} wrap>
          <Form.Item name="shift" label="Ca làm" rules={[{ required: true }]} style={{ width: 150 }}>
            <Select options={(Object.keys(SHIFT_LABEL) as ShiftId[]).map((s) => ({ value: s, label: SHIFT_LABEL[s] }))} />
          </Form.Item>
          <Form.Item name="date" label="Ngày ghi" rules={[{ required: true, message: 'Chọn ngày' }]} style={{ width: 170 }}>
            <DatePicker format={DATE_FORMAT} style={{ width: '100%' }} disabled={!!logToEdit} />
          </Form.Item>
          <Form.Item name="quantityGood" label="SL tốt" rules={[{ required: true, message: 'Nhập SL tốt' }]} style={{ width: 130 }}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="quantityBad" label="SL lỗi" style={{ width: 130 }}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Space>
        <Form.Item name="note" label="Ghi chú">
          <Input placeholder="Ví dụ: lô 1 buổi sáng, máy chấn tôn số 2" />
        </Form.Item>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Số lượng tốt của công đoạn không được vượt số lượng đơn vị của lệnh (khi làm lại sau QC không đạt, hệ thống cho phép ghi bù theo số lượng lỗi).
          {currentWorkOrder ? ` Lệnh ${currentWorkOrder.code} có SL ${formatQuantity(currentWorkOrder.quantity)}.` : ''}
        </Typography.Paragraph>
      </Form>
      <Space style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <Button onClick={onClose}>Đóng</Button>
        <Button type="primary" loading={loading} onClick={() => void submit()}>
          {logToEdit ? 'Lưu phiếu' : 'Ghi phiếu'}
        </Button>
      </Space>
    </>
  );
}

/** Modal ghi phiếu sản lượng: chọn lệnh → công đoạn đang chạy → nhân viên thuộc tổ */
export function ProductionLogModal({
  open,
  onClose,
  defaultWorkOrderId,
  logToEdit,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  defaultWorkOrderId?: string;
  logToEdit?: ProductionLog;
  onSaved?: () => void;
}) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnHidden
      title={logToEdit ? `Sửa phiếu ${logToEdit.code}` : 'Thêm phiếu sản lượng'}
    >
      <ProductionLogForm defaultWorkOrderId={defaultWorkOrderId} logToEdit={logToEdit} onClose={onClose} onSaved={onSaved} />
    </Modal>
  );
}
