// Presentation screenshots of Budget me (phone size, dark, light and Arabic) with a realistic demo account.
// Starts its own copy of the app on port 3200 with an empty in-memory database (nothing else is touched).
//   cd web && npm run build        (first)
//   node scripts/screenshots.mjs   (from the repo root; uses e2e's Playwright)
// Output: design/screenshots/*.png
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'e2e', 'package.json'));
const { chromium, devices, request: pwRequest } = require('@playwright/test');
const PORT = 3200;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(root, 'design', 'screenshots');
mkdirSync(OUT, { recursive: true });

// ---------- start the app ----------
const server = spawn(process.execPath, [path.join(root, 'server', 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/index.ts'], {
  cwd: path.join(root, 'server'),
  env: {
    ...process.env,
    PORT: String(PORT),
    DB_DRIVER: 'pglite',
    PGLITE_DIR: '',
    PUBLIC_DIR: path.join(root, 'web', 'dist'),
    ALLOW_SIGNUP: 'true',
    APP_PASSWORD: '',
    LOGIN_RATE_LIMIT: '1000',
    SIGNUP_RATE_LIMIT: '1000',
    LOG_LEVEL: 'warn',
    NODE_ENV: 'development',
  },
  stdio: 'inherit',
});
const stop = () => server.kill();
process.on('exit', stop);
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 500));
}

