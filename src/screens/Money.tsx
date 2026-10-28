// Деньги: план месяца по выплатам (аванс 28-го, зарплата 13-го), доходы, траты по дням и итоги за период.
import { useState } from 'react';
import { useStore } from '../lib/store';
import { useApp } from '../lib/context';
import { cap1, fmtDate, MON, MON_N, MON_PREP, MON_SHORT, money, parseIso, plural, todayIso, WD_FULL, ymMonth, ymOf, ymShift, ymTitle } from '../lib/dates';
import { DEFAULT_PLAN_CATS, DEFAULT_SPEND_CATS, INCOME_SOURCES, type Expense, type MoneyMonth, type PlanRow } from '../lib/types';
import { Chip, Hero, Icon, Sheet, sc, useToast } from '../components/ui';

const BLOCKS = [
  { key: 'avans' as const, name: 'Аванс', day: 28, shift: 0 },
  { key: 'zp' as const, name: 'Зарплата', day: 13, shift: 1 },
  { key: 'other' as const, name: 'Платежи с премий и доходов', day: 0, shift: 0 },
];
const blockDate = (b: (typeof BLOCKS)[number], ym: string, short = false) => { const m = ymMonth(ymShift(ym, b.shift)); return `${b.day} ${short ? MON_SHORT[m] : MON[m]}`; };
const sum = (rows?: { sum: number }[]) => (rows || []).reduce((a, r) => a + (Number(r.sum) || 0), 0);
const defaultMonth = () => { const d = new Date(); return d.getDate() < 13 ? ymShift(ymOf(d), -1) : ymOf(d); };

let currentYm = defaultMonth();
function useMonth() {
  const [ym, setYm] = useState(currentYm);
  return [ym, (v: string) => { currentYm = v; setYm(v); }] as const;
}

function MonthHead({ ym, setYm }: { ym: string; setYm: (v: string) => void }) {
  return (
    <div className="cal-head">
      <button className="ibtn" type="button" aria-label="Предыдущий месяц" onClick={() => setYm(ymShift(ym, -1))}><Icon name="back" /></button>
      <h1 className="h">{ymTitle(ym)}</h1>
      <button className="ibtn" type="button" aria-label="Следующий месяц" onClick={() => setYm(ymShift(ym, 1))}><Icon name="next" /></button>
    </div>
  );
}

function useMonthData(ym: string) {
  const store = useStore();
  const m = store.money_months.find((x) => x.ym === ym) || null;
  const ex = store.expenses.filter((e) => e.spent_on.slice(0, 7) === ym);
  const inc = store.incomes.filter((e) => e.got_on.slice(0, 7) === ym);
  const save = async (mut: (m: MoneyMonth) => void) => {
    const cur: MoneyMonth = JSON.parse(JSON.stringify(m || { ym, income: {}, got: {}, plan: {} }));
    mut(cur);
    await store.upsert('money_months', { ym, income: cur.income, got: cur.got, plan: cur.plan });
  };
  return { m, ex, inc, save };
}

