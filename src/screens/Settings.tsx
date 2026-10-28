// Настройки: Google Календарь, люди, деньги, выгрузка дел в документ, перенос из старого органайзера, выход.
import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { useApp } from '../lib/context';
import { callFn, supabase } from '../lib/supabase';
import { classify, isCancelled } from '../lib/gcal';
import { absDate, addDays, iso, todayIso } from '../lib/dates';
import { COLORS, type Color, type Person } from '../lib/types';
import { Hero, Icon, Sheet, useToast } from '../components/ui';

export function Settings() {
  const store = useStore();
  const { go, gConnected, refreshEvents } = useApp();
  const toast = useToast();
  const [gEmail, setGEmail] = useState<string | null>(null);
  const [cals, setCals] = useState<{ id: string; name: string; primary: boolean }[] | null>(null);
  const [person, setPerson] = useState<Person | 'new' | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [email, setEmail] = useState<string>('');

  useEffect(() => {
    supabase!.auth.getUser().then(({ data }) => setEmail(data.user?.email || ''));
    callFn<{ connected: boolean; email: string | null }>('gcal', { action: 'status' }).then((s) => setGEmail(s.email)).catch(() => {});
  }, []);
  useEffect(() => {
    if (gConnected) callFn<{ calendars: { id: string; name: string; primary: boolean }[] }>('gcal', { action: 'calendars' }).then((r) => setCals(r.calendars)).catch(() => setCals([]));
  }, [gConnected]);

  const connect = async () => {
    try {
      const back = location.origin + location.pathname;
      const r = await callFn<{ url: string }>('gcal', { action: 'auth_url', return_to: back });
      location.href = r.url;
    } catch (e) { toast((e as Error).message); }
  };
  const disconnect = async () => {
    await callFn('gcal', { action: 'disconnect' }).catch(() => {});
    await refreshEvents(); toast('Календарь отключён');
  };

  return (
    <>
      <Hero color="gray" title="Настройки" onBack={() => go({ name: 'today' })} />

      <div className="card">
        <div className="card-t">Google Календарь</div>
        {gConnected === null && <span className="muted">Проверяю…</span>}
        {gConnected === false && (
          <>
            <span>Календарь не подключён. После подключения события будут видны в органайзере по сферам и проектам, а голосом можно будет ставить новые.</span>
            <button className="btn primary" type="button" onClick={connect}>Подключить Google Календарь</button>
          </>
        )}
        {gConnected && (
          <>
            <span>Подключён{gEmail ? `: ${gEmail}` : ''}</span>
            <label className="lbl" style={{ flex: 'none' }}>Календарь «Семья» (туда идут события с Митей и Миланой)
              <select className="field" value={store.settings.familyCalendarId || ''} onChange={async (e) => { await store.saveSettings({ familyCalendarId: e.target.value || undefined }); refreshEvents(); }}>
                <option value="">— только мой календарь —</option>
                {(cals || []).filter((c) => !c.primary).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <div className="row">
              <button className="btn" type="button" onClick={() => { refreshEvents(); toast('Обновляю события'); }}>Обновить события</button>
              <button className="btn" type="button" onClick={connect}>Подключить заново</button>
              <button className="btn ghost danger" type="button" onClick={disconnect}>Отключить</button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-t"><span>Люди</span><button type="button" onClick={() => setPerson('new')}>+ добавить</button></div>
        <span className="mini">Скажешь «поставь мне и Мите…» — событие уйдёт в календарь «Семья», а Мите придёт приглашение на почту.</span>
        {store.people.map((p) => (
          <button key={p.id} className="srow" type="button" onClick={() => setPerson(p)}>
            <span className="sname">{p.name}</span>
            <span className="sval"><small>{p.email || 'почта не указана'}</small></span>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-t">Голос</div>
        <label className="toggle-row">
          <input type="checkbox" className="check" checked={!!store.settings.autoSave} onChange={(e) => store.saveSettings({ autoSave: e.target.checked })} />
          <span>Сохранять сразу, без проверки<br /><small className="mini">Если выключено — сначала покажу, что разобрала, и можно поправить.</small></span>
        </label>
      </div>

      <div className="card">
        <div className="card-t">Деньги</div>
        <label className="lbl" style={{ flex: 'none' }}>Лимит на Вайлдберриз в месяц, ₽
          <input className="field" type="number" inputMode="numeric" defaultValue={store.settings.wbLimit ?? 12000} onBlur={(e) => store.saveSettings({ wbLimit: Number(e.target.value) || 0 })} />
        </label>
      </div>

      <div className="card">
        <div className="card-t">Распечатать или отправить</div>
        <button className="btn" type="button" onClick={() => setExportOpen(true)}><Icon name="download" /> Выгрузить дела в документ</button>
      </div>

      <div className="card">
        <div className="card-t">Перенос из старого органайзера</div>
        <span className="mini">Файл organizer-import.json, который я подготовлю. Перенесёт сферы, дела, заметки, план платежей, траты и доходы. Повторно загружать не нужно — появятся дубли.</span>
        <ImportButton />
      </div>

      <div className="card">
        <div className="card-t">Вход</div>
        <span>{email}</span>
        <div className="row">
          <button className="btn" type="button" onClick={async () => { const p = prompt('Новый пароль (не короче 8 символов)'); if (!p) return; const { error } = await supabase!.auth.updateUser({ password: p }); toast(error ? error.message : 'Пароль изменён'); }}>Сменить пароль</button>
          <button className="btn ghost danger" type="button" onClick={async () => { await supabase!.auth.signOut(); try { localStorage.removeItem('org.cache.v2'); localStorage.removeItem('org.gcal.v1'); } catch { /* не страшно */ } location.reload(); }}>Выйти</button>
        </div>
      </div>

      <PersonSheet key={person === 'new' ? 'new' : person?.id ?? 'none'} person={person === 'new' ? null : person} open={!!person} onClose={() => setPerson(null)} />
      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  );
}

function PersonSheet({ person, open, onClose }: { person: Person | null; open: boolean; onClose: () => void }) {
  const store = useStore();
  const [name, setName] = useState(person?.name || '');
  const [mail, setMail] = useState(person?.email || '');
  const [color, setColor] = useState<Color>(person?.color || 'teal');
  const save = async () => {
    if (!name.trim()) return;
    const row = { name: name.trim(), email: mail.trim().toLowerCase() || null, color };
    if (person) await store.update('people', { id: person.id }, row); else await store.insert('people', { ...row, sort: store.people.length });
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <h3>{person ? person.name : 'Новый человек'}</h3>
      <label className="lbl" style={{ flex: 'none' }}>Имя, как ты его говоришь<input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Митя" /></label>
      <label className="lbl" style={{ flex: 'none' }}>Почта для приглашений<input className="field" type="email" value={mail} onChange={(e) => setMail(e.target.value)} placeholder="name@mail.ru" /></label>
      <div className="swatches">{COLORS.map((c) => <button key={c} type="button" className="swatch" style={{ ['--sc' as string]: `var(--c-${c})` }} aria-label={c} aria-pressed={c === color} onClick={() => setColor(c)} />)}</div>
      <div className="row">
        <button className="btn primary" type="button" onClick={save}>Сохранить</button>
        <span style={{ flex: 1 }} />
        {person && <button className="btn ghost danger" type="button" onClick={async () => { await store.remove('people', { id: person.id }); onClose(); }}>Удалить</button>}
      </div>
    </Sheet>
  );
}

/** Документ Word (.doc из HTML): открытые дела и события по сферам на выбранный срок. */
function ExportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const { events } = useApp();
  const toast = useToast();
  const [days, setDays] = useState(7);
  const [areaSel, setAreaSel] = useState<string[]>([]);

  const build = () => {
    const t = todayIso(), until = iso(addDays(new Date(), days));
    const areas = store.areas.filter((a) => !areaSel.length || areaSel.includes(a.id));
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    const block = (areaId: string | null) => {
      type R = { day: string; time: string; text: string };
      const rows: R[] = [];
      for (const it of store.items) {
        if (it.kind !== 'task' || it.done || it.area_id !== areaId) continue;
        if (it.due_date && it.due_date > until) continue;
        const proj = store.projects.find((p) => p.id === it.project_id);
        rows.push({ day: it.due_date || '9999', time: it.due_time || '', text: `☐ ${esc(it.title)}${proj ? ` <i>(${esc(proj.name)})</i>` : ''}${it.due_date && it.due_date < t ? ' <b>— просрочено</b>' : ''}` });
      }
      const seen = new Set<string>();
      for (const e of events || []) {
        if (e.day < t || e.day > until || isCancelled(e.title) || seen.has(e.id)) continue;
        if (classify(e, store.event_links, store.areas, store.projects).area !== areaId) continue;
        seen.add(e.id);
        rows.push({ day: e.day, time: e.time, text: `${esc(e.title)} <i>(календарь)</i>` });
      }
      rows.sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));
      return rows.map((r) => `<li>${r.day === '9999' ? 'без срока' : absDate(r.day)}${r.time ? ', ' + r.time : ''} — ${r.text}</li>`).join('');
    };
    let body = `<h1>Дела на ${days === 1 ? 'сегодня' : `${days} дней`}</h1><p>с ${absDate(t)} по ${absDate(until)}</p>`;
    for (const a of areas) { const b = block(a.id); if (b) body += `<h2>${esc(a.name)}</h2><ul>${b}</ul>`; }
    if (!areaSel.length) { const b = block(null); if (b) body += `<h2>Без сферы</h2><ul>${b}</ul>`; }
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>body{font-family:Calibri,Arial;font-size:12pt}h1{font-size:18pt}h2{font-size:14pt;margin-top:14pt}li{margin:3pt 0}</style></head><body>${body}</body></html>`;
  };

  const run = async () => {
    const file = new File(['﻿' + build()], `Дела ${todayIso()}.doc`, { type: 'application/msword' });
    // На телефоне — меню «Поделиться» (почта, мессенджер, печать), на компьютере — скачивание.
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: file.name }); onClose(); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Документ скачан'); onClose();
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <h3>Выгрузить дела</h3>
      <span className="lbl-t">На какой срок</span>
      <div className="chips">{[[1, 'Сегодня'], [7, 'Неделя'], [14, '2 недели'], [31, 'Месяц']].map(([n, l]) => <button key={n} type="button" className="chip" aria-pressed={days === n} onClick={() => setDays(n as number)}>{l}</button>)}</div>
      <span className="lbl-t">Какие сферы (ничего не выбрано — все)</span>
      <div className="chips">{store.areas.map((a) => { const on = areaSel.includes(a.id); return <button key={a.id} type="button" className="chip" aria-pressed={on} onClick={() => setAreaSel(on ? areaSel.filter((x) => x !== a.id) : [...areaSel, a.id])}>{a.name}</button>; })}</div>
      <span className="mini">Получится файл Word. С телефона его можно сразу отправить себе на почту или распечатать.</span>
      <button className="btn primary" type="button" onClick={run}>Выгрузить</button>
    </Sheet>
  );
}

type ImportFile = {
  areas?: { key: string; name: string; color?: Color; keywords?: string[] }[];
  items?: { kind?: 'task' | 'note'; title: string; body?: string | null; area?: string | null; due_date?: string | null; due_time?: string | null; done?: boolean }[];
  money_months?: { ym: string; income: object; got: object; plan: object }[];
  expenses?: { what: string; amount: number; category: string; wb?: boolean; spent_on: string }[];
  incomes?: { what: string; amount: number; source: string; got_on: string }[];
};

function ImportButton() {
  const store = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const data = JSON.parse(await f.text()) as ImportFile;
      const ids: Record<string, string> = {};
      for (const a of data.areas || []) {
        const same = store.areas.find((x) => x.name.toLowerCase() === a.name.toLowerCase());
        if (same) { ids[a.key] = same.id; continue; }
        const r = await store.insert('areas', { name: a.name, color: a.color || 'gray', keywords: a.keywords || [], sort: store.areas.length + Object.keys(ids).length });
        if (r) ids[a.key] = r.id;
      }
      const ins = async (t: 'items' | 'expenses' | 'incomes', rows: object[]) => {
        for (let i = 0; i < rows.length; i += 200) { const { error } = await supabase!.from(t).insert(rows.slice(i, i + 200)); if (error) throw error; }
      };
      await ins('items', (data.items || []).map((x) => ({ kind: x.kind || 'task', title: x.title, body: x.body || null, area_id: (x.area && ids[x.area]) || null, due_date: x.due_date || null, due_time: x.due_time || null, done: !!x.done, done_at: x.done ? new Date().toISOString() : null })));
      await ins('expenses', data.expenses || []);
      await ins('incomes', data.incomes || []);
      if (data.money_months?.length) { const { error } = await supabase!.from('money_months').upsert(data.money_months); if (error) throw error; }
      await store.reload();
      toast(`Перенесено: ${(data.items || []).length} дел и заметок, ${(data.expenses || []).length} трат`);
    } catch (e) { toast(`Не получилось: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  return (
    <label className="btn" style={{ textAlign: 'center' }}>
      {busy ? 'Переношу…' : 'Выбрать файл'}
      <input type="file" accept="application/json,.json" hidden onChange={(e) => run(e.target.files?.[0])} />
    </label>
  );
}
