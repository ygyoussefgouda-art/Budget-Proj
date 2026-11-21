import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { log, requestId } from './log.js';

/** An error with an HTTP status that is safe to show to the user. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/**
 * A soft warning (duplicate entry, repaying more than owed...).
 * The client shows the message and can resend with ?force=1.
 */
export class ConfirmNeeded extends HttpError {
  constructor(message: string) {
    super(409, message, 'confirm');
  }
}

export const forced = (req: Request) => req.query.force === '1' || req.query.force === 'true';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
export const ah =
  (fn: AsyncHandler): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const i = err.issues[0];
    const field = i?.path?.join('.');
    res.status(400).json({ error: field ? `${field}: ${i.message}` : i?.message ?? 'Invalid input' });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  const pgCode = (err as { code?: string })?.code;
  if (pgCode === '23505') {
    res.status(409).json({ error: 'That already exists.', code: 'conflict' });
    return;
  }
  if (pgCode === '23503') {
    res.status(409).json({ error: 'This item is still in use.', code: 'in_use' });
    return;
  }
  if (['23514', '22P02', '22007', '22008', '22003', '22001'].includes(pgCode ?? '')) {
    res.status(400).json({ error: 'Invalid value.' });
    return;
  }
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body.' });
    return;
  }
  if ((err as { type?: string })?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Upload is too large.' });
    return;
  }
  const reqId = requestId(res);
  // Only name, message, code and stack: database errors also carry "detail"/"where" with row values.
  const e = err as { name?: string; message?: string; code?: string; stack?: string };
  const safe = { type: e?.name, message: e?.message?.slice(0, 500), code: e?.code, stack: e?.stack };
  log.error({ reqId, err: safe, method: req.method, path: req.originalUrl.split('?')[0] }, 'unexpected error');
  // The id lets the owner find this exact error in the server log.
  res.status(500).json({ error: 'Something went wrong on the server.', requestId: reqId });
}
