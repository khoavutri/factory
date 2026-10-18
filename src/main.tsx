import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Result, Space } from 'antd';
import { Providers } from './app/providers';
import { AppRouter } from './app/router';
import { ensureSeed } from './db/seed';
import { db } from './db/database';
import './styles/global.scss';

/* eslint-disable react-refresh/only-export-components -- entry file doesn't need fast-refresh boundaries */
function FatalScreen({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <Result
      status="error"
      title="Không mở được dữ liệu trong trình duyệt"
      subTitle={
        <span>
          Ứng dụng không đọc được dữ liệu lưu cục bộ: <code>{message}</code>. Dữ liệu hiện có không bị xóa tự động. Bạn có thể thử lại,
          hoặc khôi phục dữ liệu mẫu nếu chấp nhận xóa dữ liệu đang lưu trong trình duyệt này.
        </span>
      }
      extra={
        <Space>
          <Button type="primary" onClick={() => window.location.reload()}>
            Thử lại
          </Button>
          <Button
            danger
            onClick={async () => {
              if (window.confirm('Xóa toàn bộ dữ liệu đang lưu và tạo lại dữ liệu mẫu?')) {
                await db.delete();
                window.location.reload();
              }
            }}
          >
            Khôi phục dữ liệu mẫu (xóa dữ liệu đang lưu)
          </Button>
        </Space>
      }
    />
  );
}

async function bootstrap() {
  const container = document.getElementById('root');
  if (!container) return;
  const root = createRoot(container);
  try {
    await ensureSeed();
    root.render(
      <StrictMode>
        <Providers>
          <AppRouter />
        </Providers>
      </StrictMode>,
    );
  } catch (error) {
    console.error('Lỗi khởi tạo dữ liệu', error);
    root.render(<FatalScreen error={error} />);
  }
}

void bootstrap();
