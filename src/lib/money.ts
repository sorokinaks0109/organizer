// Деньги по выплатам: аванс 28-го и зарплата 13-го делят месяц на два периода.
// План платежей хранится в money_months: строка месяца M содержит аванс 28.M и зарплату 13.(M+1).
import { iso, parseIso, ymShift } from './dates';
import type { Expense, Income, MoneyMonth, PlanRow } from './types';

export type PayKey = 'avans' | 'zp';
export type Period = { ym: string; key: PayKey };
export const PAY: Record<PayKey, { name: string; day: number; shift: number }> = {
  avans: { name: 'Аванс', day: 28, shift: 0 },
  zp: { name: 'Зарплата', day: 13, shift: 1 },
};
/** Категории, которые в итогах идут как накопления, а не как прожитые деньги. */
export const SAVING_CATS = ['Инвестиции', 'Накопления'];

const dayOf = (ym: string, d: number) => `${ym}-${String(d).padStart(2, '0')}`;

/** К какому периоду относится дата. */
export function periodOf(date: string): Period {
  const ym = date.slice(0, 7), d = Number(date.slice(8, 10));
  if (d >= 28) return { ym, key: 'avans' };
  if (d >= 13) return { ym: ymShift(ym, -1), key: 'zp' };
  return { ym: ymShift(ym, -1), key: 'avans' };
}

/** Первый и последний день периода (включительно) и день выплаты. */
export function bounds({ ym, key }: Period): { start: string; end: string } {
  const next = ymShift(ym, 1);
  return key === 'avans' ? { start: dayOf(ym, 28), end: dayOf(next, 12) } : { start: dayOf(next, 13), end: dayOf(next, 27) };
}
export const nextPeriod = (p: Period): Period => (p.key === 'avans' ? { ym: p.ym, key: 'zp' } : { ym: ymShift(p.ym, 1), key: 'avans' });
export const prevPeriod = (p: Period): Period => (p.key === 'zp' ? { ym: p.ym, key: 'avans' } : { ym: ymShift(p.ym, -1), key: 'zp' });
export const samePeriod = (a: Period, b: Period) => a.ym === b.ym && a.key === b.key;

export const planRef = (p: Period, rowId: string) => `${p.ym}:${p.key}:${rowId}`;
export const incomeRef = (p: Period) => `${p.ym}:${p.key}:income`;

/** Сколько стоит строка: оплаченная — по факту, неоплаченная — по плану. */
export const rowCost = (r: PlanRow) => (r.paid ? r.paid_sum ?? r.sum : r.sum);
const total = <T,>(list: T[], f: (x: T) => number) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const daysBetween = (a: string, b: string) => Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 864e5) + 1;

export type Summary = {
  period: Period; start: string; end: string;
  expected: number; received: boolean; extra: number; income: number;
  rows: PlanRow[]; planned: number; paid: number; left: number; fromReserve: number;
  spent: number; saved: number; free: number;
  days: number; daysLeft: number; perDay: number;
};

/** Итог периода: доход, платежи, траты и сколько можно тратить в день. */
export function summarize(month: MoneyMonth | null | undefined, p: Period, expenses: Expense[], incomes: Income[], today: string): Summary {
  const { start, end } = bounds(p);
  const inRange = (d: string) => d >= start && d <= end;
  const rows = month?.plan[p.key] ?? [];
  const expected = Number(month?.income[p.key]) || 0;
  const received = !!month?.got[p.key];
  const extra = total(incomes.filter((i) => i.target === 'live' && !i.plan_ref && inRange(i.got_on)), (i) => i.amount);
  const own = rows.filter((r) => !r.reserve);
  const planned = total(own, rowCost);
  const paid = total(own.filter((r) => r.paid), rowCost);
  const fromReserve = total(rows.filter((r) => r.reserve), rowCost);
  const spent = total(expenses.filter((e) => e.kind === 'spend' && inRange(e.spent_on)), (e) => e.amount);
  const saved = total(expenses.filter((e) => e.kind === 'saving' && inRange(e.spent_on)), (e) => e.amount);
  const income = expected + extra;
  const free = income - planned - spent - saved;
  const days = daysBetween(start, end);
  const daysLeft = today < start ? days : today > end ? 0 : daysBetween(today, end);
  const perDay = free > 0 && daysLeft > 0 ? free / daysLeft : 0;
  return { period: p, start, end, expected, received, extra, income, rows, planned, paid, left: planned - paid, fromReserve, spent, saved, free, days, daysLeft, perDay };
}

/** Резерв: отложенные доходы минус платежи, которые на него повешены. */
export function reserveState(months: MoneyMonth[], incomes: Income[]) {
  const put = total(incomes.filter((i) => i.target === 'reserve'), (i) => i.amount);
  let allocated = 0, spentFrom = 0;
  for (const m of months) for (const k of ['avans', 'zp'] as const) for (const r of m.plan[k] || []) {
    if (!r.reserve) continue;
    allocated += rowCost(r);
    if (r.paid) spentFrom += rowCost(r);
  }
  return { put, allocated, free: put - allocated, balance: put - spentFrom };
}

/** План следующего месяца: те же суммы выплат и платежи, кроме разовых. */
export function monthFrom(prev: MoneyMonth | null | undefined, ym: string, newId: () => string): MoneyMonth {
  const copy = (rows?: PlanRow[]) => (rows || []).filter((r) => !r.once).map((r) => ({ id: newId(), name: r.name, sum: r.sum, cat: r.cat, paid: false }));
  return { ym, income: { avans: prev?.income.avans, zp: prev?.income.zp }, got: {}, plan: { avans: copy(prev?.plan.avans), zp: copy(prev?.plan.zp) } };
}

export const todayPeriod = (today = iso(new Date())) => periodOf(today);
