// Долги и кредиты: актуальный остаток, ежемесячный платёж, график погашения и строка в плане платежей.
// Хранятся в настройках (settings.debts). Оплата строки в «Деньгах» уменьшает остаток сама.
import type { useStore } from './store';
import { periodOf, type PayKey } from './money';
import { todayIso, ymShift } from './dates';
import { monthOrNew, saveMonth } from './moneyActions';
import type { PlanRow } from './types';

type Store = ReturnType<typeof useStore>;
export type Debt = {
  id: string; name: string;
  balance: number;          // актуальный остаток долга
  balanceAt: string;        // когда остаток введён или пересчитан
  payment: number;          // платёж в месяц
  rate?: number | null;     // ставка, % годовых (если есть) — для графика
  key: PayKey;              // с какой выплаты платится
  inPlan?: boolean;         // вписан в предстоящие платежи
  closed?: boolean;
  note?: string;
};
export type DebtRow = { ym: string; payment: number; interest: number; principal: number; left: number };

export const debtRowId = (d: Pick<Debt, 'id'>) => 'debt-' + d.id;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Сколько из платежа идёт в счёт долга (остальное — проценты за месяц). */
export function principalOf(d: Pick<Debt, 'balance' | 'rate'>, paid: number) {
  const interest = d.rate ? r2(d.balance * d.rate / 1200) : 0;
  return Math.max(0, r2(paid - interest));
}

/** График: помесячно, пока остаток не станет нулём (не больше 20 лет). Первый месяц — fromYm. */
export function schedule(d: Pick<Debt, 'balance' | 'payment' | 'rate'>, fromYm: string): DebtRow[] {
  const out: DebtRow[] = [];
  let left = d.balance;
  for (let i = 0; left > 0.009 && i < 240; i++) {
    const interest = d.rate ? r2(left * d.rate / 1200) : 0;
    if (d.payment <= interest) break; // платёж не покрывает проценты — долг не гасится
    const payment = Math.min(d.payment, r2(left + interest));
    const principal = r2(payment - interest);
    left = Math.max(0, r2(left - principal));
    out.push({ ym: ymShift(fromYm, i), payment, interest, principal, left });
  }
  return out;
}

/** С какого месяца считать график: если платёж этого месяца уже оплачен — со следующего. */
export function scheduleStart(store: Pick<Store, 'money_months'>, d: Debt) {
  const ym = periodOf(todayIso()).ym;
  const row = (monthOrNew(store, ym).plan[d.key] || []).find((r) => r.id === debtRowId(d));
  return row?.paid ? ymShift(ym, 1) : ym;
}

async function saveDebts(store: Store, debts: Debt[]) { await store.saveSettings({ debts }); }

/** Строка платежа долга в этом и всех уже созданных следующих месяцах (новые месяцы возьмут её сами). */
async function putInPlan(store: Store, d: Debt) {
  const start = scheduleStart(store, d);
  const row: PlanRow = { id: debtRowId(d), name: d.name, sum: d.payment, cat: 'Кредиты', paid: false, debt: d.id };
  const months = [start, ...store.snapshot().money_months.map((m) => m.ym).filter((ym) => ym > start)];
  for (const ym of [...new Set(months)]) {
    await saveMonth(store, ym, (m) => {
      for (const k of ['avans', 'zp'] as PayKey[]) if (k !== d.key) m.plan[k] = (m.plan[k] || []).filter((r) => r.id !== row.id || r.paid);
      const list = m.plan[d.key] || [];
      const cur = list.find((r) => r.id === row.id);
      m.plan[d.key] = cur ? list.map((r) => (r.id === row.id && !r.paid ? { ...r, name: d.name, sum: d.payment, debt: d.id } : r)) : [...list, row];
    });
  }
}

/** Убрать неоплаченные строки долга из этого и следующих месяцев. */
async function dropFromPlan(store: Store, d: Debt) {
  const ym = periodOf(todayIso()).ym;
  for (const m of store.snapshot().money_months.filter((x) => x.ym >= ym)) {
    if (!(['avans', 'zp'] as PayKey[]).some((k) => (m.plan[k] || []).some((r) => r.id === debtRowId(d) && !r.paid))) continue;
    await saveMonth(store, m.ym, (x) => { for (const k of ['avans', 'zp'] as PayKey[]) x.plan[k] = (x.plan[k] || []).filter((r) => r.id !== debtRowId(d) || r.paid); });
  }
}

export async function saveDebt(store: Store, d: Debt) {
  const list = store.settings.debts || [];
  const next = list.some((x) => x.id === d.id) ? list.map((x) => (x.id === d.id ? d : x)) : [...list, d];
  await saveDebts(store, next);
  if (d.inPlan && !d.closed) await putInPlan(store, d); else await dropFromPlan(store, d);
}

export async function deleteDebt(store: Store, d: Debt) {
  await saveDebts(store, (store.settings.debts || []).filter((x) => x.id !== d.id));
  await dropFromPlan(store, d);
}

/** Платёж по долгу оплачен (или снят): остаток меняется на часть платежа без процентов. */
export async function debtPaid(store: Store, debtId: string, principal: number, sign: 1 | -1) {
  const d = (store.settings.debts || []).find((x) => x.id === debtId);
  if (!d) return null;
  const balance = Math.max(0, r2(d.balance - sign * principal));
  const closed = balance <= 0.009;
  const next: Debt = { ...d, balance, balanceAt: todayIso(), closed };
  await saveDebts(store, (store.settings.debts || []).map((x) => (x.id === d.id ? next : x)));
  if (closed && !d.closed) await dropFromPlan(store, next);
  return next;
}
