import { Button, Result, Space } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useRole } from '../../app/RoleContext';
import { ROLE_LABEL } from '../../utils/status';

export function AccessDeniedPage() {
  const navigate = useNavigate();
  const { role } = useRole();
  return (
    <Result
      status="403"
      title="Không có quyền truy cập"
      subTitle={
        <span>
          Vai trò hiện tại (<strong>{ROLE_LABEL[role]}</strong>) không được phép mở màn hình này. Hãy chuyển vai trò ở góc phải trên hoặc quay về
          trang làm việc mặc định.
        </span>
      }
      extra={
        <Space>
          <Button type="primary" onClick={() => navigate('/dashboard')}>
            Về trang tổng quan
          </Button>
        </Space>
      }
    />
  );
}