export function Money() {
  const store = useStore();
  const { go, openCapture } = useApp();
  const [ym, setYm] = useMonth();
  const { m, ex, inc, save } = useMonthData(ym);
  const spent = ex.reduce((a, e) => a + Number(e.amount), 0);
  const extra = inc.reduce((a, e) => a + Number(e.amount), 0);
  const wbLimit = store.settings.wbLimit ?? 12000;
  const wb = ex.filter((e) => e.wb).reduce((a, e) => a + Number(e.amount), 0);

  if (!m) {
    const prev = store.money_months.find((x) => x.ym === ymShift(ym, -1));
    return (
      <>
        <MonthHead ym={ym} setYm={setYm} />
        <div className="card">
          <span>Плана платежей на {ymTitle(ym).toLowerCase()} ещё нет.</span>
          {prev && <button className="btn primary" type="button" onClick={() => save((c) => { c.income = { ...prev.income }; c.got = {}; c.plan = { avans: (prev.plan.avans || []).map((r) => ({ ...r, id: crypto.randomUUID(), paid: false })), zp: (prev.plan.zp || []).map((r) => ({ ...r, id: crypto.randomUUID(), paid: false })), other: [] }; })}>Перенести платежи из «{ymTitle(prev.ym)}»</button>}
          <button className="btn" type="button" onClick={() => save(() => {})}>Начать с пустого</button>
        </div>
        <SpendCard ex={ex} spent={spent} wb={wb} wbLimit={wbLimit} onOpen={() => go({ name: 'spend' })} />
      </>
    );
  }
  const income = (m.income.avans || 0) + (m.income.zp || 0) + extra;
  const planned = BLOCKS.reduce((a, b) => a + sum(m.plan[b.key]), 0);
  const free = income - planned - spent;
  return (
    <>
      <MonthHead ym={ym} setYm={setYm} />
      <div className="card">
        <div className="card-t">Свободно в {MON_PREP[ymMonth(ym)]}</div>
        <div className={'big-num' + (free < 0 ? ' neg' : '')}>{money(free)}</div>
        <div className="kv"><span>Доход месяца</span><span>{money(income)}</span></div>
        <div className="kv"><span>Платежи по плану</span><span>{money(planned)}</span></div>
        <div className="kv"><span>Траты</span><span>{money(spent)}</span></div>
      </div>
      <div className="card">
        <div className="card-t"><span>Доходы</span><button type="button" onClick={() => openCapture(null)}>+ доход голосом</button></div>
        {BLOCKS.slice(0, 2).map((b) => (
          <div key={b.key} className="prow" style={sc('green')}>
            <input className="check" type="checkbox" checked={!!m.got[b.key as 'avans' | 'zp']} aria-label={`${b.name} пришёл`} onChange={() => save((c) => { c.got = { ...c.got, [b.key]: !c.got[b.key as 'avans' | 'zp'] }; })} />
            <button className="nm" type="button" onClick={() => go({ name: 'pay', key: b.key })}><span>{b.name}</span><small>{m.got[b.key as 'avans' | 'zp'] ? 'пришло' : 'ожидается'} · {blockDate(b, ym)}</small></button>
            <span className="sum" style={m.got[b.key as 'avans' | 'zp'] ? undefined : { color: 'var(--muted)' }}>{money(m.income[b.key as 'avans' | 'zp'] || 0)}</span>
          </div>
        ))}
        {inc.map((x) => <IncomeRow key={x.id} id={x.id} />)}
      </div>
      {BLOCKS.map((b) => {
        const rows = m.plan[b.key] || [];
        if (b.key === 'other' && !rows.length && !extra) return null;
        const left = sum(rows.filter((r) => !r.paid)), total = sum(rows);
        return (
          <button key={b.key} className="card paycard" type="button" style={sc('green')} onClick={() => go({ name: 'pay', key: b.key })}>
            <div className="pay-h"><b>{b.name}{b.day ? ` · ${blockDate(b, ym, true)}` : ''}</b><small>{rows.filter((r) => r.paid).length} из {rows.length} оплачено</small></div>
            <div className="bar"><i style={{ width: `${total ? Math.round(((total - left) / total) * 100) : 0}%` }} /></div>
            <div className="kv"><span>{rows.length && !left ? 'Всё оплачено' : 'Осталось оплатить'}</span><span>{rows.length && !left ? '✓' : money(left)}</span></div>
          </button>
        );
      })}
      <SpendCard ex={ex} spent={spent} wb={wb} wbLimit={wbLimit} onOpen={() => go({ name: 'spend' })} />
      <button className="btn" type="button" style={{ background: 'var(--surface)' }} onClick={() => go({ name: 'stats' })}><Icon name="stats" /> Итоги и аналитика за период</button>
    </>
  );
}

