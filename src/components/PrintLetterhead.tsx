import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { DEFAULT_WORKSHOP_INFO, getSetting, SETTING_KEYS, type WorkshopInfo } from '../services/settings';

/** Khối tiêu đề mẫu in A4: tên, địa chỉ, liên hệ xưởng và phần bên phải (mã chứng từ, ngày) */
export function PrintLetterhead({ right, title }: { right?: ReactNode; title?: ReactNode }) {
  const workshop = useLiveQuery(() => getSetting<WorkshopInfo>(SETTING_KEYS.WORKSHOP_INFO, DEFAULT_WORKSHOP_INFO), [], DEFAULT_WORKSHOP_INFO);
  const contacts = [`ĐT: ${workshop.phone}`, workshop.email, workshop.website].filter(Boolean).join(' · ');
  return (
    <>
      <div className="print-header">
        <div>
          <strong>{workshop.name}</strong>
          <div>{workshop.address}</div>
          <div>
            MST: {workshop.taxCode} · {contacts}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>{right}</div>
      </div>
      {title ? <h2>{title}</h2> : null}
    </>
  );
}
