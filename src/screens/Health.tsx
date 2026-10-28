// Ежедневный чек-лист здоровья: витамины, вода, сон. Сверху на «Сегодня» и в сфере «Здоровье» с сеткой месяца.
// Напоминание — ежедневное повторяющееся событие в Google Календаре: приходит уведомлением, как обычная встреча.
import { useState } from 'react';
import { useStore } from '../lib/store';
import { useApp } from '../lib/context';
import { callFn } from '../lib/supabase';
import { createCalendarEvent, markHealth } from '../lib/actions';
import { addDays, iso, MON_N, parseIso, todayIso } from '../lib/dates';
import { DEFAULT_HEALTH, type HealthItem } from '../lib/types';
import { CHECK, Sheet, useToast } from '../components/ui';

function useHealth() {
  const store = useStore();
  const items = store.settings.health ?? DEFAULT_HEALTH;
  const value = (id: string, day = todayIso()) => store.health_log.find((x) => x.day === day && x.item_id === id)?.value || 0;
  const done = (h: HealthItem, day = todayIso()) => (h.kind === 'count' ? value(h.id, day) >= (h.target || 1) : value(h.id, day) > 0);
  return { store, items, value, done };
}

function HealthButtons() {
  const { store, items, value, done } = useHealth();
  return (
    <div className="hitems">
      {items.map((h) => {
        const v = value(h.id), on = done(h);
        if (h.kind === 'count') return (
          <span key={h.id} className={'hit' + (on ? ' on' : '')}>
            <button type="button" className="minus" aria-label={`Убрать: ${h.name}`} disabled={!v} onClick={() => markHealth(store, h.id, Math.max(0, v - 1))}>−</button>
            <button type="button" style={{ border: 0, background: 'none', color: 'inherit', padding: 0, font: 'inherit' }} aria-label={`Добавить: ${h.name}`} onClick={() => markHealth(store, h.id, v + 1)}>
              {h.name} <span className="cnt">{v}/{h.target || 1}</span>
            </button>
          </span>
        );
        return <button key={h.id} type="button" className={'hit' + (on ? ' on' : '')} aria-pressed={on} onClick={() => markHealth(store, h.id, on ? 0 : 1)}><span className="box">{on ? CHECK : null}</span>{h.name}</button>;
      })}
    </div>
  );
}

/** Полоска на «Сегодня». */
export function HealthStrip() {
  const { store, items, done } = useHealth();
  const { go } = useApp();
  if (!items.length) return null;
  const n = items.filter((h) => done(h)).length;
  const area = store.areas.find((a) => /здоров/i.test(a.name));
  return (
    <div className="health">
      <div className="health-h"><b>Здоровье сегодня</b>{area ? <button className="btn ghost small" type="button" style={{ padding: 0 }} onClick={() => go({ name: 'area', id: area.id })}>{n} из {items.length} ›</button> : <span>{n} из {items.length}</span>}</div>
      <HealthButtons />
    </div>
  );
}

/** Карточка в сфере «Здоровье»: отметки за сегодня, сетка месяца, настройка пунктов. */
export function HealthCard() {
  const { items, done } = useHealth();
  const [edit, setEdit] = useState(false);
  const t = parseIso(todayIso());
  const first = new Date(t.getFullYear(), t.getMonth(), 1);
  const days = Array.from({ length: new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate() }, (_, i) => iso(addDays(first, i)));
  const lead = (first.getDay() + 6) % 7;
  const today = todayIso();
  return (
    <div className="health">
      <div className="health-h"><b>Каждый день</b><button className="btn ghost small" type="button" style={{ padding: 0 }} onClick={() => setEdit(true)}>Настроить</button></div>
      <HealthButtons />
      {items.length > 0 && <>
        <span className="mini">{MON_N[t.getMonth()]}: тёмные дни — всё отмечено</span>
        <div className="hgrid">
          {Array.from({ length: lead }, (_, i) => <span key={'x' + i} style={{ background: 'none' }} />)}
          {days.map((d) => {
            const n = items.filter((h) => done(h, d)).length;
            return <span key={d} className={d > today ? 'future' : n === items.length ? 'full' : n ? 'part' : ''} title={`${parseIso(d).getDate()}: ${n} из ${items.length}`}>{parseIso(d).getDate()}</span>;
          })}
        </div>
      </>}
      <HealthSettings open={edit} onClose={() => setEdit(false)} />
    </div>
  );
}

function HealthSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [list, setList] = useState<HealthItem[]>(() => (store.settings.health ?? DEFAULT_HEALTH).map((h) => ({ ...h })));
  const [busy, setBusy] = useState(false);
  const patch = (i: number, p: Partial<HealthItem>) => setList((l) => l.map((h, j) => (j === i ? { ...h, ...p } : h)));
  const save = async () => {
    setBusy(true);
    const before = store.settings.health ?? DEFAULT_HEALTH;
    const out: HealthItem[] = [];
    const problems: string[] = [];
    for (const h of list.filter((x) => x.name.trim())) {
      const old = before.find((x) => x.id === h.id);
      let gcal_id = old?.gcal_id;
      // Напоминание поменялось — старое событие удаляем, новое создаём.
      if (old?.gcal_id && (old.time !== h.time || old.name !== h.name)) { await callFn('gcal', { action: 'delete', id: old.gcal_id }).catch(() => {}); gcal_id = undefined; }
      if (h.time && !gcal_id) {
        try { gcal_id = (await createCalendarEvent({ title: `💊 ${h.name}`, date: todayIso(), start: h.time, end: h.time, repeat: 'DAILY', remind: 'now', note: 'Напоминание из чек-листа здоровья' })).id; }
        catch (e) { problems.push(`${h.name}: ${(e as Error).message}`); }
      }
      out.push({ ...h, name: h.name.trim(), time: h.time || undefined, gcal_id });
    }
    for (const old of before) if (old.gcal_id && !out.some((h) => h.id === old.id)) await callFn('gcal', { action: 'delete', id: old.gcal_id }).catch(() => {});
    await store.saveSettings({ health: out });
    setBusy(false);
    toast(problems.length ? `Сохранено, но напоминание не создалось: ${problems.join('; ')}` : 'Чек-лист сохранён');
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <h3>Чек-лист на каждый день</h3>
      <span className="mini">Время напоминания создаст ежедневное событие в Google Календаре — уведомление придёт, как от обычной встречи.</span>
      {list.map((h, i) => (
        <div key={h.id} className="card" style={{ background: 'var(--field)', gap: 8, padding: 12 }}>
          <div className="row">
            <input className="field" style={{ background: 'var(--surface)', flex: 1 }} value={h.name} aria-label="Название" onChange={(e) => patch(i, { name: e.target.value })} />
            <button className="btn ghost danger" type="button" onClick={() => setList(list.filter((_, j) => j !== i))}>Убрать</button>
          </div>
          <div className="row">
            <select className="field" style={{ background: 'var(--surface)', width: 'auto' }} value={h.kind} aria-label="Как отмечать" onChange={(e) => patch(i, { kind: e.target.value as HealthItem['kind'] })}>
              <option value="check">галочка</option>
              <option value="count">счётчик</option>
            </select>
            {h.kind === 'count' && <label className="row mini" style={{ gap: 6 }}>цель<input className="field" style={{ background: 'var(--surface)', width: 70 }} type="number" inputMode="numeric" value={h.target || ''} onChange={(e) => patch(i, { target: Number(e.target.value) || 1 })} /></label>}
            <label className="row mini" style={{ gap: 6 }}>напомнить<input className="field" style={{ background: 'var(--surface)', width: 110 }} type="time" value={h.time || ''} onChange={(e) => patch(i, { time: e.target.value })} /></label>
          </div>
        </div>
      ))}
      <button className="btn" type="button" onClick={() => setList([...list, { id: crypto.randomUUID().slice(0, 8), name: '', kind: 'check' }])}>+ Пункт</button>
      <button className="btn primary" type="button" disabled={busy} onClick={save}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
    </Sheet>
  );
}