// ---------- demo data ----------
const EGP = (n) => Math.round(n * 100);
const M = '2026-11';
const NAMES = {
  en: {
    rent: 'Rent', food: 'Food', transport: 'Transport', coffee: 'Coffee', phone: 'Phone & internet', out: 'Going out', health: 'Health',
    octRent: 'October rent', novRent: 'November rent', groceries: 'Weekly groceries', internet: 'Home internet', metro: 'Metro card',
    metroUber: 'Metro card + Uber', coffeeTxt: 'Coffee', flatWhite: 'Flat white + croissant', cinema: 'Cinema with friends', beans: 'Coffee beans',
    uber: 'Uber home', pharmacy: 'Pharmacy', coffeeMona: 'Coffee with Mona', koshary: 'Koshary lunch', bowling: 'Bowling', fruit: 'Fruit and bread',
    birthday: 'Birthday dinner', laptop: 'New laptop', trip: 'Trip to Dahab', omar: 'Omar', dad: 'Dad', tickets: 'Concert tickets',
    car: 'Car repair', netflix: 'Netflix', tags: ['home', 'work', 'weekend'],
  },
  ar: {
    rent: 'إيجار', food: 'أكل', transport: 'مواصلات', coffee: 'قهوة', phone: 'موبايل ونت', out: 'خروجات', health: 'صحة',
    octRent: 'إيجار أكتوبر', novRent: 'إيجار نوفمبر', groceries: 'طلبات البيت', internet: 'نت البيت', metro: 'كارت المترو',
    metroUber: 'مترو وأوبر', coffeeTxt: 'قهوة', flatWhite: 'فلات وايت وكرواسون', cinema: 'سينما مع الصحاب', beans: 'بن',
    uber: 'أوبر للبيت', pharmacy: 'صيدلية', coffeeMona: 'قهوة مع منى', koshary: 'غدا كشري', bowling: 'بولينج', fruit: 'فاكهة وعيش',
    birthday: 'عشا عيد ميلاد', laptop: 'لابتوب جديد', trip: 'رحلة دهب', omar: 'عمر', dad: 'بابا', tickets: 'تذاكر حفلة',
    car: 'تصليح العربية', netflix: 'نتفليكس', tags: ['بيت', 'شغل', 'ويكند'],
  },
};
async function seedAccount(user, N) {
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'X-Requested-With': 'budget-me', 'X-Local-Date': '2026-11-22' } });
  const ok = async (p) => {
    const r = await p;
    if (!r.ok()) throw new Error(`${r.url()} → ${r.status()} ${await r.text()}`);
    return r.status() === 204 ? null : r.json();
  };
  const me = await ok(api.post('/api/auth/signup', { data: user }));
  await ok(api.put(`/api/budget/${M}`, { data: { income: EGP(18000), uniDays: 0, uniWeeks: 0, uniCost: 0, savePlan: EGP(2500), loanPlan: EGP(500) } }));
  const cat = {};
  // Planned amounts leave a little room, so the demo shows a couple of realistic alerts, not a wall of them.
  for (const [k, planned] of [['rent', 6000], ['food', 3500], ['transport', 1200], ['coffee', 500], ['phone', 600], ['out', 1200], ['health', 600]]) {
    cat[k] = (await ok(api.post('/api/categories', { data: { name: N[k], month: M, planned: EGP(planned) } }))).id;
  }
  const [home, work, weekend] = N.tags;
  const exp = async (date, c, amount, description, tags = []) =>
    ok(api.post('/api/expenses?force=1', { data: { date, categoryId: cat[c], amount: EGP(amount), description, tags } }));
  for (const [d, c, a, desc] of [
    ['2026-10-01', 'rent', 6000, N.octRent], ['2026-10-04', 'food', 820, N.groceries], ['2026-10-11', 'food', 760, N.groceries],
    ['2026-10-18', 'food', 690, N.groceries], ['2026-10-09', 'transport', 950, N.metroUber], ['2026-10-15', 'coffee', 310, N.coffeeTxt],
    ['2026-10-20', 'out', 1200, N.birthday], ['2026-10-03', 'phone', 450, N.internet],
  ]) await exp(d, c, a, desc);
  const receiptFor = await exp('2026-11-02', 'food', 935, N.groceries, [home]);
  for (const [d, c, a, desc, tags] of [
    ['2026-11-01', 'rent', 6000, N.novRent, []], ['2026-11-03', 'phone', 450, N.internet, []], ['2026-11-05', 'transport', 380, N.metro, [work]],
    ['2026-11-07', 'coffee', 145, N.flatWhite, []], ['2026-11-09', 'food', 880, N.groceries, [home]], ['2026-11-10', 'out', 640, N.cinema, [weekend]],
    ['2026-11-12', 'coffee', 190, N.beans, []], ['2026-11-14', 'transport', 220, N.uber, []], ['2026-11-16', 'food', 905, N.groceries, [home]],
    ['2026-11-17', 'health', 260, N.pharmacy, []], ['2026-11-18', 'coffee', 210, N.coffeeMona, [weekend]], ['2026-11-19', 'food', 340, N.koshary, [work]],
    ['2026-11-21', 'out', 180, N.bowling, [weekend]], ['2026-11-22', 'food', 165, N.fruit, []],
  ]) await exp(d, c, a, desc, tags);
  await api.put(`/api/expenses/${receiptFor.id}/receipt`, { headers: { 'Content-Type': 'image/png' }, data: readFileSync(path.join(root, 'e2e', 'fixtures', 'receipt.png')) });
  const laptop = (await ok(api.post('/api/goals', { data: { name: N.laptop, target: EGP(45000), start: EGP(12000), monthly: EGP(2000) } }))).id;
  const trip = (await ok(api.post('/api/goals', { data: { name: N.trip, target: EGP(15000), start: EGP(4000), monthly: EGP(500) } }))).id;
  for (const [g, d, a] of [[laptop, '2026-08-28', 2000], [laptop, '2026-09-27', 2500], [laptop, '2026-10-28', 2000], [laptop, '2026-11-15', 2000], [trip, '2026-09-30', 1500], [trip, '2026-10-30', 1000], [trip, '2026-11-15', 500]]) {
    await ok(api.post(`/api/goals/${g}/entries`, { data: { date: d, deposit: true, amount: EGP(a), note: '' } }));
  }
  for (const l of [
    { date: '2026-10-12', person: N.omar, borrowed: false, repayment: false, amount: EGP(1500), note: N.tickets },
    { date: '2026-11-08', person: N.omar, borrowed: false, repayment: true, amount: EGP(500), note: '' },
    { date: '2026-11-04', person: N.dad, borrowed: true, repayment: false, amount: EGP(2000), note: N.car },
    { date: '2026-11-20', person: N.dad, borrowed: true, repayment: true, amount: EGP(500), note: '' },
  ]) await ok(api.post('/api/loans?force=1', { data: l }));
  await ok(api.post('/api/recurring', { data: { categoryId: cat.out, amount: EGP(250), description: N.netflix, day: 20 } }));
  const cookies = (await api.storageState()).cookies;
  await api.dispose();
  return { uid: me.user.id, cookies };
}
const EN = await seedAccount({ username: 'youssef', email: 'demo@example.com', password: 'Demo-pass-2026' }, NAMES.en);
const AR = await seedAccount({ username: 'youssef.ar', email: 'demo-ar@example.com', password: 'Demo-pass-2026' }, NAMES.ar);

// ---------- screenshots ----------
const browser = await chromium.launch();
async function phone({ theme = 'dark', lang = 'en', signedIn = true }) {
  const acct = lang === 'ar' ? AR : EN;
  const ctx = await browser.newContext({
    ...devices['Pixel 7'],
    deviceScaleFactor: 3,
    baseURL: BASE,
    locale: lang === 'ar' ? 'ar-EG' : 'en-US',
    timezoneId: 'Africa/Cairo',
  });
  if (signedIn) await ctx.addCookies(acct.cookies);
  await ctx.addInitScript(
    ([t, l, id]) => {
      localStorage.setItem('sb-theme', t);
      localStorage.setItem('bm-lang', l);
      localStorage.setItem(`bm-tutorial-done:${id}`, '1');
    },
    [theme, lang, acct.uid],
  );
  // Freeze "today" at 22 Nov 2026 so the month and "per day" numbers match the demo data
  await ctx.addInitScript(() => {
    const fixed = new Date('2026-11-22T12:00:00+02:00').getTime();
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...a) {
        super(...(a.length ? a : [fixed]));
      }
      static now() {
        return fixed;
      }
    };
  });
  const page = await ctx.newPage();
  return { ctx, page };
}
const shot = async (page, name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('saved', name);
};