function catTotals(ex: Expense[]) {
  const t: Record<string, number> = {};
  for (const e of ex) t[e.category] = (t[e.category] || 0) + Number(e.amount);
  return Object.entries(t).sort((a, b) => b[1] - a[1]);
}

function SpendCard({ ex, spent, wb, wbLimit, onOpen }: { ex: Expense[]; spent: number; wb: number; wbLimit: number; onOpen: () => void }) {
  const cats = catTotals(ex).slice(0, 3);
  return (
    <button className="card paycard" type="button" style={sc(wb > wbLimit ? 'red' : 'purple')} onClick={onOpen}>
      <div className="pay-h"><b>Траты</b><small>{money(spent)}</small></div>
      <div className="kv"><span>Вайлдберриз</span><span style={wb > wbLimit ? { color: 'var(--danger)' } : undefined}>{money(wb)} из {money(wbLimit)}</span></div>
      <div className="bar"><i style={{ width: `${Math.min(100, Math.round((wb / wbLimit) * 100))}%` }} /></div>
      <span className="mini">{cats.length ? cats.map(([c, v]) => `${c} ${money(v)}`).join(' · ') : 'Надиктуй в «+»: «Лента 2300, такси 450».'}</span>
    </button>
  );
}

function IncomeRow({ id }: { id: string }) {
  const store = useStore();
  const x = store.incomes.find((i) => i.id === id)!;
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState(x.what), [amount, setAmount] = useState(String(x.amount)), [date, setDate] = useState(x.got_on), [src, setSrc] = useState(x.source);
  return (
    <>
      <div className="prow" style={{ gridTemplateColumns: '1fr auto' }}>
        <button className="nm" type="button" onClick={() => setOpen(true)}><span>{x.what}</span><small>{x.source} · {fmtDate(x.got_on)}</small></button>
        <span className="sum" style={{ color: 'var(--ok)' }}>+{money(x.amount)}</span>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)}>
        <h3>Доход</h3>
        <input className="field" value={what} onChange={(e) => setWhat(e.target.value)} />
        <div className="row"><label className="lbl">Сумма<input className="field" type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></label><label className="lbl">Дата<input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label></div>
        <div className="chips">{INCOME_SOURCES.map((c) => <Chip key={c} on={c === src} onClick={() => setSrc(c)}>{c}</Chip>)}</div>
        <div className="row">
          <button className="btn primary" type="button" onClick={async () => { await store.update('incomes', { id }, { what, amount: Number(amount) || x.amount, got_on: date, source: src }); setOpen(false); }}>Сохранить</button>
          <span style={{ flex: 1 }} />
          <button className="btn ghost danger" type="button" onClick={async () => { await store.remove('incomes', { id }); setOpen(false); }}>Удалить</button>
        </div>
      </Sheet>
    </>
  );
}

