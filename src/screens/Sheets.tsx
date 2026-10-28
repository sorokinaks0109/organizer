// Карточка дела/заметки и карточка события календаря.
import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { useApp } from '../lib/context';
import { supabase, callFn } from '../lib/supabase';
import { createCalendarEvent } from '../lib/actions';
import { classify, isCancelled, seriesId, SUB_NUM, type CalEvent } from '../lib/gcal';
import { addDays, cap1, MON, parseIso, plural, todayIso, WD_FULL } from '../lib/dates';
import type { FileRef, Item } from '../lib/types';
import { Chip, Sheet, useToast } from '../components/ui';

export function ItemSheet({ item, preset, onClose }: { item: Item | null; preset?: Partial<Item>; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const isNew = !item;
  const base = item ?? ({ kind: 'task', title: '', body: null, area_id: null, project_id: null, due_date: null, due_time: null, files: [], ...preset } as Item);
  const [kind, setKind] = useState(base.kind);
  const [title, setTitle] = useState(base.title);
  const [body, setBody] = useState(base.body || '');
  const [area, setArea] = useState(base.area_id);
  const [project, setProject] = useState(base.project_id);
  const [date, setDate] = useState(base.due_date || '');
  const [time, setTime] = useState(base.due_time || '');
  const [files, setFiles] = useState<FileRef[]>(base.files || []);
  const [cal, setCal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    const { data: u } = await supabase!.auth.getUser();
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > 20 * 1024 * 1024) { setMsg(`«${f.name}» больше 20 МБ`); continue; }
      const path = `${u.user!.id}/items/${crypto.randomUUID()}-${f.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}`;
      const { error } = await supabase!.storage.from('files').upload(path, f, { contentType: f.type });
      if (error) setMsg(`«${f.name}» не загрузился: ${error.message}`); else next.push({ path, name: f.name, type: f.type });
    }
    setFiles(next);
  };
  const openFile = async (f: FileRef) => {
    const { data } = await supabase!.storage.from('files').createSignedUrl(f.path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  };

  const save = async () => {
    if (!title.trim()) { setMsg('Напиши, что сделать или запомнить'); return; }
    if (cal && !date) { setMsg('Для календаря нужна дата'); return; }
    setBusy(true);
    const patch = { kind, title: title.trim(), body: body.trim() || null, area_id: area, project_id: project, due_date: kind === 'task' ? date || null : null, due_time: kind === 'task' ? time || null : null, files };
    let id = item?.id;
    if (isNew) { const r = await store.insert('items', patch); id = r?.id; } else await store.update('items', { id: item!.id }, patch);
    if (cal && id) {
      try {
        const ev = await createCalendarEvent({ title: patch.title, date, start: time || null, note: patch.body || undefined });
        await store.update('items', { id }, { gcal_event_id: ev.id });
        await store.upsert('event_links', { event_id: ev.id, area_id: area, project_id: project });
      } catch (e) { toast(`Сохранено, но в календарь не встало: ${(e as Error).message}`); setBusy(false); onClose(); return; }
    }
    setBusy(false); toast(isNew ? 'Добавлено' : 'Сохранено'); onClose();
  };

  const projs = store.projects.filter((p) => !p.done && (!area || p.area_id === area));
  return (
    <Sheet open onClose={onClose}>
      <h3>{isNew ? (kind === 'note' ? 'Новая заметка' : 'Новое дело') : kind === 'note' ? 'Заметка' : 'Дело'}</h3>
      <textarea className="field" rows={kind === 'note' ? 4 : 2} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Что сделать или что запомнить" autoFocus={isNew} />
      <div className="chips"><Chip on={kind === 'task'} onClick={() => setKind('task')}>Дело</Chip><Chip on={kind === 'note'} onClick={() => setKind('note')}>Заметка</Chip></div>
      <span className="lbl-t">Сфера</span>
      <div className="chips">{store.areas.map((a) => <Chip key={a.id} color={a.color} on={a.id === area} onClick={() => { setArea(a.id); setProject(null); }}>{a.name}</Chip>)}</div>
      {projs.length > 0 && <><span className="lbl-t">Проект</span><div className="chips"><Chip on={!project} onClick={() => setProject(null)}>Без проекта</Chip>{projs.map((p) => <Chip key={p.id} on={p.id === project} onClick={() => setProject(p.id)}>{p.name}</Chip>)}</div></>}
      {kind === 'task' && (
        <>
          <div className="row"><label className="lbl">Срок (не обязательно)<input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><label className="lbl">Время<input className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label></div>
          <label className="row" style={{ gap: 10, fontSize: 16 }}><input type="checkbox" checked={cal} onChange={(e) => setCal(e.target.checked)} style={{ width: 22, height: 22 }} />{item?.gcal_event_id ? 'Уже в календаре · поставить ещё раз' : 'Поставить в Google Календарь'}</label>
        </>
      )}
      <textarea className="field" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Подробности, ссылка (не обязательно)" />
      <label className="lbl" style={{ flex: 'none' }}>Файл или фото<input type="file" multiple onChange={(e) => upload(e.target.files)} /></label>
      {files.length > 0 && <div className="files">{files.map((f) => <span key={f.path} className="row" style={{ gap: 2 }}><button type="button" className="file" onClick={() => openFile(f)}><span className="nm">{f.name}</span></button><button className="x" type="button" aria-label={'Убрать ' + f.name} onClick={() => setFiles(files.filter((x) => x.path !== f.path))}>×</button></span>)}</div>}
      {msg && <span className="err">{msg}</span>}
      <div className="row">
        <button className="btn primary" type="button" disabled={busy} onClick={save}>{busy ? 'Сохраняю…' : isNew ? 'Добавить' : 'Сохранить'}</button>
        <span style={{ flex: 1 }} />
        {!isNew && <button className="btn ghost danger" type="button" onClick={async () => { await store.remove('items', { id: item!.id }); toast('Удалено'); onClose(); }}>Удалить</button>}
      </div>
    </Sheet>
  );
}

