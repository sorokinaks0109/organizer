// Сохранение того, что разобрала нейросеть: дела, события в календарь, заметки, деньги, желания, здоровье.
import { callFn } from './supabase';
import { periodOf } from './money';
import { addIncome, monthOrNew, payRow } from './moneyActions';
import { DEFAULT_HEALTH, DEFAULT_SPEND_CATS, INCOME_SOURCES, type Parsed } from './types';
import { addDays, iso, MON_SHORT, parseIso, todayIso, WD_FULL } from './dates';
import type { CalEvent } from './gcal';
import type { useStore } from './store';

type Store = ReturnType<typeof useStore>;
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })();

/** Неоплаченные платежи текущего периода — чтобы «оплатила ТСЖ» отметило нужную строку. */
function openPayments(store: Store) {
  const p = periodOf(todayIso());
  return (monthOrNew(store, p.ym).plan[p.key] || []).filter((r) => !r.paid);
}

/** Подпись записи для сообщений: название дела, трата, платёж или пункт здоровья. */
export function parsedLabel(p: Parsed): string {
  return p.type === 'health' ? 'отметка здоровья' : p.type === 'paid' ? p.name : p.type === 'expense' || p.type === 'income' ? p.what
    : p.type === 'event_update' || p.type === 'event_delete' || p.type === 'task_update' ? p.was : p.title;
}
const shortDay = (d: string) => { const x = parseIso(d); return `${x.getDate()} ${MON_SHORT[x.getMonth()]}`; };

export async function parseVoice(text: string, store: Store, preferArea?: string | null, calendar: CalEvent[] = []): Promise<Parsed[]> {
  const { areas, projects, people, settings } = store;
  const d = new Date();
  const ordered = preferArea ? [...areas].sort((a, b) => (a.id === preferArea ? -1 : b.id === preferArea ? 1 : 0)) : areas;
  const health = settings.health ?? DEFAULT_HEALTH;
  const payments = openPayments(store);
  // Чтобы голосом можно было исправить уже существующее: ближайшие события и открытые дела.
  const from = iso(addDays(new Date(), -7)), to = iso(addDays(new Date(), 120));
  const evs = [...new Map(calendar.filter((e) => e.day >= from && e.day <= to).map((e) => [e.id, e])).values()].slice(0, 150);
  const openTasks = store.items.filter((t) => t.kind === 'task' && !t.done).slice(-120);
  const res = await callFn<{ items: Parsed[] }>('assistant', {
    text: preferArea ? `${text}\n\n(Записано внутри сферы «${areas.find((a) => a.id === preferArea)?.name}» — если не сказано иное, клади туда.)` : text,
    today: todayIso(), weekday: WD_FULL[d.getDay()],
    areas: ordered.map((a) => ({ id: a.id, name: a.name, keywords: a.keywords, projects: projects.filter((p) => p.area_id === a.id && !p.done).map((p) => ({ id: p.id, name: p.name })) })),
    people: people.map((p) => ({ id: p.id, name: p.name })),
    spendCats: settings.spendCats?.length ? settings.spendCats : DEFAULT_SPEND_CATS,
    incomeSources: INCOME_SOURCES,
    health: health.map((h) => ({ id: h.id, name: h.name, kind: h.kind })),
    payments: payments.map((r) => ({ id: r.id, name: r.name, sum: r.sum })),
    events: evs.map((e) => ({ id: e.id, title: e.title, date: e.day, time: e.time })),
    tasks: openTasks.map((t) => ({ id: t.id, title: t.title, date: t.due_date })),
  });
  const ids = new Set(areas.map((a) => a.id)), pids = new Set(projects.map((p) => p.id)), peopleIds = new Set(people.map((p) => p.id));
  const okD = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  // Траты и доходы не бывают в будущем: если нейросеть перенесла на них дату события — ставим сегодня.
  const pastD = (v: unknown) => { const x = okD(v); return x && x <= todayIso() ? x : null; };
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
    else if (t === 'expense' && Number(raw.amount) > 0) out.push({ type: 'expense', what: String(raw.what || 'Без названия'), amount: Math.round(Number(raw.amount)), category: String(raw.category || 'Прочее'), wb: !!raw.wb, date: pastD(raw.date) });
    else if (t === 'income' && Number(raw.amount) > 0) {
      const source = INCOME_SOURCES.includes(raw.source as string) ? (raw.source as string) : 'Прочее';
      const target = raw.target === 'reserve' || raw.target === 'wish' ? raw.target : source === 'Отпускные' ? 'reserve' : 'live';
      out.push({ type: 'income', what: String(raw.what || 'Доход'), amount: Math.round(Number(raw.amount)), source, date: pastD(raw.date), target, wish_id: null });
    } else if (t === 'wish') out.push({ type: 'wish', title: String(raw.title), area_id: area(raw.area_id), target_sum: Number(raw.target_sum) > 0 ? Math.round(Number(raw.target_sum)) : null });
    else if (t === 'paid') {
      const row = payments.find((r) => r.id === raw.row_id);
      if (row) out.push({ type: 'paid', row_id: row.id, name: row.name, amount: Number(raw.amount) > 0 ? Math.round(Number(raw.amount)) : row.sum });
    } else if (t === 'event_update' || t === 'event_delete') {
      const e = evs.find((x) => x.id === raw.event_id);
      if (!e) continue;
      const was = `${e.title} · ${shortDay(e.day)}${e.time ? ', ' + e.time : ''}`;
      if (t === 'event_delete') out.push({ type: 'event_delete', event_id: e.id, calendarId: e.calendarId, was });
      else {
        const u = { title: raw.title && raw.title !== e.title ? String(raw.title) : null, date: okD(raw.date) !== e.day ? okD(raw.date) : null, start: okT(raw.start) !== e.time ? okT(raw.start) : null, end: okT(raw.end) };
        if (u.title || u.date || u.start || u.end) out.push({ type: 'event_update', event_id: e.id, calendarId: e.calendarId, was, ...u });
      }
    } else if (t === 'task_update') {
      const it = openTasks.find((x) => x.id === raw.item_id);
      if (!it) continue;
      const u = { title: raw.title && raw.title !== it.title ? String(raw.title) : null, date: okD(raw.date), time: okT(raw.time), done: raw.done === true ? true : null };
      if (u.title || u.date || u.time || u.done) out.push({ type: 'task_update', item_id: it.id, was: it.title, ...u });
    } else if (t === 'health') {
      const h = health.find((x) => x.id === raw.item_id);
      if (h) out.push({ type: 'health', item_id: h.id, value: Math.max(1, Math.round(Number(raw.value) || 1)) });
    }
  }
  return out;
}