export function Pay({ k }: { k: 'avans' | 'zp' | 'other' }) {
  const store = useStore();
  const { go } = useApp();
  const [ym] = useMonth();
  const { m, inc, save } = useMonthData(ym);
  const b = BLOCKS.find((x) => x.key === k)!;
  const rows = m?.plan[k] || [];
  const amount = k === 'other' ? inc.reduce((a, e) => a + Number(e.amount), 0) : m?.income[k] || 0;
  const [edit, setEdit] = useState<PlanRow | 'new' | null>(null);
  return (
    <>
      <Hero color="green" title={b.name + (b.day ? ` · ${blockDate(b, ym)}` : '')} onBack={() => go({ name: 'money' })}>
        {k === 'other' ? <div className="kv"><span>Премии и другие доходы месяца</span><b>{money(amount)}</b></div> : <>
          <div className="kv" style={{ alignItems: 'center' }}><span>Сумма выплаты</span>
            <input className="field num" type="number" inputMode="numeric" style={{ maxWidth: 160, textAlign: 'right', background: 'rgba(255,255,255,.6)' }} defaultValue={amount || ''} onBlur={(e) => save((c) => { c.income = { ...c.income, [k]: Number(e.target.value) || 0 }; })} />
          </div>
          <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={!!m?.got[k]} onChange={(e) => save((c) => { c.got = { ...c.got, [k]: e.target.checked }; })} style={{ width: 22, height: 22 }} />Деньги пришли</label>
        </>}
        <div className="kv"><span>Расписано</span><span>{money(sum(rows))}</span></div>
        <div className="kv"><span>Свободно</span><b style={amount - sum(rows) < 0 ? { color: 'var(--danger)' } : undefined}>{money(amount - sum(rows))}</b></div>
      </Hero>
      <div className="list-card" style={sc('green')}>
        {!rows.length && <div className="empty">Платежей нет. Добавь первый ниже.</div>}
        {rows.map((r) => (
          <div key={r.id} className={'prow' + (r.paid ? ' paid' : '')}>
            <input className="check" type="checkbox" checked={r.paid} aria-label={'Оплачено: ' + r.name} onChange={() => save((c) => { const x = (c.plan[k] || []).find((y) => y.id === r.id); if (x) x.paid = !x.paid; })} />
            <button className="nm" type="button" onClick={() => setEdit(r)}><span>{r.name}</span><small>{r.cat}</small></button>
            <span className="sum">{money(r.sum)}</span>
          </div>
        ))}
      </div>
      <button className="btn" type="button" style={{ background: 'var(--surface)' }} onClick={() => setEdit('new')}>+ Платёж</button>
      {edit && <PayRowSheet key={edit === 'new' ? 'new' : edit.id} row={edit === 'new' ? null : edit} cats={store.settings.planCats?.length ? store.settings.planCats : DEFAULT_PLAN_CATS} onClose={() => setEdit(null)}
        onSave={(r) => save((c) => { const list = c.plan[k] || []; const i = list.findIndex((y) => y.id === r.id); if (i >= 0) list[i] = r; else list.push(r); c.plan = { ...c.plan, [k]: list }; })}
        onDelete={(id) => save((c) => { c.plan = { ...c.plan, [k]: (c.plan[k] || []).filter((y) => y.id !== id) }; })} />}
    </>
  );
}

function PayRowSheet({ row, cats, onClose, onSave, onDelete }: { row: PlanRow | null; cats: string[]; onClose: () => void; onSave: (r: PlanRow) => void; onDelete: (id: string) => void }) {
  const [name, setName] = useState(row?.name || ''), [s, setS] = useState(row ? String(row.sum) : ''), [cat, setCat] = useState(row?.cat || cats[0]);
  return (
    <Sheet open onClose={onClose}>
      <h3>{row ? 'Платёж' : 'Новый платёж'}</h3>
      <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, СГК" />
      <input className="field num" type="number" inputMode="numeric" value={s} onChange={(e) => setS(e.target.value)} placeholder="Сумма" />
      <div className="chips">{cats.map((c) => <Chip key={c} on={c === cat} onClick={() => setCat(c)}>{c}</Chip>)}</div>
      <div className="row">
        <button className="btn primary" type="button" onClick={() => { if (!name.trim() || !Number(s)) return; onSave({ id: row?.id || crypto.randomUUID(), name: name.trim(), sum: Number(s), cat, paid: row?.paid || false }); onClose(); }}>Сохранить</button>
        <span style={{ flex: 1 }} />
        {row && <button className="btn ghost danger" type="button" onClick={() => { onDelete(row.id); onClose(); }}>Удалить</button>}
      </div>
    </Sheet>
  );
}

