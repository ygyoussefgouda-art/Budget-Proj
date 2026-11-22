/** Offline entry: an expense sent with a phone-made id is created at most once. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let db: Db;
const mkApp = () => createApp(db, { requireEmail: false, strongPasswords: false, csrfHeader: false, signupLimit: 1000, loginLimit: 1000 });
type Agent = ReturnType<typeof request.agent>;
let n = 0;
async function newUser(): Promise<Agent> {
  const a = request.agent(mkApp());
  await a.post('/api/auth/signup').send({ username: `p4.user${n++}`, password: 'phase-four-pass' }).expect(201);
  return a;
}
const cat = async (a: Agent) => (await a.post('/api/categories').send({ name: 'Food', month: '2026-11' }).expect(201)).body.id as number;
const count = async (clientId: string) =>
  (await db.query('SELECT COUNT(*)::int AS n FROM expenses WHERE client_id = $1', [clientId])).rows[0].n as number;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe('offline sync (client id)', () => {
  it('sending the same offline expense again returns the first one and changes nothing', async () => {
    const a = await newUser();
    const food = await cat(a);
    const body = { date: '2026-11-20', categoryId: food, amount: 7_500, description: 'Offline lunch', clientId: 'c0ffee00-1111-4222-8333-444455556666' };
    const first = await a.post('/api/expenses?force=1').send(body).expect(201);
    const again = await a.post('/api/expenses?force=1').send({ ...body, amount: 99_999 }).expect(200);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.amount).toBe(7_500); // the retry didn't overwrite anything
    expect(await count(body.clientId)).toBe(1);
  });

  it('parallel retries (two tabs, flaky connection) still make exactly one expense and one split entry', async () => {
    const a = await newUser();
    const food = await cat(a);
    const body = { date: '2026-11-20', categoryId: food, amount: 100, split: { person: 'Omar', share: 100 }, clientId: 'parallel-retry-0001' };
    const rs = await Promise.all([1, 2, 3, 4].map(() => a.post('/api/expenses?force=1').send(body)));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 200, 201]);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    expect(await count(body.clientId)).toBe(1);
    const loans = (await a.get('/api/state?month=2026-11')).body.loans;
    expect(loans).toHaveLength(1);
  });

  it('ids are per account, must look like ids, and survive delete + undo', async () => {
    const a = await newUser();
    const b = await newUser();
    const body = { date: '2026-11-20', amount: 500, clientId: 'shared-looking-id-01' };
    const ea = await a.post('/api/expenses?force=1').send({ ...body, categoryId: await cat(a) }).expect(201);
    await b.post('/api/expenses?force=1').send({ ...body, categoryId: await cat(b) }).expect(201); // another account: its own
    expect((await a.post('/api/expenses').send({ ...body, categoryId: ea.body.categoryId, clientId: 'bad id!' })).status).toBe(400);
    expect((await a.post('/api/expenses').send({ ...body, categoryId: ea.body.categoryId, clientId: 'short' })).status).toBe(400);

    const { undo } = (await a.delete(`/api/expenses/${ea.body.id}`).expect(200)).body;
    await a.post(`/api/undo/${undo}`).expect(200);
    const retry = await a.post('/api/expenses?force=1').send({ ...body, categoryId: ea.body.categoryId }).expect(200);
    expect(retry.body.id).toBe(ea.body.id); // undo kept its id, so a late retry still doesn't duplicate it
  });
});
