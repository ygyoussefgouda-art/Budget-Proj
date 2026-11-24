/** 2.1.0: new accounts start with a few everyday categories, in the sign-up screen's language. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let db: Db;
const mk = (starterCategories: boolean) => createApp(db, { requireEmail: false, strongPasswords: false, csrfHeader: false, starterCategories });

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
}, 60_000);
afterAll(async () => {
  await db?.close();
});

const namesOf = async (username: string) =>
  (await db.query('SELECT c.name, c.icon FROM categories c JOIN users u ON u.id = c.user_id WHERE u.username = $1 ORDER BY c.sort', [username])).rows;

describe('starter categories', () => {
  it('a new account gets six categories with icons, in English by default', async () => {
    await request(mk(true)).post('/api/auth/signup').send({ username: 'starter.en', password: 'long-enough-pass' }).expect(201);
    const rows = await namesOf('starter.en');
    expect(rows.map((r) => r.name)).toEqual(['Food', 'Transport', 'Coffee', 'Going out', 'Phone & internet', 'Uni']);
    expect(rows.every((r) => r.icon)).toBe(true);
  });

  it('in Arabic when signing up from the Arabic screen', async () => {
    await request(mk(true)).post('/api/auth/signup').send({ username: 'starter.ar', password: 'long-enough-pass', lang: 'ar' }).expect(201);
    expect((await namesOf('starter.ar')).map((r) => r.name)).toEqual(['أكل', 'مواصلات', 'قهوة', 'خروجات', 'موبايل ونت', 'الجامعة']);
  });

  it('switched off: the account starts empty; an unknown language is refused', async () => {
    await request(mk(false)).post('/api/auth/signup').send({ username: 'starter.off', password: 'long-enough-pass' }).expect(201);
    expect(await namesOf('starter.off')).toEqual([]);
    await request(mk(true)).post('/api/auth/signup').send({ username: 'starter.xx', password: 'long-enough-pass', lang: 'fr' }).expect(400);
  });
});