export function Spend() {
  const store = useStore();
  const { go, openCapture } = useApp();
  const [ym] = useMonth();
  const { ex } = useMonthData(ym);
  const [edit, setEdit] = useState<Expense | null>(null);
  const wbLimit = store.settings.wbLimit ?? 12000;
  const wb = ex.filter((e) => e.wb).reduce((a, e) => a + Number(e.amount), 0);
  const spent = ex.reduce((a, e) => a + Number(e.amount), 0);
  const cats = catTotals(ex); const max = cats[0]?.[1] || 1;
  const byDay: Record<string, Expense[]> = {};
  for (const e of ex) (byDay[e.spent_on] = byDay[e.spent_on] || []).push(e);
  return (
    <>
      <div className="cal-head"><button className="ibtn" type="button" aria-label="Назад" onClick={() => go({ name: 'money' })}><Icon name="back" /></button><h1 className="h">Траты в {MON_PREP[ymMonth(ym)]}</h1></div>
      <div className="card" style={sc(wb > wbLimit ? 'red' : 'purple')}><div className="pay-h"><b>Вайлдберриз</b><small>{money(wb)} из {money(wbLimit)}</small></div><div className="bar"><i style={{ width: `${Math.min(100, Math.round((wb / wbLimit) * 100))}%` }} /></div></div>
      <div className="card">
        <div className="card-t"><span>По категориям</span><span>{money(spent)}</span></div>
        {!cats.length && <span className="muted">Пока пусто. Нажми «+» и скажи: «Лента 2300, такси 450».</span>}
        {cats.map(([c, v]) => <div key={c} className="catrow"><span>{c}</span><span className="sum">{money(v)}</span><div className="bar"><i style={{ width: `${Math.max(2, Math.round((v / max) * 100))}%` }} /></div></div>)}
      </div>
      {Object.keys(byDay).sort().reverse().map((day) => {
        const d = parseIso(day), list = byDay[day];
        return (
          <div key={day} className="list-card">
            <div className="day-h"><b>{cap1(fmtDate(day))}{['сегодня', 'вчера'].includes(fmtDate(day)) ? `, ${d.getDate()} ${MON[d.getMonth()]}` : `, ${WD_FULL[d.getDay()]}`}</b><span>{money(list.reduce((a, e) => a + Number(e.amount), 0))}</span></div>
            {list.map((e) => <div key={e.id} className="prow nobox"><button className="nm" type="button" onClick={() => setEdit(e)}><span>{e.what}{e.wb ? ' · ВБ' : ''}</span><small>{e.category}</small></button><span className="sum">{money(e.amount)}</span></div>)}
          </div>
        );
      })}
      <button className="btn" type="button" style={{ background: 'var(--surface)' }} onClick={() => openCapture(null)}><Icon name="mic" /> Надиктовать трату</button>
      {edit && <ExpenseSheet key={edit.id} e={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function ExpenseSheet({ e, onClose }: { e: Expense; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [what, setWhat] = useState(e.what), [amount, setAmount] = useState(String(e.amount)), [date, setDate] = useState(e.spent_on), [cat, setCat] = useState(e.category), [wb, setWb] = useState(e.wb);
  const cats = store.settings.spendCats?.length ? store.settings.spendCats : DEFAULT_SPEND_CATS;
  return (
    <Sheet open onClose={onClose}>
      <h3>Трата</h3>
      <input className="field" value={what} onChange={(x) => setWhat(x.target.value)} />
      <div className="row"><label className="lbl">Сумма<input className="field" type="number" inputMode="numeric" value={amount} onChange={(x) => setAmount(x.target.value)} /></label><label className="lbl">Дата<input className="field" type="date" value={date} onChange={(x) => setDate(x.target.value)} /></label></div>
      <div className="chips">{cats.map((c) => <Chip key={c} on={c === cat} onClick={() => setCat(c)}>{c}</Chip>)}<Chip on={wb} onClick={() => setWb(!wb)}>Вайлдберриз</Chip></div>
      <div className="row">
        <button className="btn primary" type="button" onClick={async () => { await store.update('expenses', { id: e.id }, { what, amount: Number(amount) || e.amount, spent_on: date, category: cat, wb }); onClose(); }}>Сохранить</button>
        <span style={{ flex: 1 }} />
        <button className="btn ghost danger" type="button" onClick={async () => { await store.remove('expenses', { id: e.id }); toast('Трата удалена'); onClose(); }}>Удалить</button>
      </div>
    </Sheet>
  );
}

const PRESETS = [['month', 'Этот месяц'], ['prev', 'Прошлый'], ['q', '3 месяца'], ['half', 'Полгода'], ['year', 'С начала года']] as const;
export function Stats() {
  const store = useStore();
  const { go } = useApp();
  const [preset, setPreset] = useState<(typeof PRESETS)[number][0]>('month');
  const [mode, setMode] = useState<'all' | 'spend' | 'plan'>('all');
  const [openCat, setOpenCat] = useState<string | null>(null);
  const cur = ymOf(new Date());
  const range: [string, string] = preset === 'prev' ? [ymShift(cur, -1), ymShift(cur, -1)] : preset === 'q' ? [ymShift(cur, -2), cur] : preset === 'half' ? [ymShift(cur, -5), cur] : preset === 'year' ? [`${cur.slice(0, 4)}-01`, cur] : [cur, cur];
  const months: string[] = []; for (let x = range[0]; x <= range[1]; x = ymShift(x, 1)) months.push(x);
  type Row = { cat: string; sum: number; what: string; when: string; month: string };
  const rows: Row[] = []; let unpaid = 0, invest = 0;
  if (mode !== 'plan') for (const e of store.expenses) if (months.includes(e.spent_on.slice(0, 7))) rows.push({ cat: e.category, sum: Number(e.amount), what: e.what + (e.wb ? ' · ВБ' : ''), when: fmtDate(e.spent_on), month: e.spent_on.slice(0, 7) });
  if (mode !== 'spend') for (const m of store.money_months) if (months.includes(m.ym)) for (const b of BLOCKS) for (const r of m.plan[b.key] || []) {
    if (r.cat === 'Инвестиции') { if (r.paid) invest += r.sum; continue; }
    if (r.paid) rows.push({ cat: r.cat, sum: r.sum, what: r.name, when: `${b.name.toLowerCase()}, ${MON_SHORT[ymMonth(m.ym)]}`, month: m.ym }); else unpaid += r.sum;
  }
  const total = rows.reduce((a, r) => a + r.sum, 0);
  const cats = Object.entries(rows.reduce<Record<string, Row[]>>((a, r) => { (a[r.cat] = a[r.cat] || []).push(r); return a; }, {})).map(([c, l]) => [c, l.reduce((a, r) => a + r.sum, 0), l] as const).sort((a, b) => b[1] - a[1]);
  let incomeGot = 0, expected = 0; const bySrc: Record<string, number> = {};
  for (const m of store.money_months) if (months.includes(m.ym)) for (const k of ['avans', 'zp'] as const) { const a = m.income[k] || 0; if (!a) continue; if (m.got[k]) { incomeGot += a; bySrc[k === 'avans' ? 'Аванс' : 'Зарплата'] = (bySrc[k === 'avans' ? 'Аванс' : 'Зарплата'] || 0) + a; } else expected += a; }
  for (const x of store.incomes) if (months.includes(x.got_on.slice(0, 7))) { incomeGot += Number(x.amount); bySrc[x.source] = (bySrc[x.source] || 0) + Number(x.amount); }
  const srcs = Object.entries(bySrc).sort((a, b) => b[1] - a[1]);
  const per = months.map((mm) => [mm, rows.filter((r) => r.month === mm).reduce((a, r) => a + r.sum, 0)] as const);
  const pmax = Math.max(1, ...per.map(([, v]) => v));
  return (
    <>
      <div className="cal-head"><button className="ibtn" type="button" aria-label="Назад" onClick={() => go({ name: 'money' })}><Icon name="back" /></button><h1 className="h">Итоги</h1></div>
      <div className="chips">{PRESETS.map(([k, t]) => <Chip key={k} on={preset === k} onClick={() => { setPreset(k); setOpenCat(null); }}>{t}</Chip>)}</div>
      <div className="seg seg3" style={{ background: 'var(--surface)' }}>{([['all', 'Всё'], ['spend', 'Траты'], ['plan', 'Платежи']] as const).map(([k, t]) => <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}>{t}</button>)}</div>
      <div className="card">
        <div className="card-t">{months.length === 1 ? ymTitle(months[0]) : `${MON_N[ymMonth(months[0])]} — ${ymTitle(months[months.length - 1])}`}</div>
        <div className="big-num">{money(total)}</div>
        {months.length > 1 && <div className="kv"><span>В среднем за месяц</span><span>{money(total / months.length)}</span></div>}
        {unpaid > 0 && <div className="kv"><span>Ещё не оплачено по плану</span><span>{money(unpaid)}</span></div>}
        {invest > 0 && <div className="kv"><span>Отложено в инвестиции (не в сумме)</span><span>{money(invest)}</span></div>}
      </div>
      {cats.length > 0 && (
        <div className="card">
          <div className="card-t"><span>Куда ушло больше всего</span><span>{cats.length} {plural(cats.length, 'категория', 'категории', 'категорий')}</span></div>
          {cats.map(([c, v, list], i) => (
            <div key={c}>
              <button className="srow" type="button" aria-expanded={openCat === c} onClick={() => setOpenCat(openCat === c ? null : c)}>
                <span className="sname"><span className="rk">{i + 1}</span>{c}</span>
                <span className="sval">{money(v)}<small> · {v / total < 0.01 ? '<1' : Math.round((v / total) * 100)}%</small></span>
                <span className="sbar"><i style={{ width: `${Math.max(1.5, (v / cats[0][1]) * 100)}%` }} /></span>
              </button>
              {openCat === c && <div className="sdetail">{[...list].sort((a, b) => b.sum - a.sum).slice(0, 12).map((r, j) => <div key={j} className="kv" style={{ fontSize: 14.5 }}><span>{r.what} · {r.when}</span><span>{money(r.sum)}</span></div>)}</div>}
            </div>
          ))}
        </div>
      )}
      {months.length > 1 && (
        <div className="card"><div className="card-t">По месяцам, ₽</div>
          <div className="cols">{per.map(([mm, v], i) => <div key={mm} className="col-m" title={`${ymTitle(mm)}: ${money(v)}`}><span className="cv">{v === pmax || i === per.length - 1 ? money(v).replace(' ₽', '') : ''}</span><span className="cb"><i style={{ height: `${v ? Math.max(3, (v / pmax) * 100) : 0}%` }} /></span><span className="cl">{MON_SHORT[ymMonth(mm)]}</span></div>)}</div>
        </div>
      )}
      <div className="card">
        <div className="card-t"><span>Доходы</span><span>{money(incomeGot)}</span></div>
        {!srcs.length && <span className="muted">Полученных доходов пока нет. Аванс и зарплата считаются, когда отмечены «пришло».</span>}
        {srcs.map(([c, v]) => <div key={c} className="srow" style={{ cursor: 'default' }}><span className="sname">{c}</span><span className="sval">{money(v)}</span><span className="sbar"><i style={{ width: `${Math.max(1.5, (v / srcs[0][1]) * 100)}%`, background: 'var(--c-green)' }} /></span></div>)}
        {expected > 0 && <div className="kv"><span>Ещё ожидается аванс и зарплата</span><span>{money(expected)}</span></div>}
        {mode === 'all' && <div className="kv" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}><span>Доходы минус расходы и отложенное</span><b style={{ color: incomeGot - total - invest < 0 ? 'var(--danger)' : 'var(--ok)' }}>{incomeGot - total - invest >= 0 ? '+' : ''}{money(incomeGot - total - invest)}</b></div>}
      </div>
      <p className="sync">Сегодня {todayIso()}</p>
    </>
  );
}
