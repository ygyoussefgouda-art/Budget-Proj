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
  }, 'is not a real date');

export const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be YYYY-MM');

export const id = z.coerce.number().int().positive();

const text = (max: number) => z.string().trim().max(max);
const name = (max: number) => z.string().trim().min(1, 'is required').max(max);

export const CURRENCIES = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR', 'JOD'] as const;

export const schemas = {
  login: z.object({ username: z.string().trim().max(60).optional(), password: z.string().min(1).max(200) }),
  signup: z.object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, 'must be at least 3 characters')
      .max(30, 'must be at most 30 characters')
      .regex(/^[a-z0-9._-]+$/, 'can only use letters, numbers, dots, dashes and underscores'),
    password: z.string().min(8, 'must be at least 8 characters').max(200),
  }),
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
  expense: z.object({ date: isoDate, categoryId: id, description: text(200).default(''), amount: positiveMoney }),
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
  expenseQuery: z.object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    q: z.string().trim().max(100).optional(),
    categoryId: id.optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};
