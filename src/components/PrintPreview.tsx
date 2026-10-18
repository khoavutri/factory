import { Button, Modal } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

/** Xem trước và in chứng từ theo bố cục A4 (CSS @media print trong styles/global.scss) */
export function PrintPreview({
  open,
  onClose,
  children,
  title = 'Xem trước bản in',
  printLabel = 'In chứng từ',
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  printLabel?: string;
}) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={title}
      width={900}
      destroyOnHidden
      footer={[
        <Button key="close" onClick={onClose}>
          Đóng
        </Button>,
        <Button key="print" type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
          {printLabel}
        </Button>,
      ]}
    >
      <div className="print-root">{children}</div>
    </Modal>
  );
}
