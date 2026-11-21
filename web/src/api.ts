import { t, tServer } from './i18n';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export async function api<T = unknown>(path: string, method: Method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, t('Cannot reach the server. Check your connection.'));
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, tServer(data.error ?? `Request failed (${res.status}).`), data.code);
  return data as T;
}

export type ConfirmFn = (title: string, message: string, action?: string) => Promise<boolean>;

/**
 * Saves, and if the server answers with a soft warning (duplicate, more than
 * owed...), asks the user and retries with ?force=1. Returns the saved item,
 * or false if the user cancelled.
 */
export async function saveWithConfirm<T = unknown>(
  path: string,
  method: Method,
  body: unknown,
  confirm: ConfirmFn,
): Promise<T | false> {
  try {
    return await api<T>(path, method, body);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'confirm') {
      const ok = await confirm(t('Please check'), e.message, t('Save anyway'));
      if (!ok) return false;
      return await api<T>(`${path}${path.includes('?') ? '&' : '?'}force=1`, method, body);
    }
    throw e;
  }
}

/** Uploads (or replaces) the receipt of an expense. */
export async function uploadReceipt(expenseId: number, file: Blob): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/expenses/${expenseId}/receipt`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
  } catch {
    throw new ApiError(0, t('Cannot reach the server. Check your connection.'));
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, tServer(data.error ?? `Upload failed (${res.status}).`), data.code);
  }
}

export const receiptUrl = (expenseId: number, version = '') => `/api/expenses/${expenseId}/receipt${version ? `?v=${version}` : ''}`;
