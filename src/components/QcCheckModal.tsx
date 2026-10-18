import { useMemo, useState } from 'react';
import { Alert, App, Button, Descriptions, Form, Input, InputNumber, Modal, Radio, Select, Space, Typography } from 'antd';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { useRole } from '../app/RoleContext';
import { useAction } from '../hooks/useAction';
import { recordQcCheck } from '../services/production';
import { DEFECT_TYPE_LABEL, QC_RESULT_META } from '../utils/status';
import { formatQuantity } from '../utils/money';
import type { DefectType, QcResult, WorkOrder } from '../types';

interface FormValues {
  workOrderId: string;
  checkedQty: number;
  passedQty: number;
  defectType: DefectType;
  result: QcResult;
  note?: string;
}

/** Nội dung phiếu QC: trạng thái khởi tạo khi mở modal nên không cần effect đồng bộ */
function QcCheckForm({
  waiting,
  defaultWorkOrderId,
  onClose,
  onSaved,
}: {
  waiting: WorkOrder[];
  defaultWorkOrderId?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { actor } = useRole();
  const { message } = App.useApp();
  const { loading, run } = useAction();
  const initialId = defaultWorkOrderId ?? waiting[0]?.id;
  const initialOrder = waiting.find((w) => w.id === initialId);
  const [workOrderId, setWorkOrderId] = useState<string | undefined>(initialId);
  const [checkedQty, setCheckedQty] = useState<number | null>(initialOrder?.quantity ?? null);
  const [passedQty, setPassedQty] = useState<number | null>(initialOrder?.quantity ?? null);
  const [result, setResult] = useState<QcResult>('PASSED');
  const [form] = Form.useForm<FormValues>();

  const products = useLiveQuery(() => db.products.toArray(), []);
  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);
  const selected = waiting.find((w) => w.id === workOrderId);
  const failedQty = checkedQty != null && passedQty != null ? Math.max(0, checkedQty - passedQty) : 0;

  const submit = async () => {
    const values = await form.validateFields();
    const ok = await run(
      (op) =>
        recordQcCheck(
          actor,
          {
            workOrderId: values.workOrderId,
            checkedQty: values.checkedQty,
            passedQty: values.passedQty,
            failedQty: Math.max(0, values.checkedQty - values.passedQty),
            defectType: values.defectType,
            result: values.result,
            note: values.note,
          },
          { operationId: op },
        ),
      {
        successMessage: values.result === 'PASSED' ? 'QC đạt: đã nhập kho thành phẩm' : 'QC không đạt: lệnh quay lại xưởng để làm lại',
      },
    );
    if (ok) {
      onSaved?.();
      onClose();
    } else {
      message.info('Kiểm tra lại số lượng kiểm/đạt và kết luận trước khi ghi.');
    }
  };

  return (
    <>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          workOrderId: initialId,
          checkedQty: initialOrder?.quantity,
          passedQty: initialOrder?.quantity,
          defectType: 'DIMENSION' as DefectType,
          result: 'PASSED' as QcResult,
        }}
      >
        <Form.Item name="workOrderId" label="Lệnh sản xuất chờ kiểm" rules={[{ required: true, message: 'Chọn lệnh sản xuất' }]}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="Chọn lệnh sản xuất"
            disabled={!!defaultWorkOrderId}
            options={waiting.map((w) => ({
              value: w.id,
              label: `${w.code} — ${productById.get(w.productId)?.name ?? ''} (SL ${formatQuantity(w.quantity)}${
                w.reworkCount > 0 ? `, làm lại ${w.reworkCount} lần` : ''
              })`,
            }))}
            onChange={(value) => {
              setWorkOrderId(value);
              const order = waiting.find((w) => w.id === value);
              setCheckedQty(order?.quantity ?? null);
              setPassedQty(order?.quantity ?? null);
              form.setFieldsValue({ checkedQty: order?.quantity, passedQty: order?.quantity });
            }}
          />
        </Form.Item>
        {selected ? (
          <Descriptions size="small" column={3} style={{ marginBottom: 12 }}>
            <Descriptions.Item label="Sản phẩm">{productById.get(selected.productId)?.name ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Số lượng lệnh">{formatQuantity(selected.quantity)}</Descriptions.Item>
            <Descriptions.Item label="Số lần làm lại">{selected.reworkCount}</Descriptions.Item>
          </Descriptions>
        ) : null}
        {selected && selected.reworkCount > 0 ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            title={`Lệnh đã làm lại ${selected.reworkCount} lần. Kiểm kỹ lại các lỗi đã yêu cầu khắc phục trước đó.`}
          />
        ) : null}
        <Space size={12} style={{ width: '100%' }} wrap>
          <Form.Item name="checkedQty" label="SL kiểm" rules={[{ required: true, message: 'Nhập SL kiểm' }]} style={{ width: 130 }}>
            <InputNumber min={0} style={{ width: '100%' }} onChange={(v) => setCheckedQty(v ?? null)} />
          </Form.Item>
          <Form.Item name="passedQty" label="SL đạt" rules={[{ required: true, message: 'Nhập SL đạt' }]} style={{ width: 130 }}>
            <InputNumber min={0} style={{ width: '100%' }} onChange={(v) => setPassedQty(v ?? null)} />
          </Form.Item>
          <Form.Item label="SL lỗi (tự tính)" style={{ width: 130 }}>
            <InputNumber value={failedQty} disabled style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="defectType" label="Loại lỗi chính" rules={[{ required: true }]} style={{ width: 200 }}>
            <Select options={(Object.keys(DEFECT_TYPE_LABEL) as DefectType[]).map((d) => ({ value: d, label: DEFECT_TYPE_LABEL[d] }))} />
          </Form.Item>
        </Space>
        <Form.Item name="result" label="Kết luận" rules={[{ required: true }]}>
          <Radio.Group
            onChange={(e) => setResult(e.target.value as QcResult)}
            options={[
              { value: 'PASSED', label: `${QC_RESULT_META.PASSED.label} — nhập kho thành phẩm, lệnh hoàn thành` },
              { value: 'FAILED', label: `${QC_RESULT_META.FAILED.label} — lệnh quay lại xưởng làm lại` },
            ]}
          />
        </Form.Item>
        <Form.Item name="note" label="Ghi chú kiểm tra">
          <Input.TextArea rows={2} placeholder="Mô tả lỗi cụ thể, vị trí, yêu cầu khắc phục..." />
        </Form.Item>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {result === 'PASSED'
            ? `Số lượng đạt sẽ được cộng vào tồn thành phẩm${selected ? ` của "${productById.get(selected.productId)?.name ?? ''}"` : ''}.`
            : 'Khi không đạt, lệnh quay lại công đoạn cuối đã hoàn thành, số lần làm lại tăng thêm 1 và ghi vào nhật ký lệnh.'}
        </Typography.Paragraph>
      </Form>
      <Space style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <Button onClick={onClose}>Đóng</Button>
        <Button type="primary" loading={loading} onClick={() => void submit()}>
          Ghi kết quả kiểm
        </Button>
      </Space>
    </>
  );
}

/** Modal kiểm tra chất lượng: Đạt → nhập kho thành phẩm; Không đạt → lệnh quay lại làm lại */
export function QcCheckModal({
  open,
  onClose,
  defaultWorkOrderId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  defaultWorkOrderId?: string;
  onSaved?: () => void;
}) {
  const waiting = useLiveQuery(() => db.workOrders.where('status').equals('AWAITING_QC').toArray(), []);
  return (
    <Modal open={open} onCancel={onClose} footer={null} width={720} destroyOnHidden title="Phiếu kiểm tra chất lượng">
      {waiting && waiting.length === 0 ? (
        <Alert type="success" showIcon title="Hiện không có lệnh nào đang chờ QC." />
      ) : (
        <QcCheckForm waiting={waiting ?? []} defaultWorkOrderId={defaultWorkOrderId} onClose={onClose} onSaved={onSaved} />
      )}
    </Modal>
  );
}