for (const theme of ['dark', 'light']) {
  const { ctx, page } = await phone({ theme });
  const go = async (url, name, wait) => {
    await page.goto(url);
    await page.getByRole('navigation', { name: /Main|الرئيسية/ }).waitFor();
    if (wait) await page.getByText(wait).first().waitFor();
    await shot(page, `${theme}-${name}`);
  };
  await go('/', '01-home', 'Your budget left');
  await go('/budget', '02-budget', 'Food');
  await go('/expenses', '03-expenses', 'Weekly groceries');
  await go('/savings', '05-savings', 'New laptop');
  await go('/loans', '06-loans', 'Dad');
  await go('/reports', '07-reports', 'Year overview');
  await go('/settings', '08-settings');
  if (theme === 'dark') {
    await page.goto('/expenses');
    await page.getByRole('button', { name: 'Add an expense' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add expense' });
    await sheet.getByLabel('Amount').fill('185');
    await sheet.getByLabel('Category').selectOption({ label: 'Food' });
    await sheet.getByLabel(/What for/).fill('Shawarma');
    await shot(page, 'dark-04-add-expense');
    await page.goto('/settings');
    await page.locator('footer.app-footer').scrollIntoViewIfNeeded();
    await shot(page, 'dark-09-about');
  }
  await ctx.close();
}
{
  const { ctx, page } = await phone({ theme: 'dark', lang: 'ar' });
  await page.goto('/');
  await page.getByRole('navigation').first().waitFor();
  await shot(page, 'arabic-01-home');
  await page.goto('/budget');
  await page.getByText('أكل').first().waitFor();
  await shot(page, 'arabic-02-budget');
  await page.goto('/expenses');
  await page.getByText('طلبات البيت').first().waitFor();
  await shot(page, 'arabic-03-expenses');
  await ctx.close();
}
{
  const { ctx, page } = await phone({ theme: 'dark', signedIn: false });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  await shot(page, 'dark-00-sign-in');
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Email').fill('mona@example.com');
  await page.getByLabel('Username').fill('mona');
  await page.getByLabel(/^Password/).fill('Budget-2026');
  await shot(page, 'dark-00-sign-up');
  await ctx.close();
}
// ---------- one widescreen overview slide ----------
const b64 = (n) => readFileSync(path.join(OUT, `${n}.png`)).toString('base64');
const shots = [
  ['dark-01-home', 'Home'],
  ['dark-02-budget', 'Budget and alerts'],
  ['dark-03-expenses', 'Expenses'],
  ['dark-05-savings', 'Savings goals'],
  ['light-07-reports', 'Reports (light mode)'],
  ['light-01-home', 'Light mode'],
  ['arabic-01-home', 'Egyptian Arabic, right to left'],
];
{
  const page = await browser.newPage({ viewport: { width: 2400, height: 1350 }, deviceScaleFactor: 1 });
  await page.setContent(`<html><head><style>
    body{margin:0;width:2400px;height:1350px;background:#0b0c1f;color:#f4f2ee;font-family:Montserrat,'Segoe UI',Arial,sans-serif;display:grid;grid-template-rows:auto 1fr;}
    header{padding:70px 90px 30px;display:flex;align-items:flex-end;justify-content:space-between}
    h1{margin:0;font-size:84px;letter-spacing:-1px}h1 span{color:#6fbf8a}
    .mk{display:inline-block;margin-inline-start:18px;font-size:26px;padding:4px 14px;border-radius:10px;color:#d29a5c;border:2px solid #d29a5c66;vertical-align:middle}
    p{margin:14px 0 0;font-size:30px;color:#9a9bbd;font-family:'Segoe UI',Arial,sans-serif}
    .dots{display:flex;gap:14px}.dots i{width:46px;height:46px;border-radius:12px;display:block;border:2px solid #ffffff22}
    main{display:flex;gap:22px;justify-content:center;align-items:center;padding:0 40px 140px}
    figure{margin:0;text-align:center}img{width:290px;box-sizing:border-box;border-radius:34px;border:6px solid #23255a;box-shadow:0 20px 50px #0008}
    figcaption{margin-top:18px;font-size:22px;color:#d2d0e0;font-family:'Segoe UI',Arial,sans-serif}
    footer{position:absolute;bottom:34px;left:90px;font-size:22px;color:#6e6f8a;font-family:'Segoe UI',Arial,sans-serif}
  </style></head><body>
    <header><div><h1>Budget <span>me</span><span class="mk">MK1</span></h1>
      <p>Monthly budget, expenses, savings goals and loans. English and Arabic. Phone app and website.</p></div>
      <div class="dots"><i style="background:#17183b"></i><i style="background:#254d32"></i><i style="background:#a27035"></i></div></header>
    <main>${shots.map(([n, c]) => `<figure><img src="data:image/png;base64,${b64(n)}"><figcaption>${c}</figcaption></figure>`).join('')}</main>
    <footer>Developed by Youssef Gouda</footer>
  </body></html>`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'overview.png') });
  console.log('saved overview');
}
await browser.close();
stop();
console.log('done:', OUT);
