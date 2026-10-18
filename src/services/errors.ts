/** Lỗi nghiệp vụ hiển thị cho người dùng bằng câu có hành động khắc phục */
export class BusinessError extends Error {
  code: string;

  constructor(message: string, code = 'BUSINESS_RULE') {
    super(message);
    this.name = 'BusinessError';
    this.code = code;
  }
}

export class PermissionError extends BusinessError {
  constructor(message = 'Vai trò hiện tại không được phép thực hiện thao tác này.') {
    super(message, 'PERMISSION_DENIED');
    this.name = 'PermissionError';
  }
}

export class NotFoundError extends BusinessError {
  constructor(message = 'Không tìm thấy bản ghi cần xử lý. Có thể dữ liệu đã bị thay đổi ở tab khác.') {
    super(message, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export function assertRule(condition: unknown, message: string, code = 'BUSINESS_RULE'): asserts condition {
  if (!condition) throw new BusinessError(message, code);
}

export function businessErrorMessage(error: unknown): string {
  if (error instanceof BusinessError) return error.message;
  if (error instanceof Error) {
    if (error.name === 'QuotaExceededError') {
      return 'Dung lượng lưu trữ của trình duyệt đã đầy. Hãy giải phóng dữ liệu hoặc khôi phục bộ dữ liệu mẫu rồi thử lại.';
    }
    return error.message;
  }
  return 'Đã xảy ra lỗi không xác định.';
}
