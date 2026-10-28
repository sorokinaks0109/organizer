// Плитки сфер и экран сферы: проекты, единая лента «Дела» (задачи + события календаря), заметки.
import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { useApp } from '../lib/context';
import { classify, isCancelled, SUB_NUM, type CalEvent } from '../lib/gcal';
import { fmtDate, todayIso, iso, addDays } from '../lib/dates';
import { COLORS, PROJECT_STATUS, statusOf, type Area, type Color, type Project, type ProjectStatus } from '../lib/types';
import { Chip, Hero, Icon, Sheet, sc, useToast } from '../components/ui';
import { EventCard, TaskCard } from '../components/Rows';
import { HealthCard } from './Health';
import { ProjectsBlock, ProjectStatusBar } from './Projects';

export function Tiles() {
  const { areas, items, event_links, projects } = useStore();
  const { events, go } = useApp();
  const [create, setCreate] = useState(false);
  const week = iso(addDays(new Date(), 7)), t = todayIso();
  const upcoming = (events || []).filter((e) => e.day >= t && !isCancelled(e.title));
  return (
    <>
      <div className="tiles">
        {areas.map((a) => {
          const open = items.filter((x) => x.area_id === a.id && x.kind === 'task' && !x.done);
          const evs = upcoming.filter((e) => classify(e, event_links, areas, projects).area === a.id);
          const weekEvs = new Set(evs.filter((e) => e.day <= week).map((e) => e.id)).size;
          // Следующее: ближайшее дело со сроком или событие; если сроков нет — первое дело без срока.
          const cands = [
            ...open.map((x) => ({ k: x.due_date ? x.due_date + (x.due_time || '99:99') : '9999', text: x.title, when: x.due_date ? fmtDate(x.due_date) + (x.due_time ? `, ${x.due_time}` : '') : '' })),
            ...evs.map((e) => ({ k: e.day + (e.time || '00:00'), text: e.title, when: fmtDate(e.day) + (e.time ? `, ${e.time}` : '') })),
          ].sort((x, y) => x.k.localeCompare(y.k));
          const next = cands[0];
          const sub = evs.map((e) => e.title.match(SUB_NUM)).find(Boolean);
          const n = open.length + weekEvs;
          return (
            <button key={a.id} className="tile" type="button" style={sc(a.color)} onClick={() => go({ name: 'area', id: a.id })}>
              <div className="tt"><b>{a.name}</b><span className="n">{n}</span></div>
              {sub && <div className="next"><em>абонемент · следующее №{sub[1]} из {sub[2]}</em><div className="sub" aria-hidden="true">{Array.from({ length: Number(sub[2]) }, (_, i) => <i key={i} className={i < Number(sub[1]) - 1 ? 'on' : ''} />)}</div></div>}
              <div className="next"><em>{next ? `дальше${next.when ? ' · ' + next.when : ''}` : 'дел нет'}</em>{next ? next.text : 'Нажми, чтобы добавить'}</div>
            </button>
          );
        })}
        <button className="tile add" type="button" onClick={() => setCreate(true)}>+ Сфера</button>
      </div>
      <AreaSheet key={String(create)} open={create} onClose={() => setCreate(false)} />
    </>
  );
}

