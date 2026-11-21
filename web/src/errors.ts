import { ApiError } from './api';
import { APP_VERSION } from './version';

type Kind = 'render' | 'error' | 'unhandledrejection';

let sent = 0;
const seen = new Set<string>();
const MAX_PER_PAGE = 5;

/**
 * Sends a short crash report to the server log (POST /api/client-errors), so the owner can see
 * what broke on someone's phone. Only the message, stack, page path and version: never form data.
 */
export function reportClientError(kind: Kind, error: unknown, componentStack?: string) {
  // Expected API problems (offline, 4xx) are shown to the user already; not a crash.
  if (error instanceof ApiError && (error.status === 0 || error.status < 500)) return;
  const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error');
  const message = (e.message || e.name || 'Error').slice(0, 500);
  const key = `${kind}:${message}`;
  if (sent >= MAX_PER_PAGE || seen.has(key)) return;
  seen.add(key);
  sent++;
  const body = {
    kind,
    message,
    stack: e.stack?.slice(0, 4000),
    componentStack: componentStack?.slice(0, 4000),
    page: location.pathname.slice(0, 300), // path only: no query string
    version: APP_VERSION,
  };
  fetch('/api/client-errors', {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'budget-me' },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

/** Catches errors outside React rendering (event handlers, timers, promises nobody awaited). */
export function watchGlobalErrors() {
  window.addEventListener('error', (ev) => {
    // Failed <img>/<script> loads also fire "error" with no error object: ignore those.
    if (ev.error) reportClientError('error', ev.error);
  });
  window.addEventListener('unhandledrejection', (ev) => reportClientError('unhandledrejection', ev.reason));
}
