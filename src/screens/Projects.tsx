// Проекты внутри сферы: у каждого статус (идея, в работе, жду, готово), заметка «где сейчас» и следующий шаг.
import { useState } from 'react';
import { useStore } from '../lib/store';
import { useApp } from '../lib/context';
import { fmtDate } from '../lib/dates';
import { PROJECT_STATUS, statusOf, type Project, type ProjectStatus } from '../lib/types';
import { Sheet, sc, useToast } from '../components/ui';

type Store = ReturnType<typeof useStore>;
const ORDER: ProjectStatus[] = ['active', 'wait', 'idea', 'done'];

export async function setProjectStatus(store: Store, p: Project, status: ProjectStatus, note?: string | null) {
  await store.update('projects', { id: p.id }, { status, done: status === 'done', status_at: new Date().toISOString(), ...(note !== undefined ? { note } : {}) });
}

/** Статус-плашка: нажала — выбрала другой. */
export function StatusPill({ p }: { p: Project }) {
  const store = useStore();
  const s = statusOf(p);
  return (
    <label className="spill" style={sc(PROJECT_STATUS[s].color)} onClick={(e) => e.stopPropagation()}>
      <span>{PROJECT_STATUS[s].name}</span>
      <select aria-label={`Статус проекта «${p.name}»`} value={s} onChange={(e) => setProjectStatus(store, p, e.target.value as ProjectStatus)}>
        {ORDER.map((k) => <option key={k} value={k}>{PROJECT_STATUS[k].name}</option>)}
      </select>
    </label>
  );
}

/** Список проектов сферы: карточки со статусом, заметкой и следующим делом. */
export function ProjectsBlock({ areaId }: { areaId: string }) {
  const store = useStore();
  const { go } = useApp();
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const all = store.projects.filter((p) => p.area_id === areaId);
  const open = all.filter((p) => statusOf(p) !== 'done').sort((a, b) => ORDER.indexOf(statusOf(a)) - ORDER.indexOf(statusOf(b)) || a.sort - b.sort);
  const done = all.filter((p) => statusOf(p) === 'done');
  const card = (p: Project) => {
    const tasks = store.items.filter((t) => t.project_id === p.id && t.kind === 'task' && !t.done)
      .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    return (
      <div key={p.id} role="button" tabIndex={0} className="pcard" onClick={() => go({ name: 'area', id: areaId, project: p.id })} onKeyDown={(e) => { if (e.key === 'Enter') go({ name: 'area', id: areaId, project: p.id }); }}>
        <div className="pcard-h"><b>{p.name}</b><StatusPill p={p} /></div>
        {p.note && <span className="pnote">{p.note}</span>}
        <span className="mini">{tasks.length ? `Дальше: ${tasks[0].title}${tasks[0].due_date ? ` · ${fmtDate(tasks[0].due_date)}` : ''}${tasks.length > 1 ? ` · ещё ${tasks.length - 1}` : ''}` : 'Шагов пока нет'}{p.due_date ? ` · срок ${fmtDate(p.due_date)}` : ''}</span>
      </div>
    );
  };
  return (
    <div className="block">
      <div className="bh"><h4>Проекты · {open.length}</h4><button type="button" onClick={() => setAdding(true)}>+ проекты</button></div>
      {!all.length && <div className="mini">Проектов пока нет. Добавь сразу несколько — по одному на строку, или скажи в микрофон: «добавь проекты: приложение по русскому, мультик на заказ».</div>}
      <div className="pcards">{open.map(card)}</div>
      {done.length > 0 && <button type="button" className="paidtoggle" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}><span>Готовые · {done.length}</span><b>{showDone ? '▴' : '▾'}</b></button>}
      {showDone && <div className="pcards">{done.map(card)}</div>}
      {adding && <AddProjects areaId={areaId} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddProjects({ areaId, onClose }: { areaId: string; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('active');
  const names = text.split('\n').map((x) => x.replace(/^[-•\d.)\s]+/, '').trim()).filter(Boolean);
  const save = async () => {
    let i = store.projects.length;
    for (const name of names) await store.insert('projects', { name, area_id: areaId, status, done: status === 'done', keywords: [], sort: i++ });
    toast(`Добавлено проектов: ${names.length}`); onClose();
  };
  return (
    <Sheet open onClose={onClose}>
      <h3>Новые проекты</h3>
      <textarea className="field" rows={5} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={'По одному на строку:\nПриложение по русскому\nМультик на заказ\nБлог'} />
      <span className="lbl-t">Статус для всех</span>
      <div className="chips">{ORDER.map((k) => <button key={k} type="button" className="chip" aria-pressed={status === k} onClick={() => setStatus(k)}>{PROJECT_STATUS[k].name}</button>)}</div>
      <button className="btn primary" type="button" disabled={!names.length} onClick={save}>{names.length > 1 ? `Добавить ${names.length}` : 'Добавить'}</button>
    </Sheet>
  );
}

/** Шапка открытого проекта: статус и «где сейчас», правится прямо на месте. */
export function ProjectStatusBar({ p }: { p: Project }) {
  const store = useStore();
  const [note, setNote] = useState(p.note || '');
  return (
    <div className="pstatus">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="mini">Статус</span><StatusPill p={p} />
      </div>
      <textarea className="field" rows={2} value={note} placeholder="Где сейчас: что сделано, что дальше, чего жду" aria-label="Где сейчас"
        onChange={(e) => setNote(e.target.value)} onBlur={() => { if ((p.note || '') !== note.trim()) store.update('projects', { id: p.id }, { note: note.trim() || null, status_at: new Date().toISOString() }); }} />
      {p.status_at && <span className="mini">Обновлено {fmtDate(p.status_at.slice(0, 10))}</span>}
    </div>
  );
}