export async function createCalendarEvent(e: { title: string; date: string; start?: string | null; end?: string | null; repeat?: string | null; remind?: string | null; attendees?: string[]; note?: string }) {
  return callFn<{ id: string; link: string; calendarId: string }>('gcal', { action: 'create', event: { ...e, timeZone: TZ } });
}

/** Отметка чек-листа здоровья за день: галочка ставится, счётчик прибавляется. */
export async function markHealth(store: Store, item_id: string, value: number, day = todayIso()) {
  await store.upsert('health_log', { day, item_id, value }, ['day', 'item_id']);
}

/** Сохраняет разобранные записи. Возвращает текст для всплывающего сообщения. */
export async function saveParsed(list: Parsed[], store: Store): Promise<string> {
  let saved = 0; const problems: string[] = []; const done: string[] = [];
  const emails = (ids?: string[]) => (ids || []).map((id) => store.people.find((p) => p.id === id)?.email).filter((x): x is string => !!x);
  for (const p of list) {
    const before = saved;
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
        await store.insert('expenses', { what: p.what, amount: p.amount, category: p.category, wb: !!p.wb, spent_on: p.date || todayIso(), kind: 'spend' }); saved++;
      } else if (p.type === 'income') {
        await addIncome(store, { what: p.what, amount: p.amount, source: p.source, got_on: p.date, target: p.target, wish_id: p.wish_id }); saved++;
      } else if (p.type === 'wish') {
        await store.insert('wishes', { title: p.title, area_id: p.area_id, target_sum: p.target_sum }); saved++;
      } else if (p.type === 'paid') {
        const per = periodOf(todayIso());
        const row = (monthOrNew(store, per.ym).plan[per.key] || []).find((r) => r.id === p.row_id);
        if (row && !row.paid) { await payRow(store, per, row, p.amount); saved++; }
      } else if (p.type === 'event_update') {
        await callFn('gcal', { action: 'update', id: p.event_id, calendarId: p.calendarId, timeZone: TZ, changes: { title: p.title, date: p.date, start: p.start, end: p.end } }); saved++;
      } else if (p.type === 'event_delete') {
        await callFn('gcal', { action: 'delete', id: p.event_id, calendarId: p.calendarId });
        await store.remove('event_links', { event_id: p.event_id }); saved++;
      } else if (p.type === 'task_update') {
        await store.update('items', { id: p.item_id }, {
          ...(p.title ? { title: p.title } : {}), ...(p.date ? { due_date: p.date } : {}), ...(p.time ? { due_time: p.time } : {}),
          ...(p.done ? { done: true, done_at: new Date().toISOString() } : {}),
        }); saved++;
      } else if (p.type === 'health') {
        const h = (store.settings.health ?? DEFAULT_HEALTH).find((x) => x.id === p.item_id);
        const cur = store.health_log.find((x) => x.day === todayIso() && x.item_id === p.item_id)?.value || 0;
        await markHealth(store, p.item_id, h?.kind === 'count' ? cur + p.value : 1); saved++;
      }
      if (saved > before) done.push(p.type === 'expense' ? `трата ${p.amount} ₽` : p.type === 'income' ? `доход ${p.amount} ₽` : p.type === 'event' ? 'событие в календарь' : p.type === 'paid' ? `оплачено: ${p.name}` : p.type === 'health' ? 'отметка здоровья' : p.type === 'note' ? 'заметка' : p.type === 'wish' ? 'желание' : p.type === 'event_update' ? 'событие изменено' : p.type === 'event_delete' ? 'событие удалено' : p.type === 'task_update' ? (p.done ? 'дело сделано' : 'дело изменено') : 'дело');
    } catch (e) { problems.push(`${parsedLabel(p)}: ${(e as Error).message}`); }
  }
  const ok = done.length ? `Сохранено: ${done.join(', ')}` : 'Ничего не сохранено';
  return problems.length ? `${ok}. Не вышло: ${problems.join('; ')}` : ok;
}
