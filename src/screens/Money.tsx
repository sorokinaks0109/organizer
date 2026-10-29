// Деньги: вкладки «Сейчас» (сколько в день, к оплате, траты), «План» (выплаты вперёд), «Итоги»; резерв и итоги по месяцам.
import { useState } from 'react';
import { useStore } from '../lib/store';
import { useApp } from '../lib/context';
import { addDays, cap1, iso, MON, MON_N, MON_SHORT, money, parseIso, plural, todayIso, WD, ymShift, ymTitle } from '../lib/dates';
import { bounds, nextPeriod, PAY, periodOf, prevPeriod, reserveState, rowCost, samePeriod, SAVING_CATS, type Period, type Summary } from '../lib/money';
import { vacationPayments } from '../lib/payroll';
import { addIncome, confirmPayout, deleteExpense, deleteIncome, deleteRow, moveRow, payoutFor, payRow, resetExpected, saveRow, setExpected, setReserve, summaryFor, unconfirmPayout, unpayRow } from '../lib/moneyActions';
import { DEFAULT_PLAN_CATS, DEFAULT_SPEND_CATS, INCOME_SOURCES, type Expense, type Income, type PlanRow } from '../lib/types';
import { CHECK, Hero, Icon, Sheet, useToast } from '../components/ui';

const short = (d: string) => { const x = parseIso(d); return `${x.getDate()} ${MON_SHORT[x.getMonth()]}`; };
const dayLabel = (d: string) => { const x = parseIso(d); return `${x.getDate()} ${MON[x.getMonth()]}, ${WD[x.getDay()]}`; };
const abbr = (s: string) => s.replace(/[^\p{L}]/gu, '').slice(0, 2) || '·';

/** Все категории трат: стандартные, платёжные и свои — без повторов, по алфавиту. */
function useSpendCats() {
  const { settings } = useStore();
  return [...new Set([...DEFAULT_SPEND_CATS, ...(settings.planCats?.length ? settings.planCats : DEFAULT_PLAN_CATS), ...(settings.spendCats || [])])]
    .sort((a, b) => (a === 'Прочее' ? 1 : b === 'Прочее' ? -1 : a.localeCompare(b, 'ru')));
}
function usePlanCats() {
  const { settings } = useStore();
  return settings.planCats?.length ? settings.planCats : DEFAULT_PLAN_CATS;
}

type Tab = 'now' | 'plan' | 'stats';
let rememberedTab: Tab = 'now';

