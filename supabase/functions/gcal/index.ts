// Прямая связь с Google Календарём: вход через Google, чтение событий, создание и переименование.
// Токены Google лежат только в таблице google_tokens, браузер их не видит.
import { adminClient, handle, json, requireUser, HttpError } from '../_shared/common.ts';

const SCOPES = 'openid email https://www.googleapis.com/auth/calendar';
const API = 'https://www.googleapis.com/calendar/v3';

function redirectUri(): string {
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/gcal`;
}
function clientCreds() {
  const id = Deno.env.get('GOOGLE_CLIENT_ID'), secret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!id || !secret) throw new HttpError(500, 'Не заданы GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET');
  return { id, secret };
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const data = await res.json();
  if (!res.ok) throw new HttpError(res.status === 400 ? 409 : 502, data.error === 'invalid_grant' ? 'Доступ к Google Календарю отозван или устарел. Подключите календарь заново в настройках.' : `Google: ${data.error_description || data.error}`);
  return data as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string };
}

/** Действующий токен доступа: берём сохранённый или обновляем по refresh_token. */
async function accessToken(userId: string): Promise<string> {
  const db = adminClient();
  const { data } = await db.from('google_tokens').select('*').eq('user_id', userId).maybeSingle();
  if (!data) throw new HttpError(409, 'Google Календарь не подключён. Подключите его в настройках.');
  if (data.access_token && data.expires_at && new Date(data.expires_at).getTime() > Date.now() + 60_000) return data.access_token;
  const { id, secret } = clientCreds();
  const t = await tokenRequest({ client_id: id, client_secret: secret, refresh_token: data.refresh_token, grant_type: 'refresh_token' });
  await db.from('google_tokens').update({ access_token: t.access_token, expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() }).eq('user_id', userId);
  return t.access_token;
}

async function gapi(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new HttpError(res.status === 401 ? 409 : 502, `Google Календарь: ${data?.error?.message || res.status}`);
  return data;
}

type GEvent = {
  id: string; status?: string; summary?: string; description?: string; htmlLink?: string;
  start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string };
  attendees?: { email?: string }[]; recurringEventId?: string;
};

function normalize(e: GEvent, calendarId: string, family: boolean) {
  return {
    id: e.id, calendarId, family, title: e.summary || '(без названия)', link: e.htmlLink || '',
    start: e.start?.dateTime || e.start?.date || '', end: e.end?.dateTime || e.end?.date || '',
    allDay: !!e.start?.date, attendees: (e.attendees || []).map((a) => (a.email || '').toLowerCase()).filter(Boolean),
    fromOrganizer: (e.description || '').includes('Из Органайзера'), recurring: !!e.recurringEventId,
  };
}

async function listRange(token: string, calendarId: string, from: string, to: string, q?: string) {
  const out: GEvent[] = [];
  let pageToken = '';
  for (let i = 0; i < 12; i++) {
    const p = new URLSearchParams({ timeMin: from, timeMax: to, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
    if (q) p.set('q', q);
    if (pageToken) p.set('pageToken', pageToken);
    const data = await gapi(token, `/calendars/${encodeURIComponent(calendarId)}/events?${p}`);
    out.push(...(data.items || []));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out.filter((e) => e.status !== 'cancelled');
}


/** Дата и время без часовых поясов: «2026-12-29», «19:00» ± минуты. */
function shiftLocal(date: string, time: string, minutes: number): { date: string; time: string } {
  const [y, m, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d, h, mi + minutes));
  return { date: x.toISOString().slice(0, 10), time: x.toISOString().slice(11, 16) };
}
const plusDays = (date: string, n: number) => shiftLocal(date, '00:00', n * 1440).date;

async function familyCalendarId(userId: string): Promise<string | null> {
  const { data } = await adminClient().from('settings').select('data').eq('user_id', userId).maybeSingle();
  return (data?.data as { familyCalendarId?: string } | undefined)?.familyCalendarId || null;
}

// Возврат из Google после входа: GET /gcal?code=…&state=…
async function oauthCallback(url: URL): Promise<Response> {
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  const db = adminClient();
  const { data: st } = await db.from('oauth_states').select('*').eq('state', state || '').maybeSingle();
  if (!code || !st) return new Response('Ссылка устарела. Вернитесь в органайзер и нажмите «Подключить» ещё раз.', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const { id, secret } = clientCreds();
  const t = await tokenRequest({ code, client_id: id, client_secret: secret, redirect_uri: redirectUri(), grant_type: 'authorization_code' });
  await db.from('oauth_states').delete().eq('state', state);
  let email: string | null = null;
  if (t.id_token) { try { email = JSON.parse(atob(t.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email ?? null; } catch { /* имя почты не обязательно */ } }
  const row: Record<string, unknown> = { user_id: st.user_id, access_token: t.access_token, expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), email, updated_at: new Date().toISOString() };
  if (t.refresh_token) row.refresh_token = t.refresh_token;
  const { data: existing } = await db.from('google_tokens').select('user_id').eq('user_id', st.user_id).maybeSingle();
  if (!t.refresh_token && !existing) return new Response('Google не выдал постоянный доступ. Удалите доступ приложения в myaccount.google.com/permissions и подключите снова.', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (existing) await db.from('google_tokens').update(row).eq('user_id', st.user_id);
  else await db.from('google_tokens').insert(row);
  const back = st.return_to || '/';
  return new Response(null, { status: 302, headers: { Location: `${back}${back.includes('?') ? '&' : '?'}google=ok` } });
}

Deno.serve(handle(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    // Ошибку входа показываем в самом приложении, а не страницей с кодом.
    try { return await oauthCallback(url); }
    catch (e) {
      const st = url.searchParams.get('state');
      const { data } = st ? await adminClient().from('oauth_states').select('return_to').eq('state', st).maybeSingle() : { data: null };
      const back = data?.return_to || Deno.env.get('APP_URL') || '';
      const msg = encodeURIComponent((e as Error).message || 'Не получилось подключить Google Календарь');
      if (back) return new Response(null, { status: 302, headers: { Location: `${back}${back.includes('?') ? '&' : '?'}google=error&reason=${msg}` } });
      return new Response(`Не получилось подключить Google Календарь: ${(e as Error).message}`, { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  }
  const userId = await requireUser(req);
  const body = await req.json();
  const db = adminClient();

  switch (body.action) {
    case 'status': {
      const { data } = await db.from('google_tokens').select('email').eq('user_id', userId).maybeSingle();
      return json({ connected: !!data, email: data?.email ?? null });
    }
    case 'auth_url': {
      const { id } = clientCreds();
      const state = crypto.randomUUID();
      await db.from('oauth_states').insert({ state, user_id: userId, return_to: body.return_to || null });
      const p = new URLSearchParams({ client_id: id, redirect_uri: redirectUri(), response_type: 'code', scope: SCOPES, access_type: 'offline', prompt: 'consent', state });
      return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${p}` });
    }
    case 'disconnect': {
      await db.from('google_tokens').delete().eq('user_id', userId);
      return json({ ok: true });
    }
    case 'calendars': {
      const token = await accessToken(userId);
      const data = await gapi(token, '/users/me/calendarList?maxResults=100');
      return json({ calendars: (data.items || []).map((c: { id: string; summary: string; primary?: boolean }) => ({ id: c.id, name: c.summary, primary: !!c.primary })) });
    }
    case 'list': {
      const token = await accessToken(userId);
      // Все календари, которые включены в самом Google Календаре (кроме праздников): основной, «Семья» и другие.
      // «Семья» — выбранный в Настройках, а если не выбран — календарь с таким названием.
      const cals = ((await gapi(token, '/users/me/calendarList?maxResults=100')).items || []) as { id: string; summary?: string; primary?: boolean; selected?: boolean; hidden?: boolean }[];
      const fam = (await familyCalendarId(userId)) || cals.find((c) => /^семья$/i.test((c.summary || '').trim()))?.id || null;
      const use = cals.filter((c) => !c.primary && !c.hidden && (c.selected || c.id === fam) && !c.id.includes('#holiday@'));
      const [own, ...others] = await Promise.all([
        listRange(token, 'primary', body.from, body.to, body.q),
        ...use.map((c) => listRange(token, c.id, body.from, body.to, body.q).catch(() => [] as GEvent[])),
      ]);
      return json({ events: [...own.map((e) => normalize(e, 'primary', false)), ...others.flatMap((list, i) => list.map((e) => normalize(e, use[i].id, use[i].id === fam)))] });
    }
    case 'create': {
      const token = await accessToken(userId);
      const e = body.event as { title: string; date: string; start?: string | null; end?: string | null; repeat?: string | null; remind?: string | null; attendees?: string[]; timeZone?: string; family?: boolean; note?: string };
      const tz = e.timeZone || 'Europe/Moscow';
      let start: Record<string, string>, end: Record<string, string>;
      if (e.start) {
        const [h, m] = e.start.split(':').map(Number);
        const endT = e.end && e.end > e.start ? e.end : `${String(Math.min(h + 1, 23)).padStart(2, '0')}:${String(h >= 23 ? 59 : m).padStart(2, '0')}`;
        start = { dateTime: `${e.date}T${e.start}:00`, timeZone: tz };
        end = { dateTime: `${e.date}T${endT}:00`, timeZone: tz };
      } else {
        const next = new Date(`${e.date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
        start = { date: e.date }; end = { date: next.toISOString().slice(0, 10) };
      }
      const allDay = !e.start;
      const reminders = e.remind === 'none' ? { useDefault: false, overrides: [] }
        : e.remind ? { useDefault: false, overrides: [{ method: 'popup', minutes: allDay ? { hour: 900, day: 900, week: 6 * 1440 + 900 }[e.remind] ?? 900 : { now: 0, hour: 60, day: 1440, week: 10080 }[e.remind] ?? 60 }] }
        : undefined;
      const fam = e.attendees?.length ? await familyCalendarId(userId) : null;
      const calendarId = fam || 'primary';
      const payload: Record<string, unknown> = {
        summary: e.title, start, end, description: `${e.note ? e.note + '\n' : ''}Из Органайзера`,
        ...(allDay ? { transparency: 'transparent' } : {}),
        ...(e.repeat ? { recurrence: [`RRULE:FREQ=${e.repeat}`] } : {}),
        ...(reminders ? { reminders } : {}),
        ...(e.attendees?.length ? { attendees: e.attendees.map((email) => ({ email })) } : {}),
      };
      const created = await gapi(token, `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${e.attendees?.length ? 'all' : 'none'}`, { method: 'POST', body: JSON.stringify(payload) });
      return json({ id: created.id, link: created.htmlLink, calendarId });
    }
    case 'update': {
      // Изменить существующее событие: название, день, время. Остальное (напоминания, участники) не трогаем.
      const token = await accessToken(userId);
      const cal = body.calendarId || 'primary';
      const path = `/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(body.id)}`;
      const cur = await gapi(token, path) as GEvent & { start: { date?: string; dateTime?: string; timeZone?: string }; end: { date?: string; dateTime?: string } };
      const ch = (body.changes || {}) as { title?: string | null; date?: string | null; start?: string | null; end?: string | null };
      const tz = body.timeZone || cur.start?.timeZone || 'Europe/Moscow';
      const patch: Record<string, unknown> = {};
      if (ch.title) patch.summary = ch.title;
      if (ch.date || ch.start || ch.end) {
        if (cur.start?.date && !ch.start) {
          const days = Math.max(1, Math.round((Date.parse(cur.end.date!) - Date.parse(cur.start.date)) / 864e5));
          const d = ch.date || cur.start.date;
          patch.start = { date: d }; patch.end = { date: plusDays(d, days) };
        } else {
          const curDate = cur.start?.dateTime?.slice(0, 10) || cur.start?.date || ch.date!;
          const curTime = cur.start?.dateTime?.slice(11, 16) || '10:00';
          const dur = cur.start?.dateTime && cur.end?.dateTime ? Math.max(15, Math.round((Date.parse(cur.end.dateTime) - Date.parse(cur.start.dateTime)) / 60000)) : 60;
          const d = ch.date || curDate, t = ch.start || curTime;
          const e = ch.end && ch.end > t ? { date: d, time: ch.end } : shiftLocal(d, t, dur);
          patch.start = { dateTime: `${d}T${t}:00`, timeZone: tz };
          patch.end = { dateTime: `${e.date}T${e.time}:00`, timeZone: tz };
        }
      }
      if (!Object.keys(patch).length) return json({ ok: true });
      await gapi(token, `${path}?sendUpdates=${cur.attendees?.length ? 'all' : 'none'}`, { method: 'PATCH', body: JSON.stringify(patch) });
      return json({ ok: true });
    }
    case 'delete': {
      const token = await accessToken(userId);
      await gapi(token, `/calendars/${encodeURIComponent(body.calendarId || 'primary')}/events/${encodeURIComponent(body.id)}?sendUpdates=none`, { method: 'DELETE' }).catch((e) => {
        // Событие уже удалено в самом календаре — это не ошибка.
        if (!/404|410|deleted|not found/i.test(String(e?.message))) throw e;
      });
      return json({ ok: true });
    }
    case 'rename': {
      const token = await accessToken(userId);
      await gapi(token, `/calendars/${encodeURIComponent(body.calendarId || 'primary')}/events/${encodeURIComponent(body.id)}?sendUpdates=none`, { method: 'PATCH', body: JSON.stringify({ summary: body.summary }) });
      return json({ ok: true });
    }
    default:
      throw new HttpError(400, 'Неизвестное действие');
  }
}));

