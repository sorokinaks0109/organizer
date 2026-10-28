// Действия с деньгами. Каждое меняет все связанные записи сразу:
// оплатила платёж → строка плана отмечена и появился расход; пришла выплата → доход; отложила → копилка.
import type { useStore } from './store';
import { todayIso, uid } from './dates';
import { incomeRef, monthFrom, PAY, planRef, type Period } from './money';
import type { Income, MoneyMonth, PlanRow, Wish } from './types';

type Store = ReturnType<typeof useStore>;

const clone = (m: MoneyMonth): MoneyMonth => JSON.parse(JSON.stringify(m));

/** План месяца; если его ещё нет — создаётся из прошлого (без разовых платежей). */
export function monthOrNew(store: Store, ym: string): MoneyMonth {
  const m = store.money_months.find((x) => x.ym === ym);
  if (m) return m;
  const prev = [...store.money_months].filter((x) => x.ym < ym).sort((a, b) => b.ym.localeCompare(a.ym))[0];
  return monthFrom(prev, ym, uid);
}

export async function saveMonth(store: Store, ym: string, mut: (m: MoneyMonth) => void) {
  const m = clone(monthOrNew(store, ym));
  mut(m);
  await store.upsert('money_months', { ym, income: m.income, got: m.got, plan: m.plan }, ['ym']);
}

/** Отметить платёж оплаченным (sum — если пришло не столько, сколько в плане). */
export async function payRow(store: Store, p: Period, row: PlanRow, sum = row.sum) {
  const day = todayIso();
  await saveMonth(store, p.ym, (m) => { m.plan[p.key] = (m.plan[p.key] || []).map((r) => (r.id === row.id ? { ...r, paid: true, paid_sum: sum, paid_on: day } : r)); });
  await store.insert('expenses', { what: row.name, amount: sum, category: row.cat, wb: false, spent_on: day, kind: 'payment', plan_ref: planRef(p, row.id), from_reserve: !!row.reserve });
}

export async function unpayRow(store: Store, p: Period, row: PlanRow) {
  await saveMonth(store, p.ym, (m) => { m.plan[p.key] = (m.plan[p.key] || []).map((r) => (r.id === row.id ? { id: r.id, name: r.name, sum: r.sum, cat: r.cat, paid: false, reserve: r.reserve, once: r.once } : r)); });
  await store.remove('expenses', { plan_ref: planRef(p, row.id) });
}

export async function saveRow(store: Store, p: Period, row: PlanRow) {
  await saveMonth(store, p.ym, (m) => {
    const list = m.plan[p.key] || [];
    m.plan[p.key] = list.some((r) => r.id === row.id) ? list.map((r) => (r.id === row.id ? row : r)) : [...list, row];
  });
  if (row.paid) await store.update('expenses', { plan_ref: planRef(p, row.id) }, { what: row.name, amount: row.paid_sum ?? row.sum, category: row.cat });
}

export async function deleteRow(store: Store, p: Period, row: PlanRow) {
  await saveMonth(store, p.ym, (m) => { m.plan[p.key] = (m.plan[p.key] || []).filter((r) => r.id !== row.id); });
  if (row.paid) await store.remove('expenses', { plan_ref: planRef(p, row.id) });
}

/** Повесить платёж на резерв (или снять). */
export async function setReserve(store: Store, p: Period, rowId: string, on: boolean) {
  await saveMonth(store, p.ym, (m) => { m.plan[p.key] = (m.plan[p.key] || []).map((r) => (r.id === rowId ? { ...r, reserve: on } : r)); });
  await store.update('expenses', { plan_ref: planRef(p, rowId) }, { from_reserve: on });
}

/** Выплата пришла: сумма по факту записывается в план и в доходы. */
export async function confirmPayout(store: Store, p: Period, amount: number) {
  await saveMonth(store, p.ym, (m) => { m.income = { ...m.income, [p.key]: amount }; m.got = { ...m.got, [p.key]: true }; });
  const ref = incomeRef(p);
  if (store.incomes.some((i) => i.plan_ref === ref)) await store.update('incomes', { plan_ref: ref }, { amount });
  else await store.insert('incomes', { what: PAY[p.key].name, amount, source: PAY[p.key].name, got_on: todayIso(), target: 'live', plan_ref: ref });
}

export async function unconfirmPayout(store: Store, p: Period) {
  await saveMonth(store, p.ym, (m) => { m.got = { ...m.got, [p.key]: false }; });
  await store.remove('incomes', { plan_ref: incomeRef(p) });
}

/** Сумма выплаты на будущее (до того, как пришла). */
export async function setExpected(store: Store, p: Period, amount: number) {
  await saveMonth(store, p.ym, (m) => { m.income = { ...m.income, [p.key]: amount }; });
  if (store.incomes.some((i) => i.plan_ref === incomeRef(p))) await store.update('incomes', { plan_ref: incomeRef(p) }, { amount });
}

/** Другой доход: премия, заказ, отпускные. target решает, куда он идёт. */
export async function addIncome(store: Store, x: { what: string; amount: number; source: string; got_on?: string | null; target?: Income['target']; wish_id?: string | null }) {
  const target = x.target || 'live';
  const row = await store.insert('incomes', { what: x.what, amount: x.amount, source: x.source, got_on: x.got_on || todayIso(), target, wish_id: target === 'wish' ? x.wish_id ?? null : null });
  if (row && target === 'wish' && x.wish_id) {
    const w = store.wishes.find((y) => y.id === x.wish_id);
    if (w) await store.update('wishes', { id: w.id }, { saved_sum: (Number(w.saved_sum) || 0) + x.amount });
  }
  return row;
}

export async function deleteIncome(store: Store, i: Income) {
  await store.remove('incomes', { id: i.id });
  if (i.target === 'wish' && i.wish_id) {
    const w = store.wishes.find((y) => y.id === i.wish_id);
    if (w) await store.update('wishes', { id: w.id }, { saved_sum: Math.max(0, (Number(w.saved_sum) || 0) - i.amount) });
  }
}

/** Отложить на желание из текущих денег: расход «в копилку» и рост накопленного. */
export async function saveToWish(store: Store, w: Wish, amount: number) {
  await store.insert('expenses', { what: `Копилка: ${w.title}`, amount, category: 'Накопления', wb: false, spent_on: todayIso(), kind: 'saving' });
  await store.update('wishes', { id: w.id }, { saved_sum: (Number(w.saved_sum) || 0) + amount });
}
