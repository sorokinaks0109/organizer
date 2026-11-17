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
  firstYm?: string;         // месяц первого платежа (календарный, когда деньги уходят)
  amounts?: Record<string, number>; // свой платёж в отдельные месяцы (ключ — месяц платежа)
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

/** Месяц плана, из которого платится платёж месяца payYm: аванс 28-го — тот же месяц, зарплата 13-го — за прошлый. */
export const planYmOf = (payYm: string, key: PayKey) => (key === 'zp' ? ymShift(payYm, -1) : payYm);
export const payYmOf = (planYm: string, key: PayKey) => (key === 'zp' ? ymShift(planYm, 1) : planYm);

/** График по месяцам платежа, пока остаток не станет нулём (не больше 20 лет). Первый месяц — fromYm. */
export function schedule(d: Pick<Debt, 'balance' | 'payment' | 'rate' | 'amounts'>, fromYm: string): DebtRow[] {
  const out: DebtRow[] = [];
  let left = d.balance;
  for (let i = 0; left > 0.009 && i < 240; i++) {
    const ym = ymShift(fromYm, i);
    const interest = d.rate ? r2(left * d.rate / 1200) : 0;
    const want = d.amounts?.[ym] ?? d.payment;
    if (want <= interest && !d.amounts?.[ym]) break; // платёж не покрывает проценты — долг не гасится
    const payment = Math.max(0, Math.min(want, r2(left + interest)));
    const principal = r2(payment - interest);
    left = Math.max(0, r2(left - principal));
    out.push({ ym, payment, interest, principal, left });
  }
  return out;
}

/** С какого месяца платежа считать график: не раньше первого платежа и текущего месяца;
 *  если платёж этого месяца уже оплачен — со следующего. */
export function scheduleStart(store: Pick<Store, 'money_months'>, d: Pick<Debt, 'id' | 'key' | 'firstYm'>) {
  const now = todayIso().slice(0, 7);
  if (d.firstYm && d.firstYm > now) return d.firstYm;
  const row = (monthOrNew(store, planYmOf(now, d.key)).plan[d.key] || []).find((r) => r.id === debtRowId(d));
  return row?.paid ? ymShift(now, 1) : now;
}

async function saveDebts(store: Store, debts: Debt[]) { await store.saveSettings({ debts }); }

/** Строки долга — ровно в месяцах графика, со своей суммой в каждом; в остальных будущих месяцах строки нет.
 *  (Новые месяцы строки долга не копируют — их ставит только график.) */
async function putInPlan(store: Store, d: Debt) {
  const start = scheduleStart(store, d);
  const rows = new Map(schedule(d, start).map((r) => [planYmOf(r.ym, d.key), r.payment]));
  // Текущие и будущие месяцы до первого платежа — без строки долга (если она туда попала раньше).
  const cur = periodOf(todayIso()).ym;
  const months = [...new Set([...rows.keys(), ...store.snapshot().money_months.map((m) => m.ym).filter((ym) => ym >= cur)])].sort();
  const id = debtRowId(d);
  for (const ym of months) {
    const sum = rows.get(ym);
    const has = (['avans', 'zp'] as PayKey[]).some((k) => (monthOrNew(store.snapshot(), ym).plan[k] || []).some((r) => r.id === id));
    if (sum === undefined && !has) continue;
    await saveMonth(store, ym, (m) => {
      for (const k of ['avans', 'zp'] as PayKey[]) if (k !== d.key || sum === undefined) m.plan[k] = (m.plan[k] || []).filter((r) => r.id !== id || r.paid);
      if (sum === undefined) return;
      const list = m.plan[d.key] || [];
      const cur = list.find((r) => r.id === id);
      if (cur?.paid) return;
      const row: PlanRow = { id, name: d.name, sum, cat: 'Кредиты', paid: false, debt: d.id };
      m.plan[d.key] = cur ? list.map((r) => (r.id === id ? { ...r, name: d.name, sum } : r)) : [...list, row];
    });
  }
}

/** Сумма платежа в отдельный месяц (из графика или из строки плана). Совпадает с обычной — особая сумма убирается. */
export async function setDebtAmount(store: Store, debtId: string, payYm: string, sum: number) {
  const d = (store.settings.debts || []).find((x) => x.id === debtId);
  if (!d) return;
  const amounts = { ...d.amounts };
  if (sum === d.payment) delete amounts[payYm]; else amounts[payYm] = sum;
  await saveDebt(store, { ...d, amounts });
}

/** Убрать неоплаченные строки долга из этого и следующих месяцев. */
async function dropFromPlan(store: Store, d: Debt) {
  const ym = periodOf(todayIso()).ym;
  for (const m of store.snapshot().money_months.filter((x) => x.ym >= ym && x.ym >= ymShift(ym, -1))) {
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
