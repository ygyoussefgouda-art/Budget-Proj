/** Tags, split with someone, foreign currency, CSV / Excel export, tag report. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { crc32 } from '../src/xlsx.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let db: Db;
const mkApp = () => createApp(db, { csrfHeader: false, signupLimit: 1000, loginLimit: 1000 });
type Agent = ReturnType<typeof request.agent>;
let n = 0;
async function newUser(): Promise<Agent> {
  const a = request.agent(mkApp());
  await a.post('/api/auth/signup').send({ username: `p3.user${n++}`, password: 'phase-three-pass' }).expect(201);
  return a;
}
const cat = async (a: Agent, name = 'Food') => (await a.post('/api/categories').send({ name, month: '2026-11' }).expect(201)).body.id as number;
const binary = (a: Agent, url: string) =>
  a
    .get(url)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

/** Reads a stored (uncompressed) zip: name → content. Checks every CRC. */
function unzip(buf: Buffer) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataStart, dataStart + size);
    expect(crc32(data)).toBe(crc);
    out[name] = data.toString('utf8');
    p += 46 + nameLen;
  }
  return out;
}

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe('tags', () => {
  it('are cleaned up (no #, lower-case, no repeats), searchable and filterable', async () => {
    const a = await newUser();
    const food = await cat(a);
    const e = (await a.post('/api/expenses').send({ date: '2026-11-03', categoryId: food, amount: 500, description: 'Pizza', tags: ['#Trip', 'friends', 'TRIP', 'سفر'] }).expect(201)).body;
    expect(e.tags).toEqual(['trip', 'friends', 'سفر']);
    await a.post('/api/expenses').send({ date: '2026-11-04', categoryId: food, amount: 100, description: 'Bread', tags: ['home'] }).expect(201);
    await a.post('/api/expenses').send({ date: '2026-11-05', categoryId: food, amount: 50, description: 'Water' }).expect(201);

    expect((await a.get('/api/expenses?tag=%23Trip').expect(200)).body.items.map((x: any) => x.description)).toEqual(['Pizza']);
    expect((await a.get('/api/expenses?q=friend').expect(200)).body.items.map((x: any) => x.description)).toEqual(['Pizza']);
    expect((await a.get(`/api/expenses?tag=${encodeURIComponent('سفر')}`).expect(200)).body.count).toBe(1);
    const tags = (await a.get('/api/tags').expect(200)).body;
    expect(tags.map((x: any) => x.tag).sort()).toEqual(['friends', 'home', 'trip', 'سفر'].sort());

    // edit replaces the tags
    const up = (await a.put(`/api/expenses/${e.id}`).send({ date: '2026-11-03', categoryId: food, amount: 500, description: 'Pizza', tags: [] }).expect(200)).body;
    expect(up.tags).toEqual([]);
  });

  it('rejects odd characters and more than 5 tags', async () => {
    const a = await newUser();
    const food = await cat(a);
    const base = { date: '2026-11-03', categoryId: food, amount: 500 };
    expect((await a.post('/api/expenses').send({ ...base, tags: ['bad tag'] })).status).toBe(400);
    expect((await a.post('/api/expenses').send({ ...base, tags: ['<script>'] })).status).toBe(400);
    expect((await a.post('/api/expenses').send({ ...base, tags: ['a', 'b', 'c', 'd', 'e', 'f'] })).status).toBe(400);
    expect((await a.post('/api/expenses').send({ ...base, tags: ['x'.repeat(31)] })).status).toBe(400);
  });
});