export function AreaView({ id, project, tab = 'deals' }: { id: string; project?: string | null; tab?: 'deals' | 'notes' }) {
  const store = useStore();
  const { events, go, openItem, openCapture } = useApp();
  const [menu, setMenu] = useState(false);
  const [projSheet, setProjSheet] = useState<Project | 'new' | null>(null);
  const [showPast, setShowPast] = useState(false);
  const a = store.areas.find((x) => x.id === id);
  const t = todayIso();
  const projs = store.projects.filter((p) => p.area_id === id && !p.done);
  const inScope = (area: string | null, proj: string | null) => (project ? proj === project : area === id);

  const { tasks, notes, done, gUp, gPast, trainings } = useMemo(() => {
    const mine = store.items.filter((x) => inScope(x.area_id, x.project_id));
    const g: CalEvent[] = (events || []).filter((e) => { const c = classify(e, store.event_links, store.areas, store.projects); return inScope(c.area, c.project); });
    return {
      tasks: mine.filter((x) => x.kind === 'task' && !x.done),
      notes: mine.filter((x) => x.kind === 'note').sort((x, y) => y.created_at.localeCompare(x.created_at)),
      done: mine.filter((x) => x.kind === 'task' && x.done).sort((x, y) => (y.done_at || '').localeCompare(x.done_at || '')),
      gUp: g.filter((e) => e.day >= t), gPast: g.filter((e) => e.day < t).sort((x, y) => (y.day + y.time).localeCompare(x.day + x.time)),
      trainings: g.filter((e) => SUB_NUM.test(e.title) || /^балет/i.test(e.title)),
    };
  }, [store.items, store.event_links, store.areas, store.projects, events, id, project, t]);

  if (!a) return <div className="empty">Сфера не найдена. <button className="btn" onClick={() => go({ name: 'today' })}>На главную</button></div>;
  const rows = [
    ...tasks.map((x, i) => ({ k: (x.due_date ? x.due_date + (x.due_time || '99') : '9999') + String(i).padStart(4, '0'), n: <TaskCard key={x.id} t={x} /> })),
    ...gUp.slice(0, 60).map((e) => ({ k: e.day + (e.time || '00'), n: <EventCard key={e.id + e.day} e={e} showDay /> })),
  ].sort((x, y) => x.k.localeCompare(y.k));
  const curProj = project ? store.projects.find((p) => p.id === project) : null;

  return (
    <>
      <Hero color={a.color} title={curProj ? curProj.name : a.name} onBack={() => (project ? go({ name: 'area', id }) : go({ name: 'today' }))} onMenu={() => (curProj ? setProjSheet(curProj) : setMenu(true))}>
        {curProj?.goal && <span className="mini">Цель: {curProj.goal}</span>}
        {curProj && <ProjectStatusBar key={curProj.id} p={curProj} />}
        {!project && (
          <div className="projchips">
            <Chip on={!project}>Всё</Chip>
            {projs.map((p) => <Chip key={p.id} onClick={() => go({ name: 'area', id, project: p.id })}>{p.name}</Chip>)}
            <Chip onClick={() => setProjSheet('new')}>+ проект</Chip>
          </div>
        )}
        <div className="seg">
          <button type="button" role="tab" aria-selected={tab === 'deals'} onClick={() => go({ name: 'area', id, project, tab: 'deals' })}>Дела · {tasks.length + new Set(gUp.map((e) => e.id)).size}</button>
          <button type="button" role="tab" aria-selected={tab === 'notes'} onClick={() => go({ name: 'area', id, project, tab: 'notes' })}>Заметки · {notes.length}</button>
        </div>
      </Hero>
      {tab === 'deals' ? (
        <div className="tlist" style={sc(a.color)}>
          {!project && /здоров/i.test(a.name) && <HealthCard />}
          {!project && <ProjectsBlock areaId={id} />}
          {trainings.length > 0 && <Subscription list={trainings} />}
          {!rows.length && <div className="empty">Дел пока нет. Нажми «+» и надиктуй — дело само попадёт сюда.{a.keywords.length ? ` События календаря со словами «${a.keywords.join('», «')}» тоже показываются здесь.` : ''}</div>}
          {rows.map((r) => r.n)}
          {(done.length + gPast.length) > 0 && <button className="btn ghost done-toggle" type="button" onClick={() => setShowPast(!showPast)}>{showPast ? 'Скрыть сделанное и прошедшее' : `Сделано и прошедшее · ${done.length + gPast.length}`}</button>}
          {showPast && <>{done.map((x) => <TaskCard key={x.id} t={x} />)}{gPast.map((e) => <EventCard key={e.id + e.day} e={e} showDay />)}</>}
        </div>
      ) : (
        notes.length ? <div className="notes">{notes.map((n) => <button key={n.id} className="note" type="button" onClick={() => openItem(n)}><span>{n.title}</span>{n.body && <small>{n.body.slice(0, 80)}</small>}</button>)}</div>
          : <div className="empty">Заметок пока нет. Скажи в «+»: «заметка: размер ноги Миланы 33».</div>
      )}
      <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
        <button className="btn" type="button" style={{ background: 'var(--surface)' }} onClick={() => openCapture(id)}><Icon name="mic" /> Надиктовать в «{a.name}»</button>
        <button className="btn" type="button" style={{ background: 'var(--surface)' }} onClick={() => openItem(null, { area_id: id, project_id: project ?? null, kind: tab === 'notes' ? 'note' : 'task' })}>+ {tab === 'notes' ? 'Заметка' : 'Дело'} вручную</button>
      </div>
      <AreaSheet key={a.id + String(menu)} open={menu} area={a} onClose={() => setMenu(false)} />
      <ProjectSheet key={projSheet === 'new' ? 'new' : projSheet?.id || 'none'} open={!!projSheet} project={projSheet === 'new' ? null : projSheet} areaId={id} onClose={() => setProjSheet(null)} />
    </>
  );
}

