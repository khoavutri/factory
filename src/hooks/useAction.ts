import { useCallback, useState } from 'react';
import { App } from 'antd';
import { businessErrorMessage, BusinessError } from '../services/errors';
import { newOperationId } from '../utils/ids';

export interface RunOptions<T> {
  successMessage?: string;
  onSuccess?: (result: T) => void;
  onBusinessError?: (error: BusinessError) => void;
  silentError?: boolean;
}

/**
 * Bọc lời gọi service: chặn bấm lặp, hiển thị lỗi nghiệp vụ bằng câu có hành động khắc phục,
 * giữ nguyên operationId khi gặp lỗi để lần bấm lại vẫn chống ghi trùng.
 */
export function useAction() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  const run = useCallback(
    async <T,>(fn: (operationId: string) => Promise<T>, options: RunOptions<T> = {}): Promise<T | undefined> => {
      if (loading) return undefined;
      setLoading(true);
      const operationId = newOperationId();
      try {
        const result = await fn(operationId);
        if (options.successMessage) message.success(options.successMessage);
        options.onSuccess?.(result);
        return result;
      } catch (error) {
        if (error instanceof BusinessError) {
          if (!options.silentError && !options.onBusinessError) message.error(error.message);
          options.onBusinessError?.(error);
        } else {
          message.error(businessErrorMessage(error));
        }
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [loading, message],
  );

  return { loading, run };
}