describe('split with someone', () => {
  it('my share is the expense; their share is a linked "Owed to me" entry that follows edits', async () => {
    const a = await newUser();
    const food = await cat(a);
    const e = (
      await a.post('/api/expenses').send({ date: '2026-11-10', categoryId: food, amount: 150, description: 'Dinner', split: { person: 'Omar', share: 150 } }).expect(201)
    ).body;
    expect(e.amount).toBe(150);
    expect(e.split).toMatchObject({ person: 'Omar', share: 150 });
    let loans = (await a.get('/api/state?month=2026-11').expect(200)).body.loans;
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({ person: 'Omar', amount: 150, borrowed: false, repayment: false, note: 'Dinner', expenseId: e.id, date: '2026-11-10' });

    // Edit: Omar's share becomes 100, the date moves
    await a.put(`/api/expenses/${e.id}`).send({ date: '2026-11-11', categoryId: food, amount: 200, description: 'Dinner', split: { person: 'Omar', share: 100 } }).expect(200);
    loans = (await a.get('/api/state?month=2026-11').expect(200)).body.loans;
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({ amount: 100, date: '2026-11-11', expenseId: e.id });

    // Remove the split: the entry goes
    await a.put(`/api/expenses/${e.id}`).send({ date: '2026-11-11', categoryId: food, amount: 300, description: 'Dinner', split: null }).expect(200);
    expect((await a.get('/api/state?month=2026-11').expect(200)).body.loans).toEqual([]);
  });

  it('deleting the expense removes the entry too, and Undo brings both back', async () => {
    const a = await newUser();
    const food = await cat(a);
    const e = (
      await a.post('/api/expenses').send({ date: '2026-11-10', categoryId: food, amount: 60, split: { person: 'Mona', share: 40 } }).expect(201)
    ).body;
    const loanId = (await a.get('/api/state?month=2026-11')).body.loans[0].id;
    const { undo } = (await a.delete(`/api/expenses/${e.id}`).expect(200)).body;
    let s = (await a.get('/api/state?month=2026-11')).body;
    expect(s.expenses).toEqual([]);
    expect(s.loans).toEqual([]);
    await a.post(`/api/undo/${undo}`).expect(200);
    s = (await a.get('/api/state?month=2026-11')).body;
    expect(s.expenses[0]).toMatchObject({ id: e.id, split: { person: 'Mona', share: 40, loanId } });
    expect(s.loans[0]).toMatchObject({ id: loanId, expenseId: e.id });
  });
});

describe('foreign currency', () => {
  it('stores the original amount and rate; the converted amount must add up', async () => {
    const a = await newUser();
    const food = await cat(a);
    // 10.00 USD at 49.5 = 495.00 EGP
    const ok = { date: '2026-11-12', categoryId: food, description: 'Coffee abroad', amount: 49_500, foreign: { amount: 1_000, currency: 'USD', rate: 49.5 } };
    const e = (await a.post('/api/expenses').send(ok).expect(201)).body;
    expect(e.foreign).toEqual({ amount: 1_000, currency: 'USD', rate: 49.5 });
    expect(e.amount).toBe(49_500);
    expect((await a.post('/api/expenses?force=1').send({ ...ok, amount: 49_000 })).status).toBe(400); // doesn't add up
    expect((await a.post('/api/expenses?force=1').send({ ...ok, foreign: { ...ok.foreign, currency: 'EGP' } })).status).toBe(400); // own currency
    expect((await a.post('/api/expenses?force=1').send({ ...ok, foreign: { ...ok.foreign, currency: 'usd' } })).status).toBe(400);
    expect((await a.post('/api/expenses?force=1').send({ ...ok, foreign: { ...ok.foreign, rate: 0 } })).status).toBe(400);
    // with a split: my share + their share = the converted bill
    const split = { ...ok, amount: 29_500, split: { person: 'Ali', share: 20_000 } };
    expect((await a.post('/api/expenses?force=1').send(split)).status).toBe(201);
    // removing the currency
    const plain = (await a.put(`/api/expenses/${e.id}`).send({ ...ok, foreign: null }).expect(200)).body;
    expect(plain.foreign).toBeNull();
  });
});

describe('backup keeps tags, currency and splits', () => {
  it('round trip', async () => {
    const a = await newUser();
    const food = await cat(a);
    await a.post('/api/expenses').send({
      date: '2026-11-12', categoryId: food, amount: 29_500, tags: ['trip'],
      foreign: { amount: 1_000, currency: 'USD', rate: 49.5 }, split: { person: 'Ali', share: 20_000 },
    }).expect(201);
    const backup = (await a.get('/api/backup').expect(200)).body;
    await a.post('/api/backup/restore').send({ password: 'phase-three-pass', backup }).expect(200);
    const s = (await a.get('/api/state?month=2026-11')).body;
    expect(s.expenses[0]).toMatchObject({ amount: 29_500, tags: ['trip'], foreign: { amount: 1_000, currency: 'USD', rate: 49.5 }, split: { person: 'Ali', share: 20_000 } });
    expect(s.loans[0].expenseId).toBe(s.expenses[0].id);
  });
});

