/** 0.6.0 reliability basics: /api/version, request ids, crash reports, 500s carry a request id. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgliteDb, type Db } from '../src/db.js';
import { errorHandler } from '../src/http.js';
import { APP_VERSION, requestLogger } from '../src/log.js';
import { migrate } from '../src/migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe('GET /api/version', () => {
  it('is public and returns web, api and minNativeVersionCode', async () => {
    const r = await request(createApp(db, { minNativeVersionCode: 7 })).get('/api/version').expect(200);
    expect(r.body).toEqual({ web: APP_VERSION, api: APP_VERSION, minNativeVersionCode: 7 });
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(r.headers['cache-control']).toBe('no-store');
    expect((await request(createApp(db)).get('/api/version')).body.minNativeVersionCode).toBe(0);
  });

  it('every API answer carries a request id', async () => {
    const a = await request(createApp(db)).get('/api/health');
    const b = await request(createApp(db)).get('/api/nothing-here');
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });
});

describe('POST /api/client-errors', () => {
  const report = { message: 'Cannot read properties of undefined', stack: 'at Foo (x.js:1:2)', page: '/expenses', version: '0.6.0', kind: 'render' };

  it('accepts a short report without sign-in, but needs the CSRF header', async () => {
    await request(createApp(db)).post('/api/client-errors').set('X-Requested-With', 'budget-me').send(report).expect(204);
    expect((await request(createApp(db)).post('/api/client-errors').send(report)).status).toBe(403);
  });

  it('rejects empty or oversized reports', async () => {
    const app = createApp(db, { csrfHeader: false });
    expect((await request(app).post('/api/client-errors').send({ message: '' })).status).toBe(400);
    expect((await request(app).post('/api/client-errors').send({ ...report, stack: 'x'.repeat(5000) })).status).toBe(400);
    expect((await request(app).post('/api/client-errors').send({ ...report, kind: 'other' })).status).toBe(400);
  });

  it('is rate limited per network', async () => {
    const app = createApp(db, { csrfHeader: false, clientErrorLimit: 2 });
    await request(app).post('/api/client-errors').send(report).expect(204);
    await request(app).post('/api/client-errors').send(report).expect(204);
    expect((await request(app).post('/api/client-errors').send(report)).status).toBe(429);
  });
});

describe('unexpected errors', () => {
  it('answer 500 with the request id and no details', async () => {
    const app = express();
    app.use('/api', requestLogger);
    app.get('/api/boom', () => {
      throw new Error('secret internal detail');
    });
    app.use('/api', errorHandler);
    const r = await request(app).get('/api/boom').expect(500);
    expect(r.body).toEqual({ error: 'Something went wrong on the server.', requestId: r.headers['x-request-id'] });
    expect(JSON.stringify(r.body)).not.toContain('secret');
  });
});
