import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextFunction, Request, Response } from 'express';
import pino from 'pino';

/**
 * One JSON line per event on stdout (Docker keeps and rotates it).
 * Never log request bodies, cookies, passwords, reset codes or tokens: only method, path, status, timing, ids.
 */
export const log = pino({
  level: process.env.LOG_LEVEL || (process.env.VITEST ? 'silent' : 'info'),
  base: { app: 'budget-me' },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Belt and braces: if a header object ever reaches a log line, hide the secrets in it.
  redact: { paths: ['*.cookie', '*.authorization', '*["set-cookie"]', '*.password', '*.token'], censor: '[hidden]' },
});

const here = path.dirname(fileURLToPath(import.meta.url));
/** The app version from server/package.json ("0.6.0-alpha" → "0.6.0"). Same number as the web app. */
export const APP_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as { version?: string };
    return (pkg.version ?? '0.0.0').replace(/-.*$/, '');
  } catch {
    return '0.0.0';
  }
})();

/** Request id for this request (also sent back as the X-Request-Id header). */
export const requestId = (res: Response): string => (res.locals.requestId as string | undefined) ?? '-';

/** Gives every /api request an id and writes one access-log line when it finishes. */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const id = randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  const start = process.hrtime.bigint();
  const urlPath = req.originalUrl.split('?')[0]; // no query string: it can hold search text
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const line = {
      reqId: id,
      method: req.method,
      path: urlPath.length > 200 ? `${urlPath.slice(0, 200)}…` : urlPath,
      status: res.statusCode,
      ms: Math.round(ms * 10) / 10,
      userId: req.user?.id,
    };
    // Docker's health check calls /api/health every 30 s: keep it out of the normal log.
    if (line.path === '/api/health') log.debug(line, 'request');
    else if (res.statusCode >= 500) log.error(line, 'request');
    else log.info(line, 'request');
  });
  next();
}