/** Абонемент: следующее занятие и сколько прошло. Номера берутся из названий событий («№2 из 16»). */
function Subscription({ list }: { list: CalEvent[] }) {
  const { event_links } = useStore();
  const t = todayIso();
  const next = list.filter((e) => e.day >= t && !isCancelled(e.title) && SUB_NUM.test(e.title)).sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time))[0];
  if (!next) return null;
  const [, n, total] = next.title.match(SUB_NUM)!.map(Number);
  const past = list.filter((e) => e.day < next.day && !isCancelled(e.title) && SUB_NUM.test(e.title) && Number(e.title.match(SUB_NUM)![1]) < n);
  const mark = (e: CalEvent) => event_links.find((x) => x.event_id === e.id)?.mark;
  return (
    <div className="card" style={sc('pink')}>
      <div className="card-t">Абонемент</div>
      <div className="kv"><span>Следующее</span><b>№{n} из {total} · {next.day === t ? 'сегодня' : next.day}{next.time ? `, ${next.time}` : ''}</b></div>
      <div className="bar"><i style={{ width: `${Math.round(((n - 1) / total) * 100)}%` }} /></div>
      <div className="kv"><span>Была / пропустила</span><span>{past.filter((e) => mark(e) === 'went').length} / {past.filter((e) => mark(e) === 'missed').length}</span></div>
    </div>
  );
}

