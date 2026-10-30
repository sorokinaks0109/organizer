// Действия с деньгами. Каждое меняет все связанные записи сразу:
// оплатила платёж → строка плана отмечена и появился расход; пришла выплата → доход; отложила → копилка.
import type { useStore } from './store';
import { todayIso } from './dates';
import { bounds, incomeRef, monthFrom, PAY, planRef, summarize, type PayKey, type Period } from './money';
import { avansForecast, DEFAULT_PAYROLL, payDay, payrollReady, vacationPayments, zpForecast, type Forecast } from './payroll';
import type { Expense, Income, MoneyMonth, PlanRow, Wish } from './types';

type Store = ReturnType<typeof useStore>;

const clone = (m: MoneyMonth): MoneyMonth => JSON.parse(JSON.stringify(m));

/** План месяца; если его ещё нет — создаётся из прошлого (без разовых платежей). */
export function monthOrNew(store: Pick<Store, 'money_months'>, ym: string): MoneyMonth {
  const m = store.money_months.find((x) => x.ym === ym);
  if (m) return m;
  const prev = [...store.money_months].filter((x) => x.ym < ym).sort((a, b) => b.ym.localeCompare(a.ym))[0];
  return monthFrom(prev, ym);
}

export async function saveMonth(store: Store, ym: string, mut: (m: MoneyMonth) => void) {
  // Берём данные на сейчас, а не из замыкания: при нескольких записях подряд иначе вторая затрёт первую.
  const m = clone(monthOrNew(store.snapshot(), ym));
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

export async function deleteRow(store: Store, p: Period, row: PlanRow, forward = false) {
  await saveMonth(store, p.ym, (m) => { m.plan[p.key] = (m.plan[p.key] || []).filter((r) => r.id !== row.id); });
  if (row.paid) await store.remove('expenses', { plan_ref: planRef(p, row.id) });
  if (forward) await eachLater(store, p.ym, row.id, (list) => list.filter((r) => r.id !== row.id || r.paid));
}

/** Постоянный платёж поменялся: та же правка во всех следующих месяцах, где он уже есть
 *  (месяцы, которых ещё нет, создадутся из последнего — уже с новой суммой). */
export async function saveRowForward(store: Store, p: Period, row: PlanRow) {
  await saveRow(store, p, row);
  await eachLater(store, p.ym, row.id, (list) => list.map((r) => (r.id === row.id ? { ...r, name: row.name, sum: row.sum, cat: row.cat, once: row.once } : r)));
}

async function eachLater(store: Store, ym: string, rowId: string, fn: (list: PlanRow[]) => PlanRow[]) {
  const later = store.snapshot().money_months.filter((m) => m.ym > ym && (['avans', 'zp'] as PayKey[]).some((k) => (m.plan[k] || []).some((r) => r.id === rowId)));
  for (const m of later) await saveMonth(store, m.ym, (x) => { for (const k of ['avans', 'zp'] as PayKey[]) if (x.plan[k]) x.plan[k] = fn(x.plan[k]!); });
}

/** Часть резерва — на жизнь: отложенное уменьшается (с последних поступлений), на сегодня появляется доход «на жизнь». */
export async function reserveToLive(store: Store, amount: number) {
  let left = amount;
  const src = store.incomes.filter((i) => i.target === 'reserve').sort((a, b) => b.got_on.localeCompare(a.got_on) || b.created_at.localeCompare(a.created_at));
  for (const i of src) {
    if (left <= 0) break;
    const take = Math.min(left, Number(i.amount));
    left -= take;
    if (take >= Number(i.amount)) await store.remove('incomes', { id: i.id });
    else await store.update('incomes', { id: i.id }, { amount: Number(i.amount) - take });
  }
  const moved = amount - left;
  if (moved > 0) await store.insert('incomes', { what: 'Из резерва на жизнь', amount: moved, source: src[0]?.source || 'Прочее', got_on: todayIso(), target: 'live' });
  return moved;
}

/** Перенести платёж с аванса на зарплату того же месяца или обратно. */
export async function moveRow(store: Store, p: Period, row: PlanRow) {
  const to = p.key === 'avans' ? 'zp' : 'avans';
  await saveMonth(store, p.ym, (m) => {
    m.plan[p.key] = (m.plan[p.key] || []).filter((r) => r.id !== row.id);
    m.plan[to] = [...(m.plan[to] || []), row];
  });
  if (row.paid) await store.update('expenses', { plan_ref: planRef(p, row.id) }, { plan_ref: planRef({ ym: p.ym, key: to }, row.id) });
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
export type Payout = { amount: number; source: 'actual' | 'fixed' | 'forecast' | 'plan'; forecast: Forecast | null; date: string };

/** Сколько придёт в выплату: факт, если пришла; введённая руками сумма; иначе — расчёт по зарплатным настройкам. */
export function payoutFor(store: Store, p: Period): Payout {
  const m = monthOrNew(store, p.ym);
  const pr = store.settings.payroll;
  const date = payDay(bounds(p).start, pr ?? DEFAULT_PAYROLL);
  const forecast = payrollReady(pr)
    ? (p.key === 'avans' ? avansForecast(p.ym, pr) : zpForecast(p.ym, pr, payoutFor(store, { ym: p.ym, key: 'avans' }).amount, extraWithVacation(store, p.ym)))
    : null;
  const stored = Number(m.income[p.key]) || 0;
  if (m.got[p.key]) return { amount: stored, source: 'actual', forecast, date };
  if (m.income.fixed?.[p.key]) return { amount: stored, source: 'fixed', forecast, date };
  if (forecast) return { amount: Math.round(forecast.amount), source: 'forecast', forecast, date };
  // Без зарплатных настроек — сумма из ближайшего прошлого месяца, где она была.
  const prev = store.money_months.filter((x) => x.ym < p.ym && Number(x.income[p.key]) > 0).sort((a, b) => b.ym.localeCompare(a.ym))[0];
  return { amount: stored || Number(prev?.income[p.key]) || 0, source: 'plan', forecast, date };
}

/** Если отпуск начинается в том же месяце ym, что и выплата отпускных, и вместе с ними пришло больше расчёта,
 *  разница — часть зарплаты за этот месяц, выплаченная раньше (как в августе 2026). Отпуск следующего месяца,
 *  оплаченный заранее, к расчёту за ym отношения не имеет. */
function extraWithVacation(store: Store, ym: string) {
  const pr = store.settings.payroll;
  if (!pr) return 0;
  const expected = vacationPayments(pr).filter((v) => v.date.slice(0, 7) === ym && v.vacation.start.slice(0, 7) === ym).reduce((a, v) => a + v.amount, 0);
  if (!expected) return 0;
  const got = store.incomes.filter((i) => i.source === 'Отпускные' && i.got_on.slice(0, 7) === ym).reduce((a, i) => a + Number(i.amount), 0);
  return got > expected + 500 ? Math.round(got - expected) : 0;
}

/** Итог периода с учётом прогноза выплаты. */
export function summaryFor(store: Store, p: Period, today = todayIso()) {
  return summarize(monthOrNew(store, p.ym), p, store.expenses, store.incomes, today, payoutFor(store, p).amount);
}

/** Сумму выплаты ввели руками — она важнее расчёта, пока её не сбросить. */
export async function setExpected(store: Store, p: Period, amount: number) {
  await saveMonth(store, p.ym, (m) => { m.income = { ...m.income, [p.key]: amount, fixed: { ...m.income.fixed, [p.key]: true } }; });
  if (store.incomes.some((i) => i.plan_ref === incomeRef(p))) await store.update('incomes', { plan_ref: incomeRef(p) }, { amount });
}

export async function resetExpected(store: Store, p: Period) {
  await saveMonth(store, p.ym, (m) => { const f = { ...m.income.fixed }; delete f[p.key]; const inc = { ...m.income, fixed: f }; delete inc[p.key]; m.income = inc; });
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

/** Удалить расход так, чтобы всё связанное откатилось: копилка желания уменьшается, оплаченный платёж снова «к оплате». */
export async function deleteExpense(store: Store, e: Expense) {
  await store.remove('expenses', { id: e.id });
  if (e.kind === 'saving') {
    const w = store.wishes.find((x) => `Копилка: ${x.title}` === e.what);
    if (w) await store.update('wishes', { id: w.id }, { saved_sum: Math.max(0, (Number(w.saved_sum) || 0) - Number(e.amount)) });
  }
  if (e.kind === 'payment' && e.plan_ref) {
    const [ym, key, rowId] = e.plan_ref.split(':') as [string, PayKey, string];
    await saveMonth(store, ym, (m) => { m.plan[key] = (m.plan[key] || []).map((r) => (r.id === rowId ? { id: r.id, name: r.name, sum: r.sum, cat: r.cat, paid: false, reserve: r.reserve, once: r.once } : r)); });
  }
}
