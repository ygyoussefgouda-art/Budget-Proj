import { z } from 'zod';

const MAX = 1e13; // 100 billion in minor units; well inside JS safe integers

export const money = z.number().int().min(0).max(MAX);
export const positiveMoney = z.number().int().positive().max(MAX);

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'is not a real date')
  .refine((s) => s >= '2000-01-01' && s <= '2100-12-31', 'must be between 2000 and 2100');

/** Budget month; limited to 2000–2100 so opening months cannot create unbounded rows. */
export const monthStr = z
  .string()
  .regex(/^(20\d\d|2100)-(0[1-9]|1[0-2])$/, 'must be YYYY-MM between 2000 and 2100');

export const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const text = (max: number) => z.string().trim().max(max);
const name = (max: number) => z.string().trim().min(1, 'is required').max(max);

export const CURRENCIES = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR', 'JOD'] as const;

/** Names nobody can sign up with (the built-in account and look-alikes). */
export const RESERVED_USERNAMES = new Set(['owner', 'admin', 'administrator', 'root', 'system', 'support']);

const newPassword = z.string().min(10, 'must be at least 10 characters').max(200);

/** A tag: letters (any language, so Arabic works), numbers, - and _; stored lower-case without '#'. */
export const tag = z
  .string()
  .trim()
  .transform((s) => s.replace(/^#+/, '').toLowerCase())
  .pipe(z.string().regex(/^[\p{L}\p{N}_-]{1,30}$/u, 'Tags can use letters, numbers, - and _ (up to 30 characters).'));
const tagList = z
  .array(tag)
  .max(5, 'An expense can have at most 5 tags.')
  .transform((a) => [...new Set(a)]);

/** Paid in another currency: original amount (minor units), ISO code and the rate (account currency per 1 unit). */
const foreign = z.object({
  amount: z.number().int().positive().max(MAX),
  currency: z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter currency code'),
  rate: z
    .number()
    .positive()
    .max(1_000_000)
    .transform((r) => Math.round(r * 1e6) / 1e6),
});

/** Converted amount in the account currency (the app and the server compute it the same way). */
export const convert = (amount: number, rate: number) => Math.round(amount * rate);

export const schemas = {
  login: z.object({ username: z.string().trim().max(60).optional(), password: z.string().min(1).max(200) }),
  signup: z.object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, 'must be at least 3 characters')
      .max(30, 'must be at most 30 characters')
      .regex(/^[a-z0-9._-]+$/, 'can only use letters, numbers, dots, dashes and underscores')
      .refine((u) => !RESERVED_USERNAMES.has(u), 'is reserved, please choose another one'),
    password: newPassword,
    inviteCode: z.string().max(200).optional(),
  })
    .refine((s) => s.password.toLowerCase() !== s.username, { message: 'must not be the same as the username', path: ['password'] }),
  changePassword: z.object({ current: z.string().min(1).max(200), next: newPassword }),
  deleteAccount: z.object({ password: z.string().min(1).max(200) }),
  adminSettings: z.object({
    allowSignup: z.boolean(),
    inviteCode: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .transform((v) => v || ''),
  }),
  adminDeleteUser: z.object({ confirmUsername: z.string().max(60), password: z.string().min(1).max(200) }),
  /** A crash report from the web app (ErrorBoundary / window.onerror). Short, plain text only. */
  clientError: z.object({
    message: z.string().trim().min(1).max(500),
    stack: z.string().max(4000).optional(),
    componentStack: z.string().max(4000).optional(),
    page: z.string().max(300).optional(),
    version: z.string().max(30).optional(),
    kind: z.enum(['render', 'error', 'unhandledrejection']).optional(),
  }),
  resetPassword: z
    .object({
      username: z.string().trim().toLowerCase().min(1).max(60),
      code: z.string().trim().min(6).max(40),
      password: newPassword,
    })
    .refine((s) => s.password.toLowerCase() !== s.username, { message: 'must not be the same as the username', path: ['password'] }),
  settings: z
    .object({ currency: z.enum(CURRENCIES).optional(), monthStartDay: z.number().int().min(1).max(28).optional() })
    .refine((s) => s.currency !== undefined || s.monthStartDay !== undefined, 'Nothing to change.'),
  budget: z.object({
    income: money,
    uniDays: z.number().min(0).max(7),
    uniWeeks: z.number().min(0).max(6),
    uniCost: money,
    savePlan: money,
    loanPlan: money,
  }),
  plan: z.object({ planned: money }),
  categoryCreate: z.object({ name: name(60), planned: money.default(0), month: monthStr, perDay: z.boolean().default(false) }),
  categoryUpdate: z.object({ name: name(60), planned: money.optional(), month: monthStr, perDay: z.boolean().optional() }),
  loanPersonRename: z.object({ borrowed: z.boolean(), from: name(60), to: name(60) }),
  loanPersonDelete: z.object({ borrowed: z.enum(['true', 'false']).transform((v) => v === 'true'), name: name(60) }),
  expense: z.object({
    date: isoDate,
    categoryId: id,
    description: text(200).default(''),
    /** My share, in the account currency (the whole bill when not split). */
    amount: positiveMoney,
    tags: tagList.default([]),
    /** Split with someone: their share becomes an "Owed to me" loan entry. */
    split: z.object({ person: name(60), share: positiveMoney }).nullable().optional(),
    foreign: foreign.nullable().optional(),
    /** Made on the phone for offline entries: sending it again never creates a second expense. */
    clientId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/, 'is not a valid id').optional(),
  }),
  goal: z.object({ name: name(60), target: positiveMoney, start: money.default(0), monthly: money.default(0) }),
  goalEntry: z.object({ date: isoDate, deposit: z.boolean(), amount: positiveMoney, note: text(200).default('') }),
  loan: z.object({
    date: isoDate,
    person: name(60),
    borrowed: z.boolean(),
    repayment: z.boolean(),
    amount: positiveMoney,
    note: text(200).default(''),
  }),
  recurringRule: z.object({
    categoryId: id,
    amount: positiveMoney,
    description: text(200).default(''),
    day: z.number().int().min(1).max(31),
    endDate: isoDate.nullable().optional(),
    autoAdd: z.boolean().default(false),
    paused: z.boolean().default(false),
  }),
  recurringAction: z.object({ date: isoDate }),
  /** Export: what, which dates (optional), file type, and header language. Expenses also take the list filters. */
  exportQuery: z.object({
    kind: z.enum(['expenses', 'loans', 'savings']),
    from: isoDate.optional(),
    to: isoDate.optional(),
    format: z.enum(['csv', 'xlsx']).default('csv'),
    lang: z.enum(['en', 'ar']).default('en'),
    q: z.string().trim().max(100).optional(),
    categoryId: id.optional(),
    tag: tag.optional(),
  }),
  /** Tag report range (same limits as the weekday one). */
  rangeQuery: z
    .object({ from: isoDate, to: isoDate })
    .refine((r) => r.to >= r.from, 'The end date is before the start date.')
    .refine((r) => Date.parse(r.to) - Date.parse(r.from) <= 400 * 86_400_000, 'Pick a range of at most 13 months.'),
  /** Weekday report range: at most ~13 months, so one request can't scan years of data. */
  weekdayQuery: z
    .object({ from: isoDate, to: isoDate })
    .refine((r) => r.to >= r.from, 'The end date is before the start date.')
    .refine((r) => Date.parse(r.to) - Date.parse(r.from) <= 400 * 86_400_000, 'Pick a range of at most 13 months.'),
  expenseQuery: z.object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    q: z.string().trim().max(100).optional(),
    categoryId: id.optional(),
    tag: tag.optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  }),
};
