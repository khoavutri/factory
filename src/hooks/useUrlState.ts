import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Giữ bộ lọc quan trọng trên URL để quay lại danh sách không mất ngữ cảnh.
 */
export function useUrlState<T extends Record<string, string | undefined>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const [params, setParams] = useSearchParams();

  const value = useMemo(() => {
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as Array<keyof T>) {
      const raw = params.get(String(key));
      if (raw != null && raw !== '') result[key] = raw as T[keyof T];
    }
    return result;
  }, [params, defaults]);

  const update = useCallback(
    (patch: Partial<T>) => {
      const next = new URLSearchParams(params);
      for (const [key, val] of Object.entries(patch)) {
        if (val == null || val === '') next.delete(key);
        else next.set(key, String(val));
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  return [value, update];
}