/** Карточка события: сфера/проект, отметки занятия, отмена с перенумерацией абонемента. */
export function EventSheet({ e, onClose }: { e: CalEvent; onClose: () => void }) {
  const store = useStore();
  const { refreshEvents } = useApp();
  const toast = useToast();
  const c = classify(e, store.event_links, store.areas, store.projects);
  const link = store.event_links.find((x) => x.event_id === e.id);
  const series = seriesId(e);
  const seriesLink = store.event_links.find((x) => x.event_id === series);
  const m = e.title.match(SUB_NUM), canc = isCancelled(e.title);
  const train = !!m || /^балет/i.test(e.title);
  const d = parseIso(e.day);
  const [plan, setPlan] = useState<{ id: string; calendarId: string; title: string; start: string }[] | null>(null);
  const [state, setState] = useState('');

  // Отметка — у конкретного занятия; сфера и проект — у всей серии.
  const setMark = (mark: 'went' | 'missed' | null) => store.upsert('event_links', { event_id: e.id, area_id: link?.area_id ?? null, project_id: link?.project_id ?? null, mark });
  const setPlace = (area_id: string | null, project_id: string | null) => store.upsert('event_links', { event_id: series, area_id, project_id, mark: series === e.id ? link?.mark ?? null : seriesLink?.mark ?? null });

  const prepareRenumber = async (cancel: boolean) => {
    setState('Смотрю все занятия абонемента…');
    try {
      const prefix = (e.title.match(/^(.*?)(?=\s*(№|отмен))/i)?.[1] || e.title).trim();
      const t0 = new Date(todayIso() + 'T00:00:00');
      const res = await callFn<{ events: { id: string; calendarId: string; title: string; start: string }[] }>('gcal', { action: 'list', from: addDays(t0, -90).toISOString(), to: addDays(t0, 200).toISOString(), q: prefix });
      const list = res.events.filter((x) => x.title.startsWith(prefix) && x.calendarId === e.calendarId).sort((a, b) => a.start.localeCompare(b.start));
      const idx = list.findIndex((x) => x.id === e.id); if (idx < 0) throw new Error('Не нашла это занятие в календаре');
      const total = Number((list.find((x) => SUB_NUM.test(x.title))?.title.match(SUB_NUM) || [0, 0, 16])[2]);
      const before = (i: number) => { for (let j = i - 1; j >= 0; j--) { if (isCancelled(list[j].title)) continue; const mm = list[j].title.match(SUB_NUM); return mm ? (Number(mm[1]) >= Number(mm[2]) ? 0 : Number(mm[1])) : 0; } return 0; };
      const fmt = (k: number) => `${prefix} №${k} из ${total}` + (k === 1 ? ' — начало абонемента' : '') + (k === total ? '. Абонемент закрыт.' : '');
      const upd: { id: string; calendarId: string; title: string; start: string }[] = [];
      let k: number;
      if (cancel) { const mm = list[idx].title.match(SUB_NUM); k = mm ? Number(mm[1]) : before(idx) + 1; upd.push({ ...list[idx], title: `${prefix} отменена` }); }
      else k = before(idx) + 1;
      let closed = false;
      for (let i = cancel ? idx + 1 : idx; i < list.length; i++) {
        const x = list[i]; if (i !== idx && isCancelled(x.title)) continue;
        let title: string;
        if (!closed) { title = fmt(k); k++; if (k > total) closed = true; } else { if (!SUB_NUM.test(x.title)) break; title = prefix; }
        if (title !== x.title) upd.push({ ...x, title });
      }
      setPlan(upd); setState(upd.length ? '' : 'Менять нечего, нумерация верная.');
    } catch (err) { setState((err as Error).message); }
  };
  const apply = async () => {
    if (!plan) return;
    let n = 0;
    try {
      for (const x of plan) { setState(`Меняю ${n + 1} из ${plan.length}…`); await callFn('gcal', { action: 'rename', id: x.id, calendarId: x.calendarId, summary: x.title }); n++; }
      await setMark(null); await refreshEvents(); toast('Номера занятий обновлены в Google Календаре'); onClose();
    } catch (err) { setState(`Остановилась: изменено ${n} из ${plan.length}. ${(err as Error).message}`); }
  };

  useEffect(() => { setPlan(null); setState(''); }, [e.id]);
  const projs = store.projects.filter((p) => !p.done && p.area_id === c.area);
  return (
    <Sheet open onClose={onClose}>
      <h3>{e.title}</h3>
      <span className="muted">{[`${cap1(WD_FULL[d.getDay()])}, ${d.getDate()} ${MON[d.getMonth()]}`, e.time ? (e.endTime ? `${e.time}–${e.endTime}` : e.time) : 'весь день', e.family ? 'календарь «Семья»' : null].filter(Boolean).join(' · ')}</span>
      {m && <span>Занятие №{m[1]} из {m[2]} в абонементе</span>}
      {train && !plan && (
        <>
          <span className="lbl-t">Как прошло занятие</span>
          <div className="kinds" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {canc ? <button className="kind" type="button" aria-pressed="true">Отменили<small>не считается</small></button> : <>
              <button className="kind" type="button" aria-pressed={link?.mark === 'went'} onClick={() => { setMark(link?.mark === 'went' ? null : 'went'); onClose(); }}>✓ Была<small>ходила</small></button>
              <button className="kind" type="button" aria-pressed={link?.mark === 'missed'} onClick={() => { setMark(link?.mark === 'missed' ? null : 'missed'); onClose(); }}>Пропустила<small>сгорело</small></button>
              <button className="kind" type="button" onClick={() => prepareRenumber(true)}>Отменили<small>сдвину номера</small></button>
            </>}
          </div>
          {canc && <button className="btn" type="button" style={{ alignSelf: 'flex-start' }} onClick={() => prepareRenumber(false)}>Вернуть занятие: всё-таки было</button>}
        </>
      )}
      {plan && plan.length > 0 && (
        <div className="plan">
          <b>Переименую {plan.length} {plural(plan.length, 'событие', 'события', 'событий')} в Google Календаре:</b>
          <ol className="plan-list">{plan.map((x) => { const dd = new Date(x.start); return <li key={x.id}>{dd.getDate()} {MON[dd.getMonth()]}: {x.title}</li>; })}</ol>
          <div className="row"><button className="btn primary" type="button" onClick={apply}>Применить</button><button className="btn ghost" type="button" onClick={() => setPlan(null)}>Отмена</button></div>
        </div>
      )}
      {state && <span className="msg">{state}</span>}
      <span className="lbl-t">Сфера в органайзере</span>
      <div className="chips">{store.areas.map((a) => <Chip key={a.id} color={a.color} on={a.id === c.area} onClick={() => setPlace(a.id, null)}>{a.name}</Chip>)}</div>
      {projs.length > 0 && <div className="chips"><Chip on={!c.project} onClick={() => setPlace(c.area, null)}>Без проекта</Chip>{projs.map((p) => <Chip key={p.id} on={p.id === c.project} onClick={() => setPlace(c.area, p.id)}>{p.name}</Chip>)}</div>}
      <span className="mini">Выбор сферы запомнится для этого события{e.recurring ? ' и всей его серии' : ''}.</span>
      <div className="row"><a className="btn" href={e.link} target="_blank" rel="noopener" style={{ textDecoration: 'none', color: 'var(--ink)' }}>Открыть в Google Календаре</a><button className="btn ghost" type="button" onClick={onClose}>Закрыть</button></div>
    </Sheet>
  );
}
