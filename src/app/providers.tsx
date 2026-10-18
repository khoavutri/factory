import { App as AntApp, ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import type { ReactNode } from 'react';
import { themeConfig } from './theme';
import { RoleProvider } from './RoleContext';

dayjs.locale('vi');

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={viVN}
      theme={themeConfig}
      form={{ validateMessages: { required: 'Vui lòng nhập ${label}' } }}
    >
      <AntApp>
        <RoleProvider>{children}</RoleProvider>
      </AntApp>
    </ConfigProvider>
  );
}
