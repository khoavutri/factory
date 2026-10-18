import { Tag } from 'antd';
import type { StatusMeta } from '../utils/status';
import {
  DOC_STATUS_META,
  ORDER_STATUS_META,
  PAYROLL_STATUS_META,
  QC_RESULT_META,
  STAGE_STATUS_META,
  WORK_ORDER_PRIORITY_META,
  WORK_ORDER_STATUS_META,
  statusMeta,
} from '../utils/status';

const META_BY_KIND = {
  order: ORDER_STATUS_META,
  workOrder: WORK_ORDER_STATUS_META,
  priority: WORK_ORDER_PRIORITY_META,
  stage: STAGE_STATUS_META,
  qc: QC_RESULT_META,
  doc: DOC_STATUS_META,
  payroll: PAYROLL_STATUS_META,
} as const;

export function StatusTag({
  kind,
  status,
  prefix,
}: {
  kind: keyof typeof META_BY_KIND;
  status?: string | null;
  prefix?: string;
}) {
  const meta: StatusMeta = statusMeta(META_BY_KIND[kind], status);
  return (
    <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
      {prefix ? `${prefix}: ` : ''}
      {meta.label}
    </Tag>
  );
}
