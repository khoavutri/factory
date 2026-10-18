import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';

export function NotFoundPage({ path }: { path: string }) {
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="Không tìm thấy trang"
      subTitle={
        <span>
          Đường dẫn <code>{path}</code> không tồn tại trong FactoryOne.
        </span>
      }
      extra={
        <Button type="primary" onClick={() => navigate('/dashboard')}>
          Về trang tổng quan
        </Button>
      }
    />
  );
}
