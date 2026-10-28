// «Сегодня»: один день за раз (стрелками или свайпом), дела + события календаря + выплаты. Ниже — сферы.
import { useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { useApp } from '../lib/context';
import { classify, isCancelled } from '../lib/gcal';
import { addDays, cap1, greeting, iso, MON, money, parseIso, plural, todayIso, WD_FULL, ymShift } from '../lib/dates';
import { Icon, sc } from '../components/ui';
import { Tiles } from './Areas';

export function Today() {
  const store = useStore();
  const { events, gError, gConnected, openItem, openEvent, go } = useApp();
  const [offset, setOffset] = useState(0);
  const x0 = useRef<number | null>(null);
  const tKey = todayIso();
  const day = iso(addDays(parseIso(tKey), offset)), d = parseIso(day);
  const title = offset === 0 ? 'Сегодня' : offset === 1 ? 'Завтра' : offset === -1 ? 'Вчера' : cap1(WD_FULL[d.getDay()]);
  const shift = (n: number) => setOffset((o) => Math.max(-30, Math.min(90, o + n)));

  type Row = { key: string; time: string; title: string; color: string; late?: boolean; onClick: () => void; ev?: boolean; cancel?: boolean };
  const rows: Row[] = [];
  for (const t of store.items) {
    if (t.kind !== 'task' || t.done || !t.due_date) continue;
    const a = store.areas.find((x) => x.id === t.area_id);
    if (t.due_date === day) rows.push({ key: '1' + (t.due_time || '99'), time: t.due_time || 'без времени', title: t.title, color: a?.color || 'gray', onClick: () => openItem(t) });
    else if (offset === 0 && t.due_date < tKey) rows.push({ key: '0', time: 'просрочено', title: t.title, color: a?.color || 'gray', late: true, onClick: () => openItem(t) });
  }
  for (const e of events || []) {
    if (e.day !== day) continue;
    const c = classify(e, store.event_links, store.areas, store.projects);
    rows.push({ key: '1' + (e.time || '00'), time: e.time || 'весь день', title: e.title, color: store.areas.find((x) => x.id === c.area)?.color || 'gray', ev: true, cancel: isCancelled(e.title), onClick: () => openEvent(e) });
  }
  // День аванса или зарплаты: что ещё не оплачено.
  for (const m of store.money_months) for (const [key, name, dd, sh] of [['avans', 'Аванс', 28, 0], ['zp', 'Зарплата', 13, 1]] as const) {
    const [y, mo] = ymShift(m.ym, sh).split('-').map(Number);
    if (iso(new Date(y, mo - 1, dd)) !== day) continue;
    const open = (m.plan[key] || []).filter((r) => !r.paid);
    if (open.length) rows.push({ key: '2', time: '', title: `${name}: ${open.length} ${plural(open.length, 'платёж', 'платежа', 'платежей')} на ${money(open.reduce((s, r) => s + r.sum, 0))}`, color: 'green', onClick: () => go({ name: 'pay', key }) });
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));

  return (
    <>
      <div className="topbar">
        <div className="hello">
          <span className="date">{cap1(WD_FULL[new Date().getDay()])}, {new Date().getDate()} {MON[new Date().getMonth()]}</span>
          <h1 className="h">{greeting()}</h1>
        </div>
        <button className="ibtn" type="button" aria-label="Настройки" style={{ background: 'var(--surface)' }} onClick={() => go({ name: 'settings' })}><Icon name="gear" /></button>
      </div>
      <div className="card daycard"
        onTouchStart={(e) => { x0.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { if (x0.current == null) return; const dx = e.changedTouches[0].clientX - x0.current; x0.current = null; if (Math.abs(dx) > 60) shift(dx < 0 ? 1 : -1); }}>
        <div className="day-nav">
          <button className="ibtn" type="button" aria-label="Предыдущий день" onClick={() => shift(-1)}><Icon name="back" /></button>
          <button className="day-title" type="button" onClick={() => setOffset(0)} title="Вернуться на сегодня">
            <b>{title}</b><small>{d.getDate()} {MON[d.getMonth()]}{Math.abs(offset) <= 1 ? ', ' + WD_FULL[d.getDay()] : ''}</small>
          </button>
          <button className="ibtn" type="button" aria-label="Следующий день" onClick={() => shift(1)}><Icon name="next" /></button>
        </div>
        <div className="day-list">
          {!rows.length && <span className="muted">{events == null && gConnected !== false ? 'Загружаю…' : offset === 0 ? 'На сегодня ничего нет.' : 'На этот день ничего нет.'}</span>}
          {rows.map((r, i) => (
            <div key={i} role="button" tabIndex={0} className={'today-it link' + (r.late ? ' late' : '') + (r.ev ? ' ev' : '') + (r.cancel ? ' cancel' : '')} style={sc(r.color)} onClick={r.onClick} onKeyDown={(e) => { if (e.key === 'Enter') r.onClick(); }}>
              <time>{r.time}</time><div className="tt"><span>{r.title}</span></div>
            </div>
          ))}
        </div>
        {gError ? <span className="mini">Календарь: {gError}</span>
          : gConnected === false ? <button className="btn ghost" type="button" style={{ alignSelf: 'flex-start', paddingInline: 0 }} onClick={() => go({ name: 'settings' })}>Подключить Google Календарь →</button>
          : rows.some((r) => r.ev) ? <span className="mini">С квадратиком — события Google Календаря. Нажми на тренировку, чтобы отметить, была ли.</span> : null}
      </div>
      <Tiles />
    </>
  );
}
