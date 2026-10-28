// Сохранение того, что разобрала нейросеть: дела, события в календарь, заметки, деньги, желания.
import { callFn } from './supabase';
import { todayIso, WD_FULL } from './dates';
import { DEFAULT_SPEND_CATS, INCOME_SOURCES, type Area, type Parsed, type Person, type Project, type Settings } from './types';
import type { useStore } from './store';

type Store = ReturnType<typeof useStore>;
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })();

export async function parseVoice(text: string, areas: Area[], projects: Project[], people: Person[], settings: Settings, preferArea?: string | null): Promise<Parsed[]> {
  const d = new Date();
  const ordered = preferArea ? [...areas].sort((a, b) => (a.id === preferArea ? -1 : b.id === preferArea ? 1 : 0)) : areas;
  const res = await callFn<{ items: Parsed[] }>('assistant', {
    text: preferArea ? `${text}\n\n(Записано внутри сферы «${areas.find((a) => a.id === preferArea)?.name}» — если не сказано иное, клади туда.)` : text,
    today: todayIso(), weekday: WD_FULL[d.getDay()],
    areas: ordered.map((a) => ({ id: a.id, name: a.name, keywords: a.keywords, projects: projects.filter((p) => p.area_id === a.id && !p.done).map((p) => ({ id: p.id, name: p.name })) })),
    people: people.map((p) => ({ id: p.id, name: p.name })),
    spendCats: settings.spendCats?.length ? settings.spendCats : DEFAULT_SPEND_CATS,
    incomeSources: INCOME_SOURCES,
  });
  const ids = new Set(areas.map((a) => a.id)), pids = new Set(projects.map((p) => p.id)), peopleIds = new Set(people.map((p) => p.id));
  const okD = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const okT = (v: unknown) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);
  const area = (v: unknown) => (typeof v === 'string' && ids.has(v) ? v : preferArea ?? null);
  const proj = (v: unknown) => (typeof v === 'string' && pids.has(v) ? v : null);
  const ppl = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && peopleIds.has(x)) : []);
  const out: Parsed[] = [];
  for (const raw of res.items as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw.type;
    if ((t === 'task' || t === 'note' || t === 'wish') && !raw.title) continue;
    if (t === 'task') out.push({ type: 'task', title: String(raw.title), area_id: area(raw.area_id), project_id: proj(raw.project_id), date: okD(raw.date), time: okT(raw.time), calendar: !!raw.calendar, people: ppl(raw.people), remind: (raw.remind as string) ?? null });
    else if (t === 'event' && raw.title && okD(raw.date)) out.push({ type: 'event', title: String(raw.title), area_id: area(raw.area_id), project_id: proj(raw.project_id), date: okD(raw.date)!, start: okT(raw.start), end: okT(raw.end), repeat: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(raw.repeat as string) ? (raw.repeat as string) : null, remind: ['hour', 'day', 'week', 'none'].includes(raw.remind as string) ? (raw.remind as string) : null, people: ppl(raw.people) });
    else if (t === 'note') out.push({ type: 'note', title: String(raw.title), area_id: area(raw.area_id), project_id: proj(raw.project_id) });
    else if (t === 'expense' && Number(raw.amount) > 0) out.push({ type: 'expense', what: String(raw.what || 'Без названия'), amount: Math.round(Number(raw.amount)), category: String(raw.category || 'Прочее'), wb: !!raw.wb, date: okD(raw.date) });
    else if (t === 'income' && Number(raw.amount) > 0) out.push({ type: 'income', what: String(raw.what || 'Доход'), amount: Math.round(Number(raw.amount)), source: INCOME_SOURCES.includes(raw.source as string) ? (raw.source as string) : 'Прочее', date: okD(raw.date) });
    else if (t === 'wish') out.push({ type: 'wish', title: String(raw.title), area_id: area(raw.area_id), target_sum: Number(raw.target_sum) > 0 ? Math.round(Number(raw.target_sum)) : null });
  }
  return out;
}

export async function createCalendarEvent(e: { title: string; date: string; start?: string | null; end?: string | null; repeat?: string | null; remind?: string | null; attendees?: string[]; note?: string }) {
  return callFn<{ id: string; link: string; calendarId: string }>('gcal', { action: 'create', event: { ...e, timeZone: TZ } });
}

/** Сохраняет разобранные записи. Возвращает текст для всплывающего сообщения. */
export async function saveParsed(list: Parsed[], store: Store): Promise<string> {
  let saved = 0; const problems: string[] = [];
  const emails = (ids?: string[]) => (ids || []).map((id) => store.people.find((p) => p.id === id)?.email).filter((x): x is string => !!x);
  for (const p of list) {
    try {
      if (p.type === 'task' || p.type === 'note') {
        const row = await store.insert('items', { kind: p.type, title: p.title, area_id: p.area_id, project_id: p.project_id, due_date: p.type === 'task' ? p.date : null, due_time: p.type === 'task' ? p.time : null });
        saved++;
        if (row && p.type === 'task' && p.date && (p.calendar || p.people?.length)) {
          const ev = await createCalendarEvent({ title: p.title, date: p.date, start: p.time, remind: p.remind, attendees: emails(p.people) });
          await store.update('items', { id: row.id }, { gcal_event_id: ev.id });
          await store.upsert('event_links', { event_id: ev.id, area_id: p.area_id, project_id: p.project_id });
        }
      } else if (p.type === 'event') {
        const ev = await createCalendarEvent({ title: p.title, date: p.date, start: p.start, end: p.end, repeat: p.repeat, remind: p.remind, attendees: emails(p.people) });
        await store.upsert('event_links', { event_id: ev.id, area_id: p.area_id, project_id: p.project_id });
        saved++;
      } else if (p.type === 'expense') {
        await store.insert('expenses', { what: p.what, amount: p.amount, category: p.category, wb: !!p.wb, spent_on: p.date || todayIso() }); saved++;
      } else if (p.type === 'income') {
        await store.insert('incomes', { what: p.what, amount: p.amount, source: p.source, got_on: p.date || todayIso() }); saved++;
      } else if (p.type === 'wish') {
        await store.insert('wishes', { title: p.title, area_id: p.area_id, target_sum: p.target_sum }); saved++;
      }
    } catch (e) { problems.push(`${'title' in p ? p.title : p.what}: ${(e as Error).message}`); }
  }
  return problems.length ? `Сохранено: ${saved}. Не вышло: ${problems.join('; ')}` : `Сохранено: ${saved}`;
}