export function AreaSheet({ open, area, onClose }: { open: boolean; area?: Area; onClose: () => void }) {
  const store = useStore();
  const { go } = useApp();
  const toast = useToast();
  const [name, setName] = useState(area?.name || '');
  const [color, setColor] = useState<Color>(area?.color || COLORS[store.areas.length % COLORS.length]);
  const [words, setWords] = useState((area?.keywords || []).join(', '));
  const [confirmDel, setConfirmDel] = useState(false);
  const idx = area ? store.areas.findIndex((x) => x.id === area.id) : -1;
  const save = async () => {
    const n = name.trim(); if (!n) return;
    const keywords = words.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
    if (area) await store.update('areas', { id: area.id }, { name: n, color, keywords });
    else { const r = await store.insert('areas', { name: n, color, keywords, sort: store.areas.length }); if (r) go({ name: 'area', id: r.id }); }
    onClose();
  };
  const move = async (dir: number) => {
    const list = [...store.areas]; const j = idx + dir; if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    await Promise.all(list.map((x, i) => (x.sort !== i ? store.update('areas', { id: x.id }, { sort: i }) : null)));
    toast(dir < 0 ? 'Плитка выше' : 'Плитка ниже');
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <h3>{area ? `Сфера «${area.name}»` : 'Новая сфера'}</h3>
      <label className="lbl" style={{ flex: 'none' }}>Название<input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Блог" /></label>
      <span className="lbl-t">Цвет</span>
      <div className="swatches">{COLORS.map((c) => <button key={c} type="button" className="swatch" style={sc(c)} aria-label={c} aria-pressed={c === color} onClick={() => setColor(c)} />)}</div>
      <label className="lbl" style={{ flex: 'none' }}>Слова для событий календаря
        <textarea className="field" rows={2} value={words} onChange={(e) => setWords(e.target.value)} placeholder="балет, тренировк, бассейн" />
        <span className="mini">Событие из Google Календаря, в названии которого есть одно из слов, появится в этой сфере. Можно начало слова.</span>
      </label>
      <div className="row">
        <button className="btn primary" type="button" onClick={save}>{area ? 'Сохранить' : 'Создать'}</button>
        {area && idx > 0 && <button className="btn" type="button" onClick={() => move(-1)}>Выше</button>}
        {area && idx < store.areas.length - 1 && <button className="btn" type="button" onClick={() => move(1)}>Ниже</button>}
        <span style={{ flex: 1 }} />
        {area && !confirmDel && <button className="btn ghost danger" type="button" onClick={() => setConfirmDel(true)}>Удалить</button>}
        {area && confirmDel && <button className="btn primary" type="button" style={{ background: 'var(--danger)', color: '#fff' }} onClick={async () => { await store.remove('areas', { id: area.id }); onClose(); go({ name: 'today' }); toast('Сфера удалена, её дела остались без сферы'); }}>Точно удалить</button>}
      </div>
    </Sheet>
  );
}

export function ProjectSheet({ open, project, areaId, onClose }: { open: boolean; project: Project | null; areaId: string; onClose: () => void }) {
  const store = useStore();
  const { go } = useApp();
  const [name, setName] = useState(project?.name || '');
  const [goal, setGoal] = useState(project?.goal || '');
  const [due, setDue] = useState(project?.due_date || '');
  const [words, setWords] = useState((project?.keywords || []).join(', '));
  const [status, setStatus] = useState<ProjectStatus>(project ? statusOf(project) : 'active');
  const [note, setNote] = useState(project?.note || '');
  const save = async () => {
    const n = name.trim(); if (!n) return;
    const changed = !project || statusOf(project) !== status || (project.note || '') !== note.trim();
    const patch = { name: n, goal: goal.trim() || null, due_date: due || null, keywords: words.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean), status, done: status === 'done', note: note.trim() || null, ...(changed ? { status_at: new Date().toISOString() } : {}) };
    if (project) await store.update('projects', { id: project.id }, patch);
    else { const r = await store.insert('projects', { ...patch, area_id: areaId, sort: store.projects.length }); if (r) go({ name: 'area', id: areaId, project: r.id }); }
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <h3>{project ? 'Проект' : 'Новый проект'}</h3>
      <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, УПЦ 2027" />
      <input className="field" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Какой результат нужен (не обязательно)" />
      <span className="lbl-t">Статус</span>
      <div className="chips">{(['idea', 'active', 'wait', 'done'] as ProjectStatus[]).map((k) => <button key={k} type="button" className="chip" aria-pressed={status === k} onClick={() => setStatus(k)}>{PROJECT_STATUS[k].name}</button>)}</div>
      <textarea className="field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Где сейчас: что сделано, что дальше" />
      <label className="lbl" style={{ flex: 'none' }}>Срок<input className="field" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      <label className="lbl" style={{ flex: 'none' }}>Слова для событий календаря<input className="field" value={words} onChange={(e) => setWords(e.target.value)} placeholder="упц, показател" /></label>
      <div className="row">
        <button className="btn primary" type="button" onClick={save}>{project ? 'Сохранить' : 'Создать'}</button>
        <span style={{ flex: 1 }} />
        {project && <button className="btn ghost danger" type="button" onClick={async () => { await store.remove('projects', { id: project.id }); onClose(); go({ name: 'area', id: areaId }); }}>Удалить</button>}
      </div>
    </Sheet>
  );
}