describe('export', () => {
  async function setUp() {
    const a = await newUser();
    const food = await cat(a, 'أكل');
    await a.post('/api/expenses').send({ date: '2026-11-01', categoryId: food, amount: 4_550, description: 'كشري, "large"', tags: ['lunch'] }).expect(201);
    await a.post('/api/expenses').send({ date: '2026-11-02', categoryId: food, amount: 12_000, description: '=HYPERLINK("http://evil")' }).expect(201);
    await a.post('/api/expenses').send({ date: '2026-10-15', categoryId: food, amount: 100, description: 'October' }).expect(201);
    await a.post('/api/loans').send({ date: '2026-11-03', person: 'Omar', borrowed: true, repayment: false, amount: 50_000 }).expect(201);
    const goal = (await a.post('/api/goals').send({ name: 'Laptop', target: 1_000_000 }).expect(201)).body.id;
    await a.post(`/api/goals/${goal}/entries`).send({ date: '2026-11-04', deposit: true, amount: 20_000, note: 'first' }).expect(201);
    return a;
  }

  it('CSV: BOM for Excel, quoted text, no formulas, date range and filters', async () => {
    const a = await setUp();
    const r = await binary(a, '/api/export?kind=expenses&from=2026-11-01&to=2026-11-30&format=csv');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['content-disposition']).toBe('attachment; filename="budget-me-expenses-2026-11-01-to-2026-11-30.csv"');
    const buf = r.body as Buffer;
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    const lines = buf.toString('utf8').slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(3); // header + 2 November rows (October excluded)
    expect(lines[0]).toBe('"Date","Category","Description","Amount","Currency","Tags","Split with","Their share","Original amount","Original currency","Rate"');
    expect(lines[1]).toBe('"2026-11-01","أكل","كشري, ""large""",45.5,"EGP","#lunch",,,,,');
    expect(lines[2]).toContain('"\'=HYPERLINK(""http://evil"")"'); // neutralised: stays text in Excel
    // filters from the Expenses screen
    const tagged = (await binary(a, '/api/export?kind=expenses&tag=lunch')).body.toString('utf8');
    expect(tagged.trimEnd().split('\r\n')).toHaveLength(2);
  });

  it('Arabic headers; loans and savings exports', async () => {
    const a = await setUp();
    const ar = (await binary(a, '/api/export?kind=loans&lang=ar')).body.toString('utf8');
    expect(ar).toContain('"التاريخ","الشخص","الجهة","النوع","المبلغ","العملة","ملاحظة"');
    expect(ar).toContain('"2026-11-03","Omar","عليّا","استلفت",500,"EGP",""');
    const sav = (await binary(a, '/api/export?kind=savings')).body.toString('utf8');
    expect(sav).toContain('"2026-11-04","Laptop","Deposit",200,"EGP","first"');
  });

  it('Excel: a valid .xlsx with the rows (right-to-left in Arabic)', async () => {
    const a = await setUp();
    const r = await binary(a, '/api/export?kind=expenses&format=xlsx&lang=ar&from=2026-11-01&to=2026-11-30');
    expect(r.headers['content-type']).toMatch(/spreadsheetml/);
    const files = unzip(r.body as Buffer);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']),
    );
    const sheet = files['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('rightToLeft="1"');
    expect(sheet).toContain('كشري, &quot;large&quot;');
    expect(sheet).toContain('<v>45.5</v>');
    expect(sheet).toContain('=HYPERLINK(&quot;http://evil&quot;)</t>'); // inline text, never a formula
    expect(sheet).not.toContain('<f>');
    expect(files['xl/workbook.xml']).toContain('name="المصاريف"');
  });

  it('only your own data, and bad parameters are refused', async () => {
    await setUp();
    const b = await newUser();
    const mine = (await binary(b, '/api/export?kind=expenses')).body.toString('utf8');
    expect(mine.trimEnd().split('\r\n')).toHaveLength(1); // header only
    expect((await b.get('/api/export?kind=users')).status).toBe(400);
    expect((await b.get('/api/export?kind=expenses&format=pdf')).status).toBe(400);
    expect((await b.get('/api/export?kind=expenses&from=yesterday')).status).toBe(400);
    expect((await request(mkApp()).get('/api/export?kind=expenses')).status).toBe(401);
  });
});

describe('tag report', () => {
  it('spending per tag in a range; an expense with two tags counts under both', async () => {
    const a = await newUser();
    const food = await cat(a);
    const add = (amount: number, tags: string[], date = '2026-11-05') =>
      a.post('/api/expenses?force=1').send({ date, categoryId: food, amount, tags }).expect(201);
    await add(1_000, ['trip', 'friends']);
    await add(500, ['trip']);
    await add(300, []);
    await add(9_999, ['trip'], '2026-09-01'); // outside
    const r = (await a.get('/api/reports/tags?from=2026-11-01&to=2026-11-30').expect(200)).body;
    expect(r.tags).toEqual([
      { tag: 'trip', total: 1_500, count: 2 },
      { tag: 'friends', total: 1_000, count: 1 },
    ]);
    expect(r).toMatchObject({ total: 1_800, untagged: 300 });
    expect((await a.get('/api/reports/tags?from=2026-11-30&to=2026-11-01')).status).toBe(400);
  });
});