/** Деньги — три вкладки: «Сейчас» (сколько в день, что оплатить, траты), «План» (лента выплат вперёд), «Итоги». */
export function Money() {
  const [tab, setTabState] = useState<Tab>(rememberedTab);
  const setTab = (t: Tab) => { rememberedTab = t; setTabState(t); };
  return (
    <>
      <div className="topbar"><div className="hello"><h1 className="h">Деньги</h1></div></div>
      <div className="seg seg3" role="tablist" aria-label="Раздел">
        {([['now', 'Сейчас'], ['plan', 'План'], ['stats', 'Итоги']] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'now' && <NowTab />}
      {tab === 'plan' && <PlanTab />}
      {tab === 'stats' && <Stats embedded />}
    </>
  );
}

/** Ожидаемые отпускные в промежутке, пока не отмечено, что они пришли. */
function useExpectedVacations(start: string, end: string) {
  const store = useStore();
  const pr = store.settings.payroll;
  if (!pr) return [];
  return vacationPayments(pr).filter((v) => v.date >= start && v.date <= end
    && !store.incomes.some((i) => i.source === 'Отпускные' && Math.abs(parseIso(i.got_on).getTime() - parseIso(v.date).getTime()) <= 10 * 864e5));
}

function NowTab() {
  const store = useStore();
  const { go } = useApp();
  const today = todayIso();
  const p = periodOf(today);
  const s = summaryFor(store, p, today);
  const po = payoutFor(store, p);
  const reserve = reserveState(store.money_months, store.incomes);
  const [payout, setPayout] = useState(false);
  const [income, setIncome] = useState<Income | 'new' | Partial<Income> | null>(null);
  const [row, setRow] = useState<PlanRow | 'new' | null>(null);
  const [spend, setSpend] = useState<Expense | 'new' | null>(null);
  const [showPaid, setShowPaid] = useState(false);
  const [showIncome, setShowIncome] = useState(false);
  const [allSpends, setAllSpends] = useState(false);
  const nextStart = iso(addDays(parseIso(s.end), 1));

  const inRange = (d: string) => d >= s.start && d <= s.end;
  const incomes = store.incomes.filter((i) => inRange(i.got_on) && !i.plan_ref);
  const vacs = useExpectedVacations(s.start, s.end);
  const spends = store.expenses.filter((e) => inRange(e.spent_on) && e.kind !== 'payment').sort((a, b) => (b.spent_on + b.created_at).localeCompare(a.spent_on + a.created_at));
  const shown = allSpends ? spends : spends.slice(0, 8);
  const byDay: [string, Expense[]][] = [];
  for (const e of shown) { const last = byDay[byDay.length - 1]; if (last && last[0] === e.spent_on) last[1].push(e); else byDay.push([e.spent_on, [e]]); }
  const open = s.rows.filter((r) => !r.paid), done = s.rows.filter((r) => r.paid);
  const w = (v: number) => `${Math.max(0, (v / Math.max(s.income, s.planned + s.spent + s.saved, 1)) * 100).toFixed(2)}%`;
  const waiting = !s.received || vacs.length > 0;

  return (
    <>
      <div className="wallet">
        <span className="lbl-t">Можно тратить в день · {PAY[p.key].name.toLowerCase()} {short(s.start)} — {short(s.end)}</span>
        <div className={'big-num' + (s.free < 0 ? ' neg' : '')}>{money(s.perDay)} <small>ещё {s.daysLeft} {plural(s.daysLeft, 'день', 'дня', 'дней')}, до {short(nextStart)}</small></div>
        <div className="split" aria-hidden="true">
          <i className="paid" style={{ width: w(s.paid) }} /><i className="pay" style={{ width: w(s.left) }} /><i className="sp" style={{ width: w(s.spent) }} /><i className="sv" style={{ width: w(s.saved) }} /><i className="fr" style={{ width: w(s.free) }} />
        </div>
        <div className="legend">
          <div><span><i style={{ background: 'var(--d-blue)' }} />Платежи</span><b>{money(s.planned)}</b></div>
          <div><span><i style={{ background: 'var(--d-orange)' }} />Траты</span><b>{money(s.spent + s.saved)}</b></div>
          <div><span><i style={{ background: 'var(--ok)' }} />Свободно</span><b style={s.free < 0 ? { color: 'var(--danger)' } : undefined}>{money(s.free)}</b></div>
        </div>
        {s.free < 0 && <div className="alert"><b>Не хватает {money(-s.free)}.</b> {reserve.free > 0 ? `В резерве свободно ${money(reserve.free)} — повесь на него часть платежей во вкладке «План».` : 'Перенеси часть платежей на другую выплату или уменьши сумму.'}</div>}
      </div>

      <button type="button" className="addbtn" onClick={() => setSpend('new')}><Icon name="plus" w={2.4} />Добавить трату</button>

      <div className="block">
        <div className="bh"><h4>К оплате до {short(s.end)}</h4><span>{open.length ? money(s.left) : ''}</span></div>
        {!open.length && !done.length && <div className="empty" style={{ padding: 12 }}>Платежей с этой выплаты нет.</div>}
        {open.map((r) => <PayRow key={r.id} r={r} p={p} onEdit={() => setRow(r)} />)}
        {!open.length && done.length > 0 && <div className="alert ok">Всё оплачено.</div>}
        {done.length > 0 && <button type="button" className="paidtoggle" aria-expanded={showPaid} onClick={() => setShowPaid(!showPaid)}><span>Оплачено {done.length} из {s.rows.length}</span><b>{money(done.reduce((a, r) => a + rowCost(r), 0))} {showPaid ? '▴' : '▾'}</b></button>}
        {showPaid && done.map((r) => <PayRow key={r.id} r={r} p={p} onEdit={() => setRow(r)} />)}
        <button className="btn ghost" type="button" style={{ alignSelf: 'flex-start', paddingInline: 0 }} onClick={() => setRow('new')}>+ платёж</button>
      </div>

      <div className="block">
        <div className="bh"><h4>Траты</h4><span>{money(s.spent + s.saved)}</span></div>
        {byDay.map(([d, list]) => (
          <div key={d}>
            <div className="dayh"><span>{cap1(dayLabel(d))}</span><span>{money(list.reduce((a, e) => a + Number(e.amount), 0))}</span></div>
            {list.map((e) => (
              <button key={e.id} type="button" className={'sprow' + (e.kind === 'saving' ? ' save' : '')} onClick={() => setSpend(e)}>
                <span className="ic">{abbr(e.category)}</span>
                <span>{e.what}<small>{e.kind === 'saving' ? 'отложено' : e.what === e.category ? 'трата' : e.category}{e.wb ? ' · ВБ' : ''}</small></span>
                <span className="sm">{money(e.amount)}</span>
              </button>
            ))}
          </div>
        ))}
        {spends.length > shown.length && <button type="button" className="paidtoggle" onClick={() => setAllSpends(true)}><span>Показать все траты</span><b>ещё {spends.length - shown.length} ▾</b></button>}
        {!spends.length && <div className="empty" style={{ padding: 14 }}>Пока ничего. Скажи в микрофон «такси 342» или нажми «Добавить трату».</div>}
      </div>

      <div className="block">
        <button type="button" className="paidtoggle" style={{ marginTop: 0 }} aria-expanded={showIncome || waiting} onClick={() => setShowIncome(!showIncome)}>
          <span>Доходы периода</span><b>{money(s.income)} {showIncome || waiting ? '▴' : '▾'}</b>
        </button>
        {(showIncome || waiting) && <>
          {!store.settings.payroll?.oklad && <button type="button" className="alert ok" style={{ border: 0, textAlign: 'left', margin: '6px 0' }} onClick={() => go({ name: 'settings' })}>Заполни оклад и отпуска в Настройках → «Зарплата и отпуска» — аванс, зарплата и отпускные будут считаться сами ›</button>}
          <div className={'payrow' + (s.received ? ' on' : '')} style={{ ['--d-blue' as string]: 'var(--ok)' }}>
            <button type="button" className="cb" aria-label={`${PAY[p.key].name} пришёл`} onClick={() => setPayout(true)}>{s.received ? CHECK : null}</button>
            <button type="button" className="nm" onClick={() => setPayout(true)}>{PAY[p.key].name}<small>{s.received ? 'пришёл' : `ожидается ${dayLabel(po.date)}`}{po.source === 'forecast' ? ' · по расчёту' : po.source === 'fixed' ? ' · сумма введена' : ''}</small></button>
            <span className="sm" style={{ color: s.received ? 'var(--ok)' : undefined }}>{money(s.expected)}</span>
          </div>
          {vacs.map((v) => (
            <button key={v.date} type="button" className="sprow inc" style={{ opacity: 0.85 }} onClick={() => setIncome({ what: 'Отпускные', source: 'Отпускные', amount: Math.round(v.amount), got_on: v.date, target: 'reserve' })}>
              <span className="ic">○</span>
              <span>Отпускные<small>ожидаются {dayLabel(v.date)} · нажми, когда придут</small></span>
              <span className="sm" style={{ color: 'var(--muted)' }}>≈{money(v.amount)}</span>
            </button>
          ))}
          {incomes.map((i) => (
            <button key={i.id} type="button" className="sprow inc" onClick={() => setIncome(i)}>
              <span className="ic">+</span>
              <span>{i.what}<small>{i.source} · {short(i.got_on)}{i.target === 'reserve' ? ' · в резерв' : i.target === 'wish' ? ' · в копилку' : ''}</small></span>
              <span className="sm">+{money(i.amount)}</span>
            </button>
          ))}
          <button className="btn ghost" type="button" style={{ alignSelf: 'flex-start', paddingInline: 0 }} onClick={() => setIncome('new')}>+ доход</button>
        </>}
      </div>

      {payout && <PayoutSheet p={p} onClose={() => setPayout(false)} />}
      {income && <IncomeSheet key={income === 'new' ? 'new' : income.id ?? 'preset'} income={income === 'new' || !income.id ? null : income as Income} preset={income !== 'new' && !income.id ? income : undefined} onClose={() => setIncome(null)} />}
      {row && <RowSheet key={row === 'new' ? 'new' : row.id} p={p} row={row === 'new' ? null : row} onClose={() => setRow(null)} />}
      {spend && <SpendSheet key={spend === 'new' ? 'new' : spend.id} expense={spend === 'new' ? null : spend} onClose={() => setSpend(null)} />}
    </>
  );
}

/** Лента выплат вперёд: сколько придёт, какие платежи с неё, сколько останется. */
function PlanTab() {
  const store = useStore();
  const { go } = useApp();
  const today = todayIso();
  const [back, setBack] = useState(0);
  const [sheet, setSheet] = useState<{ p: Period; what: 'payout' | 'new' | PlanRow } | null>(null);
  const [income, setIncome] = useState<Partial<Income> | null>(null);
  const reserve = reserveState(store.money_months, store.incomes);
  let first = periodOf(today);
  for (let i = 0; i < back; i++) first = prevPeriod(first);
  const periods: Period[] = [];
  for (let q = first, i = 0; i < 6 + back; q = nextPeriod(q), i++) periods.push(q);
  return (
    <>
      <button className="resv" type="button" onClick={() => go({ name: 'reserve' })}>
        <small>Резерв (отпускные и другие отложенные деньги)</small>
        <b>{money(reserve.free)} свободно</b>
        <small>{reserve.allocated ? `${money(reserve.allocated)} уже разложено по платежам · ` : ''}нажми, чтобы закрыть платежи из резерва ›</small>
      </button>
      <button type="button" className="btn ghost" style={{ alignSelf: 'flex-start', paddingInline: 0 }} onClick={() => setBack(back + 2)}>‹ Показать прошлые выплаты</button>
      {periods.map((q) => <PlanCard key={q.ym + q.key} q={q} onSheet={(what) => setSheet({ p: q, what })} onVacation={setIncome} />)}
      {sheet?.what === 'payout' && <PayoutSheet p={sheet.p} onClose={() => setSheet(null)} />}
      {sheet && sheet.what !== 'payout' && <RowSheet key={sheet.what === 'new' ? 'new' : sheet.what.id} p={sheet.p} row={sheet.what === 'new' ? null : sheet.what} onClose={() => setSheet(null)} />}
      {income && <IncomeSheet key="preset" income={null} preset={income} onClose={() => setIncome(null)} />}
    </>
  );
}

function PlanCard({ q, onSheet, onVacation }: { q: Period; onSheet: (what: 'payout' | 'new' | PlanRow) => void; onVacation: (x: Partial<Income>) => void }) {
  const store = useStore();
  const today = todayIso();
  const s = summaryFor(store, q, today);
  const po = payoutFor(store, q);
  const vacs = useExpectedVacations(s.start, s.end);
  const isNow = samePeriod(q, periodOf(today)), past = s.end < today;
  const [open, setOpen] = useState(isNow);
  const unpaid = s.rows.filter((r) => !r.paid);
  return (
    <div className="block" style={past ? { opacity: 0.75 } : undefined}>
      <div className="bh">
        <h4>{PAY[q.key].name} {short(po.date)}{isNow ? ' · сейчас' : ''}</h4>
        <button type="button" onClick={() => onSheet('payout')} style={{ textDecoration: 'none', color: s.received ? 'var(--ok)' : 'var(--ink)', fontWeight: 600 }}>{s.received ? '' : '≈'}+{money(s.expected)}</button>
      </div>
      {vacs.map((v) => (
        <button key={v.date} type="button" className="sprow inc" style={{ opacity: 0.85 }} onClick={() => onVacation({ what: 'Отпускные', source: 'Отпускные', amount: Math.round(v.amount), got_on: v.date, target: 'reserve' })}>
          <span className="ic">○</span>
          <span>Отпускные {short(v.date)}<small>{v.days} {plural(v.days, 'день', 'дня', 'дней')} отпуска · идут в резерв</small></span>
          <span className="sm" style={{ color: 'var(--muted)' }}>≈+{money(v.amount)}</span>
        </button>
      ))}
      <button type="button" className="paidtoggle" style={{ marginTop: 0 }} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>Платежи{unpaid.length < s.rows.length ? ` · оплачено ${s.rows.length - unpaid.length} из ${s.rows.length}` : ` · ${s.rows.length}`}</span>
        <b>{money(s.planned)}{s.fromReserve ? ` + из резерва ${money(s.fromReserve)}` : ''} {open ? '▴' : '▾'}</b>
      </button>
      {open && <>
        {s.rows.map((r) => <PayRow key={r.id} r={r} p={q} onEdit={() => onSheet(r)} />)}
        <button className="btn ghost" type="button" style={{ alignSelf: 'flex-start', paddingInline: 0 }} onClick={() => onSheet('new')}>+ платёж</button>
      </>}
      <div className="kv" style={{ paddingTop: 6 }}>
        <span>{past ? 'Осталось' : s.free < 0 ? 'Не хватает' : 'Останется на жизнь'}</span>
        <b style={s.free < 0 ? { color: 'var(--danger)' } : { color: 'var(--ok)' }}>{s.free < 0 ? money(-s.free) : `${money(s.free)} · ≈${money(s.free / s.days)} в день`}</b>
      </div>
    </div>
  );
}

function PayRow({ r, p, onEdit }: { r: PlanRow; p: Period; onEdit: () => void }) {
  const store = useStore();
  const toast = useToast();
  const tick = async () => {
    if (r.paid) { await unpayRow(store, p, r); return; }
    await payRow(store, p, r);
    toast(`${r.name}: оплачено, в расходах ${money(r.sum)}`);
  };
  return (
    <div className={'payrow' + (r.paid ? ' on' : '') + (r.reserve ? ' res' : '')}>
      <button type="button" className="cb" aria-label={(r.paid ? 'Снять оплату: ' : 'Оплачено: ') + r.name} onClick={tick}>{r.paid ? CHECK : null}</button>
      <button type="button" className="nm" onClick={onEdit}>{r.name}<small>{r.cat}{r.reserve ? <span className="tagr"> · из резерва</span> : null}{r.paid && r.paid_on ? ` · ${short(r.paid_on)}` : ''}{r.once ? ' · разовый' : ''}</small></button>
      <span className="sm">{money(rowCost(r))}</span>
    </div>
  );
}

/** Выплата пришла: подтвердить или поправить сумму. */
export function PayoutSheet({ p, onClose }: { p: Period; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const s = summaryFor(store, p);
  const po = payoutFor(store, p);
  const [sum, setSum] = useState(String(Math.round(s.expected) || ''));
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>, msg: string) => { setBusy(true); await f(); setBusy(false); toast(msg); onClose(); };
  return (
    <Sheet open onClose={onClose}>
      <h3>{PAY[p.key].name} {dayLabel(po.date)}</h3>
      {po.forecast ? (
        <div className="card" style={{ background: 'var(--field)', gap: 4, padding: 12 }}>
          <span className="lbl-t">Расчёт по окладу и графику{p.key === 'zp' ? ' — за месяц, минус аванс' : ' — за 1–15 число'}</span>
          {po.forecast.lines.map(([k, v], i) => <div key={i} className="kv mini"><span>{k}</span><span>{v < 0 ? '−' : ''}{money(Math.abs(v))}</span></div>)}
          <div className="kv"><b>Ожидается</b><b>{money(po.forecast.amount)}</b></div>
          {po.source === 'fixed' && <span className="mini">Сейчас стоит введённая тобой сумма {money(s.expected)}.</span>}
        </div>
      ) : <span className="mini">Чтобы сумма считалась сама, заполни оклад в Настройках → «Зарплата и отпуска».</span>}
      <span className="mini">Пришло не столько — впиши, сколько на самом деле. Это попадёт в доходы{p.key === 'avans' ? ', а зарплата пересчитается от фактического аванса' : ''}.</span>
      <input className="field amount" type="number" inputMode="numeric" value={sum} aria-label="Сумма" onChange={(e) => setSum(e.target.value)} />
      <div className="row">
        <button className="btn primary" type="button" disabled={busy || !(Number(sum) > 0)} onClick={() => run(() => confirmPayout(store, p, Number(sum)), `${PAY[p.key].name} ${money(Number(sum))} — в доходах`)}>{s.received ? 'Сохранить сумму' : 'Пришло'}</button>
        {!s.received && <button className="btn" type="button" disabled={busy || !(Number(sum) > 0)} onClick={() => run(() => setExpected(store, p, Number(sum)), 'Ожидаемая сумма сохранена')}>Ещё не пришло, просто сумма</button>}
        {!s.received && po.source === 'fixed' && po.forecast && <button className="btn ghost" type="button" disabled={busy} onClick={() => run(() => resetExpected(store, p), 'Снова по расчёту')}>Вернуть расчёт</button>}
        {s.received && <button className="btn ghost danger" type="button" disabled={busy} onClick={() => run(() => unconfirmPayout(store, p), 'Отметка снята')}>Не пришло</button>}
      </div>
    </Sheet>
  );
}

export function IncomeSheet({ income, preset, onClose }: { income: Income | null; preset?: Partial<Income>; onClose: () => void }) {
  const store = useStore();
  const { go } = useApp();
  const toast = useToast();
  const base = income ?? preset;
  const [what, setWhat] = useState(base?.what || '');
  const [sum, setSum] = useState(base?.amount ? String(base.amount) : '');
  const [source, setSource] = useState(base?.source || 'Премия');
  const [date, setDate] = useState(base?.got_on && base.got_on <= todayIso() ? base.got_on : todayIso());
  const [target, setTarget] = useState<Income['target']>(base?.target || 'live');
  const [wish, setWish] = useState(income?.wish_id || '');
  const wishes = store.wishes.filter((x) => x.status !== 'done');
  const save = async () => {
    const amount = Number(sum); if (!(amount > 0)) return;
    if (income) await deleteIncome(store, income);
    await addIncome(store, { what: what.trim() || source, amount, source, got_on: date, target, wish_id: target === 'wish' ? wish || null : null });
    onClose();
    if (target === 'reserve') { toast('В резерве. Теперь выбери, какие платежи он закроет'); go({ name: 'reserve' }); }
    else toast(`+${money(amount)} в доходах`);
  };
  return (
    <Sheet open onClose={onClose}>
      <h3>{income ? 'Доход' : 'Новый доход'}</h3>
      <input className="field amount" type="number" inputMode="numeric" placeholder="0 ₽" value={sum} aria-label="Сумма" onChange={(e) => setSum(e.target.value)} />
      <div className="chips">{INCOME_SOURCES.map((x) => <button key={x} type="button" className="chip" aria-pressed={source === x} onClick={() => { setSource(x); if (x === 'Отпускные') setTarget('reserve'); }}>{x}</button>)}</div>
      <div className="row">
        <label className="lbl">Что<input className="field" value={what} placeholder={source} onChange={(e) => setWhat(e.target.value)} /></label>
        <label className="lbl">Когда<input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <span className="lbl-t">Куда направить</span>
      <div className="target" role="group" aria-label="Куда направить">
        <button type="button" aria-pressed={target === 'live'} onClick={() => setTarget('live')}>На жизнь сейчас<small>прибавится к «можно тратить в день»</small></button>
        <button type="button" aria-pressed={target === 'reserve'} onClick={() => setTarget('reserve')}>Наперёд на платежи<small>в резерв: выберешь, какие платежи следующих месяцев он закроет</small></button>
        {wishes.length > 0 && <button type="button" aria-pressed={target === 'wish'} onClick={() => setTarget('wish')}>В копилку желания<small>сумма прибавится к накопленному</small></button>}
      </div>
      {target === 'wish' && <select className="field" value={wish} aria-label="Желание" onChange={(e) => setWish(e.target.value)}><option value="">выбери желание</option>{wishes.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>}
      <div className="row">
        <button className="btn primary" type="button" disabled={!(Number(sum) > 0) || (target === 'wish' && !wish)} onClick={save}>Сохранить</button>
        <span style={{ flex: 1 }} />
        {income && <button className="btn ghost danger" type="button" onClick={async () => { await deleteIncome(store, income); onClose(); }}>Удалить</button>}
      </div>
    </Sheet>
  );
}

function RowSheet({ p, row, onClose }: { p: Period; row: PlanRow | null; onClose: () => void }) {
  const store = useStore();
  const cats = usePlanCats();
  const [name, setName] = useState(row?.name || '');
  const [sum, setSum] = useState(row ? String(row.sum) : '');
  const [paidSum, setPaidSum] = useState(row?.paid ? String(row.paid_sum ?? row.sum) : '');
  const [cat, setCat] = useState(row?.cat || cats[0]);
  const [once, setOnce] = useState(!!row?.once);
  const [reserve, setRes] = useState(!!row?.reserve);
  const save = async () => {
    if (!name.trim() || !(Number(sum) > 0)) return;
    const next: PlanRow = { ...(row || { id: crypto.randomUUID(), paid: false }), name: name.trim(), sum: Number(sum), cat, once, reserve };
    if (next.paid) next.paid_sum = Number(paidSum) || next.sum;
    await saveRow(store, p, next);
    if (row && row.reserve !== reserve) await setReserve(store, p, row.id, reserve);
    onClose();
  };
  return (
    <Sheet open onClose={onClose}>
      <h3>{row ? row.name : `Новый платёж с выплаты «${PAY[p.key].name}»`}</h3>
      <div className="row">
        <label className="lbl" style={{ flex: '2 1 160px' }}>Название<input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="ТСЖ" /></label>
        <label className="lbl">По плану, ₽<input className="field" type="number" inputMode="numeric" value={sum} onChange={(e) => setSum(e.target.value)} /></label>
        {row?.paid && <label className="lbl">Оплачено, ₽<input className="field" type="number" inputMode="numeric" value={paidSum} onChange={(e) => setPaidSum(e.target.value)} /></label>}
      </div>
      <label className="lbl" style={{ flex: 'none' }}>Категория<select className="field" value={cat} onChange={(e) => setCat(e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="toggle-row"><input type="checkbox" className="check" checked={once} onChange={(e) => setOnce(e.target.checked)} /><span>Разовый<br /><small className="mini">в следующий месяц не переносится</small></span></label>
      <label className="toggle-row"><input type="checkbox" className="check" checked={reserve} onChange={(e) => setRes(e.target.checked)} /><span>Оплачу из резерва<br /><small className="mini">не уменьшает деньги этой выплаты</small></span></label>
      <div className="row">
        <button className="btn primary" type="button" onClick={save}>Сохранить</button>
        <span style={{ flex: 1 }} />
        {row && <button className="btn" type="button" onClick={async () => { await moveRow(store, p, row); onClose(); }}>{p.key === 'avans' ? 'Платить с зарплаты' : 'Платить с аванса'}</button>}
        {row && <button className="btn ghost danger" type="button" onClick={async () => { await deleteRow(store, p, row); onClose(); }}>Удалить</button>}
      </div>
    </Sheet>
  );
}

/** Трата в два касания: категория, сумма с клавиатуры. */
function SpendSheet({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const allCats = useSpendCats();
  // Плитками — 8 категорий, которыми пользуешься чаще всего; остальные в списке.
  const used: Record<string, number> = {};
  for (const e of store.expenses) if (e.kind === 'spend') used[e.category] = (used[e.category] || 0) + 1;
  const top = [...allCats].sort((a, b) => (used[b] || 0) - (used[a] || 0) || allCats.indexOf(a) - allCats.indexOf(b)).slice(0, 8);
  const cats = allCats;
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '');
  const [cat, setCat] = useState(expense?.category || cats[0]);
  const [what, setWhat] = useState(expense?.what || '');
  const [date, setDate] = useState(expense?.spent_on || todayIso());
  const [wb, setWb] = useState(!!expense?.wb);
  const key = (k: string) => setAmount((a) => (k === '⌫' ? a.slice(0, -1) : a.length < 7 ? (a === '0' ? k : a + k) : a));
  const save = async () => {
    const n = Number(amount); if (!(n > 0)) return;
    const row = { what: what.trim() || cat, amount: n, category: cat, spent_on: date, wb };
    if (expense) await store.update('expenses', { id: expense.id }, row);
    else await store.insert('expenses', { ...row, kind: 'spend' });
    toast(`${cat}: ${money(n)}`); onClose();
  };
  return (
    <Sheet open onClose={onClose}>
      <div className="amount">{amount ? money(Number(amount)) : <span style={{ color: 'var(--muted)' }}>0 ₽</span>}</div>
      <div className="catgrid">{top.map((c) => <button key={c} type="button" aria-pressed={c === cat} onClick={() => setCat(c)}><span>{abbr(c)}</span>{c}</button>)}</div>
      <select className="field" aria-label="Все категории" value={top.includes(cat) ? '' : cat} onChange={async (e) => {
        const v = e.target.value;
        if (v === '+') { const n = prompt('Новая категория')?.trim(); if (!n) return; await store.saveSettings({ spendCats: [...allCats, n] }); setCat(n); return; }
        if (v) setCat(v);
      }}>
        <option value="">{top.includes(cat) ? 'Другая категория…' : cat}</option>
        {allCats.filter((c) => !top.includes(c)).map((c) => <option key={c} value={c}>{c}</option>)}
        <option value="+">＋ Своя категория</option>
      </select>
      <div className="row">
        <input className="field" style={{ flex: '2 1 140px' }} value={what} placeholder="Что (можно не писать)" aria-label="Что" onChange={(e) => setWhat(e.target.value)} />
        <input className="field" style={{ flex: '1 1 120px' }} type="date" value={date} aria-label="Дата" onChange={(e) => setDate(e.target.value)} />
        <label className="row mini" style={{ gap: 6 }}><input type="checkbox" checked={wb} onChange={(e) => setWb(e.target.checked)} />ВБ</label>
      </div>
      <div className="keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0'].map((k) => <button key={k} type="button" onClick={() => key(k)}>{k}</button>)}
        <button type="button" className="ok" disabled={!(Number(amount) > 0)} onClick={save}>Готово</button>
      </div>
      {expense && <button className="btn ghost danger" type="button" onClick={async () => {
        await deleteExpense(store, expense); onClose();
        const per = periodOf(expense.spent_on), cur = periodOf(todayIso());
        toast(samePeriod(per, cur) ? `Удалено — ${money(expense.amount)} снова свободны` : `Удалено — ${money(expense.amount)} вернулись в период «${PAY[per.key].name} ${short(bounds(per).start)}», трата была ${short(expense.spent_on)}`);
      }}>Удалить трату</button>}
    </Sheet>
  );
}

/** Резерв: отпускные и другие отложенные деньги раскладываются на платежи следующих выплат. */
export function Reserve() {
  const store = useStore();
  const { go } = useApp();
  const toast = useToast();
  const today = todayIso();
  const r = reserveState(store.money_months, store.incomes);
  const periods: Period[] = [];
  for (let q = periodOf(today), i = 0; i < 6; q = nextPeriod(q), i++) periods.push(q);
  const sums: Summary[] = periods.map((q) => summaryFor(store, q, today));
  const put = store.incomes.filter((i) => i.target === 'reserve').sort((a, b) => b.got_on.localeCompare(a.got_on));
  const toggle = async (q: Period, row: PlanRow) => {
    if (!row.reserve && rowCost(row) > r.free) toast(`В резерве свободно только ${money(r.free)} — платёж уйдёт в минус резерва`);
    await setReserve(store, q, row.id, !row.reserve);
  };
  return (
    <>
      <Hero color="purple" title="Резерв" onBack={() => go({ name: 'money' })}>
        <div className="big-num" style={{ color: 'var(--d-purple)' }}>{money(r.free)}</div>
        <span className="mini" style={{ color: 'var(--d-purple)' }}>свободно · всего отложено {money(r.put)}, разложено {money(r.allocated)}, уже оплачено из резерва {money(r.put - r.balance)}</span>
      </Hero>
      <span className="mini">Отметь платежи, которые закроешь из резерва. В их периоде они не будут съедать аванс или зарплату — свободных денег там станет больше.</span>
      {sums.map((s, i) => {
        const q = periods[i];
        const rows = s.rows.filter((x) => !x.paid || x.reserve);
        return (
          <div key={q.ym + q.key} className="block">
            <div className="bh"><h4>{PAY[q.key].name} {short(s.start)}</h4><span style={s.free < 0 ? { color: 'var(--danger)' } : undefined}>{s.free < 0 ? `не хватает ${money(-s.free)}` : `свободно ${money(s.free)}`}</span></div>
            {!rows.length && <div className="mini">Неоплаченных платежей нет.</div>}
            {rows.map((x) => (
              <div key={x.id} className={'payrow res' + (x.reserve ? ' on' : '')}>
                <button type="button" className="cb" aria-label={(x.reserve ? 'Снять с резерва: ' : 'Из резерва: ') + x.name} disabled={x.paid} onClick={() => toggle(q, x)}>{x.reserve ? CHECK : null}</button>
                <span className="nm">{x.name}<small>{x.cat}{x.paid ? ' · уже оплачен' : ''}</small></span>
                <span className="sm">{money(rowCost(x))}</span>
              </div>
            ))}
          </div>
        );
      })}
      <div className="block">
        <div className="bh"><h4>Что отложено</h4></div>
        {put.map((i) => <div key={i.id} className="sprow inc"><span className="ic">+</span><span>{i.what}<small>{i.source} · {short(i.got_on)}</small></span><span className="sm">+{money(i.amount)}</span></div>)}
        {!put.length && <div className="mini">Пока ничего. Пришли отпускные — добавь доход и выбери «Наперёд на платежи».</div>}
      </div>
    </>
  );
}

/** Итоги по месяцам: доходы по источникам, платежи, траты и накопления по категориям, сравнение с прошлым месяцем. */
export function Stats({ embedded = false }: { embedded?: boolean }) {
  const store = useStore();
  const { go } = useApp();
  const thisYm = todayIso().slice(0, 7);
  const [ym, setYm] = useState(thisYm);
  const [range, setRange] = useState<1 | 3 | 12>(1);
  const [open, setOpen] = useState<string | null>(null);
  const months = Array.from({ length: range }, (_, i) => ymShift(ym, -i));
  const inM = (d: string, list = months) => list.includes(d.slice(0, 7));
  const isSaving = (e: Expense) => e.kind === 'saving' || SAVING_CATS.includes(e.category);
  const ex = store.expenses.filter((e) => inM(e.spent_on));
  const inc = store.incomes.filter((i) => inM(i.got_on));
  const group = <T,>(list: T[], key: (x: T) => string, val: (x: T) => number) => {
    const g: Record<string, number> = {};
    for (const x of list) g[key(x)] = (g[key(x)] || 0) + val(x);
    return Object.entries(g).sort((a, b) => b[1] - a[1]);
  };
  const sumOf = (l: [string, number][]) => l.reduce((a, x) => a + x[1], 0);
  const incBy = group(inc, (i) => i.source, (i) => Number(i.amount));
  const payBy = group(ex.filter((e) => e.kind === 'payment' && !isSaving(e)), (e) => e.category, (e) => Number(e.amount));
  const spBy = group(ex.filter((e) => e.kind === 'spend' && !isSaving(e)), (e) => e.category, (e) => Number(e.amount));
  const svBy = group(ex.filter(isSaving), (e) => e.category, (e) => Number(e.amount));
  const prevMonths = months.map((m) => ymShift(m, -range));
  const prevSp = Object.fromEntries(group(store.expenses.filter((e) => e.kind === 'spend' && !isSaving(e) && inM(e.spent_on, prevMonths)), (e) => e.category, (e) => Number(e.amount)));
  const totalIn = sumOf(incBy), totalOut = sumOf(payBy) + sumOf(spBy), totalSv = sumOf(svBy);
  // Столбики за 12 месяцев: платежи, траты, накопления.
  const bars = Array.from({ length: 12 }, (_, i) => ymShift(thisYm, i - 11)).map((m) => {
    const l = store.expenses.filter((e) => e.spent_on.slice(0, 7) === m);
    return { m, pay: l.filter((e) => e.kind === 'payment' && !isSaving(e)).reduce((a, e) => a + Number(e.amount), 0), sp: l.filter((e) => e.kind === 'spend' && !isSaving(e)).reduce((a, e) => a + Number(e.amount), 0), sv: l.filter(isSaving).reduce((a, e) => a + Number(e.amount), 0) };
  });
  const max = Math.max(1, ...bars.map((b) => b.pay + b.sp + b.sv));
  const label = range === 1 ? ymTitle(ym) : range === 3 ? `${MON_N[Number(months[2].slice(5)) - 1]} — ${MON_N[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}` : `12 месяцев до ${MON_N[Number(ym.slice(5)) - 1].toLowerCase()} ${ym.slice(0, 4)}`;
  const Cats = ({ title, list, color, cmp }: { title: string; list: [string, number][]; color: string; cmp?: Record<string, number> }) => list.length ? (
    <div className="block">
      <div className="bh"><h4>{title}</h4><span>{money(sumOf(list))}</span></div>
      <div className="cats">{list.map(([c, v]) => {
        const was = cmp?.[c] ?? 0, diff = v - was;
        const items = ex.filter((e) => e.category === c && (title !== 'Траты' || e.kind === 'spend')).sort((a, b) => b.spent_on.localeCompare(a.spent_on));
        return (
          <div key={c}>
            <button type="button" className="catline" style={{ ['--cbar' as string]: color }} aria-expanded={open === title + c} onClick={() => setOpen(open === title + c ? null : title + c)}>
              <span>{c}{cmp && was > 0 && Math.abs(diff) >= 500 ? <span className={'cmp ' + (diff > 0 ? 'up' : 'down')}> {diff > 0 ? '▲' : '▼'} {money(Math.abs(diff))}</span> : null}</span>
              <span>{money(v)}</span><div className="bar"><i style={{ width: `${(v / list[0][1]) * 100}%` }} /></div>
            </button>
            {open === title + c && items.slice(0, 30).map((e) => <div key={e.id} className="kv mini" style={{ padding: '3px 0 3px 8px' }}><span>{short(e.spent_on)} · {e.what}</span><span>{money(e.amount)}</span></div>)}
          </div>
        );
      })}</div>
    </div>
  ) : null;
  return (
    <>
      {embedded
        ? <div className="filters" role="group" aria-label="Срок">{([[1, 'Месяц'], [3, '3 месяца'], [12, 'Год']] as const).map(([n, l]) => <button key={n} type="button" aria-pressed={range === n} onClick={() => setRange(n)}>{l}</button>)}</div>
        : <Hero color="green" title="Итоги" onBack={() => go({ name: 'money' })}>
          <div className="seg seg3" role="tablist">
            {([[1, 'Месяц'], [3, '3 месяца'], [12, 'Год']] as const).map(([n, l]) => <button key={n} type="button" role="tab" aria-selected={range === n} onClick={() => setRange(n)}>{l}</button>)}
          </div>
        </Hero>}
      <div className="block">
        <div className="bh"><h4>{label}</h4><span>траты · платежи · накопления</span></div>
        <div className="mbars">
          {bars.map((b) => (
            <button key={b.m} type="button" aria-pressed={months.includes(b.m)} onClick={() => setYm(b.m)} title={`${ymTitle(b.m)}: ${money(b.pay + b.sp + b.sv)}`}>
              <span className="st" style={{ height: `${((b.pay + b.sp + b.sv) / max) * 100}%` }}>
                <i style={{ flex: b.pay, background: 'var(--d-blue)' }} /><i style={{ flex: b.sp, background: 'var(--d-orange)' }} /><i style={{ flex: b.sv, background: 'var(--d-purple)' }} />
              </span>
              {MON_SHORT[Number(b.m.slice(5)) - 1]}
            </button>
          ))}
        </div>
      </div>
      <div className="wallet">
        <div className="kv"><span>Доходы</span><b style={{ color: 'var(--ok)' }}>+{money(totalIn)}</b></div>
        <div className="kv"><span>Платежи и траты</span><b>−{money(totalOut)}</b></div>
        <div className="kv"><span>Инвестиции и накопления</span><b>{money(totalSv)}</b></div>
        <div className="kv"><span>Осталось</span><b style={totalIn - totalOut - totalSv < 0 ? { color: 'var(--danger)' } : undefined}>{money(totalIn - totalOut - totalSv)}</b></div>
      </div>
      {incBy.length > 0 && <div className="block"><div className="bh"><h4>Доходы по источникам</h4><span>{money(totalIn)}</span></div><div className="cats">{incBy.map(([c, v]) => <div key={c} className="catline" style={{ ['--cbar' as string]: 'var(--ok)' }}><span>{c}</span><span>{money(v)}</span><div className="bar"><i style={{ width: `${(v / incBy[0][1]) * 100}%` }} /></div></div>)}</div></div>}
      <Cats title="Траты" list={spBy} color="var(--d-orange)" cmp={prevSp} />
      <Cats title="Платежи" list={payBy} color="var(--d-blue)" />
      <Cats title="Инвестиции и накопления" list={svBy} color="var(--d-purple)" />
      {!ex.length && !inc.length && <div className="empty">За этот срок записей нет.</div>}
      {spBy.length > 0 && range === 1 && <span className="mini">▲▼ — разница с прошлым месяцем, если больше 500 ₽.</span>}
    </>
  );
}
