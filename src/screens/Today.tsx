// «Сегодня»: полоса недели, чек-лист здоровья, лента дня (дела + события календаря + выплаты), плитки сфер.
import { useRef, useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { useApp } from '../lib/context';
import { classify, isCancelled, SUB_NUM } from '../lib/gcal';
import { addDays, cap1, greeting, iso, MON, money, parseIso, plural, todayIso, WD, WD_FULL } from '../lib/dates';
import { bounds, PAY, periodOf, summarize, type Period } from '../lib/money';
import { monthOrNew } from '../lib/moneyActions';
import type { Item } from '../lib/types';
import { CHECK, Icon, Sheet, sc, useToast } from '../components/ui';
import { TaskCard } from '../components/Rows';
import { Tiles } from './Areas';
import { HealthStrip } from './Health';
import { PayoutSheet } from './Money';

type Row = { key: string; node: ReactNode };

export function Today() {
  const store = useStore();
  const { events, gError, gConnected, openItem, openEvent, go } = useApp();
  const toast = useToast();
  const tKey = todayIso();
  const [day, setDay] = useState(tKey);
  const [payout, setPayout] = useState<Period | null>(null);
  const [undated, setUndated] = useState(false);
  const x0 = useRef<number | null>(null);

  const d = parseIso(day);
  const monday = addDays(d, -((d.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => iso(addDays(monday, i)));
  const shiftWeek = (n: number) => setDay(iso(addDays(d, n * 7)));
  const rel = Math.round((d.getTime() - parseIso(tKey).getTime()) / 864e5);
  const title = rel === 0 ? 'Сегодня' : rel === 1 ? 'Завтра' : rel === -1 ? 'Вчера' : `${cap1(WD_FULL[d.getDay()])}, ${d.getDate()} ${MON[d.getMonth()]}`;

  const areaOf = (id: string | null) => store.areas.find((a) => a.id === id);
  const tasksOn = (x: string) => store.items.filter((t) => t.kind === 'task' && t.due_date === x);
  const eventsOn = (x: string) => (events || []).filter((e) => e.day === x);
  const overdue = store.items.filter((t) => t.kind === 'task' && !t.done && t.due_date && t.due_date < tKey);
  const toggle = (t: Item) => store.update('items', { id: t.id }, t.done ? { done: false, done_at: null } : { done: true, done_at: new Date().toISOString() });

  const taskRow = (t: Item, late = false) => {
    const a = areaOf(t.area_id), p = store.projects.find((x) => x.id === t.project_id), due = t.due_date ? parseIso(t.due_date) : null;
    return (
      <div className={'tl' + (t.done ? ' done' : '')} style={sc(a?.color || 'gray')}>
        <span className={'tm' + (late ? ' late' : '')}>{late ? 'долг' : t.due_time || '—'}</span>
        <button type="button" className="mk" aria-label={(t.done ? 'Вернуть: ' : 'Сделано: ') + t.title} onClick={() => toggle(t)}>{t.done ? CHECK : null}</button>
        <button type="button" className="tx" onClick={() => openItem(t)}>
          <b>{t.title}</b>
          <small>{a?.name || 'Без сферы'}{p ? ` · ${p.name}` : ''}{late && due ? <span className="mut"> · было на {due.getDate()} {MON[due.getMonth()]}</span> : null}</small>
        </button>
      </div>
    );
  };

  const rows: Row[] = [];
  for (const t of tasksOn(day)) rows.push({ key: (t.done ? '3' : '1') + (t.due_time || '00:00'), node: taskRow(t) });
  if (day === tKey) for (const t of overdue) rows.push({ key: '0' + t.due_date, node: taskRow(t, true) });
  for (const e of eventsOn(day)) {
    const c = classify(e, store.event_links, store.areas, store.projects);
    const a = areaOf(c.area), cancel = isCancelled(e.title), num = e.title.match(SUB_NUM)?.[1];
    rows.push({ key: (cancel ? '3' : '1') + (e.time || '00:00'), node: (
      <div className={'tl' + (cancel ? ' cancel' : '')} style={sc(a?.color || 'gray')}>
        <span className="tm">{e.time || 'весь день'}</span>
        <span className="mk ev">{num || ''}</span>
        <button type="button" className="tx" onClick={() => openEvent(e)}><b>{e.title}</b><small>{a?.name || 'Календарь'}<span className="mut">{e.endTime ? ` · до ${e.endTime}` : ''} · календарь</span></small></button>
      </div>
    ) });
  }
  // День выплаты: подтвердить сумму, потом — перейти к платежам.
  const per = periodOf(day);
  if (bounds(per).start === day) {
    const s = summarize(monthOrNew(store, per.ym), per, store.expenses, store.incomes, tKey);
    rows.push({ key: '0', node: (
      <div className="tl">
        <span className="tm">выплата</span><span className="mk money">₽</span>
        <span className="tx">
          <b>{PAY[per.key].name} {money(s.expected)}{s.received ? ' пришёл' : ''}</b>
          <small><span className="mut">{s.rows.length} {plural(s.rows.length, 'платёж', 'платежа', 'платежей')} · осталось оплатить {money(s.left)}</span></small>
          {!s.received ? <button className="pill" type="button" onClick={() => setPayout(per)}>Пришёл? Подтвердить сумму</button>
            : s.left > 0 ? <button className="pill" type="button" onClick={() => go({ name: 'money' })}>Оплатить</button> : null}
        </span>
      </div>
    ) });
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));

  const openCount = tasksOn(day).filter((t) => !t.done).length + new Set(eventsOn(day).filter((e) => !isCancelled(e.title)).map((e) => e.id)).size + (day === tKey ? overdue.length : 0);
  const leftover = day === tKey ? [...overdue, ...tasksOn(tKey).filter((t) => !t.done)] : [];
  const moveAll = async () => {
    const tomorrow = iso(addDays(parseIso(tKey), 1));
    await Promise.all(leftover.map((t) => store.update('items', { id: t.id }, { due_date: tomorrow })));
    toast(`${leftover.length} ${plural(leftover.length, 'дело перенесено', 'дела перенесены', 'дел перенесено')} на завтра`);
  };
  const noDate = store.items.filter((t) => t.kind === 'task' && !t.done && !t.due_date);
  const busy = (x: string) => tasksOn(x).filter((t) => !t.done).length + new Set(eventsOn(x).filter((e) => !isCancelled(e.title)).map((e) => e.id)).size;

  return (
    <>
      <div className="topbar">
        <div className="hello">
          <span className="date">{cap1(WD_FULL[new Date().getDay()])}, {new Date().getDate()} {MON[new Date().getMonth()]}</span>
          <h1 className="h">{greeting()}</h1>
        </div>
        <button className="ibtn" type="button" aria-label="Настройки" style={{ background: 'var(--surface)' }} onClick={() => go({ name: 'settings' })}><Icon name="gear" /></button>
      </div>
      <HealthStrip />
      <div className="week-nav">
        <button className="ibtn" type="button" aria-label="Прошлая неделя" onClick={() => shiftWeek(-1)}><Icon name="back" /></button>
        <button className="btn ghost" type="button" style={{ padding: 0 }} onClick={() => setDay(tKey)}>{monday.getDate()} {MON[monday.getMonth()]} — {addDays(monday, 6).getDate()} {MON[addDays(monday, 6).getMonth()]}</button>
        <button className="ibtn" type="button" aria-label="Следующая неделя" onClick={() => shiftWeek(1)}><Icon name="next" /></button>
      </div>
      <div className="week" role="group" aria-label="Дни недели"
        onTouchStart={(e) => { x0.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { if (x0.current == null) return; const dx = e.changedTouches[0].clientX - x0.current; x0.current = null; if (Math.abs(dx) > 50) shiftWeek(dx < 0 ? 1 : -1); }}>
        {week.map((x) => (
          <button key={x} type="button" className={'wd' + (x === tKey ? ' today' : '')} aria-pressed={x === day} onClick={() => setDay(x)}>
            {WD[parseIso(x).getDay()]}<b>{parseIso(x).getDate()}</b><span className="dots">{Array.from({ length: Math.min(3, busy(x)) }, (_, i) => <i key={i} />)}</span>
          </button>
        ))}
      </div>
      <div className="daytitle">
        <b>{title}</b>
        <span>{openCount ? `${openCount} ${plural(openCount, 'дело', 'дела', 'дел')}` : rows.length ? 'всё сделано' : ''}</span>
      </div>
      <div className="timeline">
        {rows.map((r, i) => <div key={i} style={{ display: 'contents' }}>{r.node}</div>)}
        {!rows.length && <div className="empty">{events == null && gConnected !== false ? 'Загружаю календарь…' : 'Свободный день. Можно взять что-то из «Без срока».'}</div>}
      </div>
      {leftover.length > 0 && <button className="btn" type="button" style={{ background: 'var(--surface)' }} onClick={moveAll}>Перенести несделанное на завтра · {leftover.length}</button>}
      {gError ? <span className="mini">Календарь: {gError}</span>
        : gConnected === false ? <button className="btn ghost" type="button" style={{ alignSelf: 'flex-start', paddingInline: 0 }} onClick={() => go({ name: 'settings' })}>Подключить Google Календарь →</button> : null}
      {noDate.length > 0 && <button className="linkrow" type="button" onClick={() => setUndated(true)}><b>Без срока</b><span>{noDate.length} {plural(noDate.length, 'дело', 'дела', 'дел')} ›</span></button>}
      <Tiles />
      {payout && <PayoutSheet p={payout} onClose={() => setPayout(null)} />}
      <Sheet open={undated} onClose={() => setUndated(false)}>
        <h3>Без срока</h3>
        <div className="tlist">{noDate.map((t) => <TaskCard key={t.id} t={t} showArea />)}</div>
      </Sheet>
    </>
  );
}
