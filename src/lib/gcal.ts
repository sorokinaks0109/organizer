// События Google Календаря: окно −45 дней … +год (чтобы были видны дни рождения и дальние события), обновляется при открытии и каждые 10 минут.
import { useCallback, useEffect, useState } from 'react';
import { callFn } from './supabase';
import { addDays, eventDay, eventTime, iso, todayIso } from './dates';
import type { Area, EventLink, GEvent, Project } from './types';

export type CalEvent = GEvent & { day: string; time: string; endTime: string };
const CACHE = 'org.gcal.v1';

export function useGoogleEvents(enabled: boolean) {
  const [events, setEvents] = useState<CalEvent[] | null>(() => { try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch { return null; } });
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const st = await callFn<{ connected: boolean }>('gcal', { action: 'status' });
      setConnected(st.connected);
      if (!st.connected) { setEvents([]); return; }
      const t0 = new Date(todayIso() + 'T00:00:00');
      const res = await callFn<{ events: GEvent[] }>('gcal', { action: 'list', from: addDays(t0, -45).toISOString(), to: addDays(t0, 370).toISOString() });
      // Ежедневные напоминания чек-листа здоровья («💊 Витамины») в ленте не нужны — они есть в самом чек-листе.
      const seen = new Set<string>();
      const list = res.events.filter((e) => !(e.fromOrganizer && e.title.startsWith('💊')) && !seen.has(e.id) && !!seen.add(e.id)).map((e) => ({ ...e, day: eventDay(e.start, e.allDay), time: eventTime(e.start, e.allDay), endTime: e.allDay ? '' : eventTime(e.end, false) }));
      // Событие на несколько дней показываем в каждом из них.
      const out: CalEvent[] = [];
      for (const e of list) {
        out.push(e);
        if (e.allDay && e.end) { for (let d = addDays(new Date(e.day + 'T00:00:00'), 1), i = 0; iso(d) < e.end.slice(0, 10) && i < 31; d = addDays(d, 1), i++) out.push({ ...e, day: iso(d) }); }
      }
      setEvents(out); setError(null);
      try { localStorage.setItem(CACHE, JSON.stringify(out)); } catch { /* кэш не обязателен */ }
    } catch (e) { setError((e as Error).message); }
  }, [enabled]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10 * 60 * 1000);
    const vis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [refresh]);

  return { events, error, connected, refresh };
}

export const isCancelled = (title: string) => /отмен/i.test(title);
export const SUB_NUM = /№\s*(\d+)\s*из\s*(\d+)/;

/** К какой сфере/проекту относится событие: ручная привязка → слова проекта → слова сферы. */
export function classify(e: { id: string; title: string }, links: EventLink[], areas: Area[], projects: Project[]): { area: string | null; project: string | null } {
  // у повторяющихся событий id экземпляра = id серии + «_дата»: привязка серии подходит всем её экземплярам
  const has = (x: EventLink) => !!(x.area_id || x.project_id);
  const l = links.find((x) => x.event_id === e.id && has(x)) || links.find((x) => e.id.startsWith(x.event_id + '_') && has(x));
  if (l) return { area: l.area_id ?? projects.find((p) => p.id === l.project_id)?.area_id ?? null, project: l.project_id };
  const t = e.title.toLowerCase();
  const p = projects.find((x) => !x.done && x.keywords.some((w) => w && t.includes(w.toLowerCase())));
  if (p) return { area: p.area_id, project: p.id };
  const a = areas.find((x) => x.keywords.some((w) => w && t.includes(w.toLowerCase())));
  return { area: a?.id ?? null, project: null };
}

/** id серии для повторяющегося события (для разового — сам id). */
export const seriesId = (e: { id: string; recurring: boolean }) => (e.recurring && e.id.includes('_') ? e.id.slice(0, e.id.indexOf('_')) : e.id);
