// Карточки дел и событий, общие для «Сегодня» и сфер.
import { useStore } from '../lib/store';
import { useApp } from '../lib/context';
import { classify, isCancelled, SUB_NUM, type CalEvent } from '../lib/gcal';
import { fmtDate, parseIso, todayIso, WD, MON } from '../lib/dates';
import type { Item } from '../lib/types';
import { Icon, sc } from './ui';

export function TaskCard({ t, showArea }: { t: Item; showArea?: boolean }) {
  const { areas, projects, update } = useStore();
  const { openItem } = useApp();
  const a = areas.find((x) => x.id === t.area_id), p = projects.find((x) => x.id === t.project_id);
  const diff = t.due_date ? Math.round((parseIso(t.due_date).getTime() - parseIso(todayIso()).getTime()) / 864e5) : null;
  return (
    <div className={'task' + (t.done ? ' done' : '')} style={sc(a?.color || 'gray')}>
      <input className="check" type="checkbox" checked={t.done} aria-label={'Сделано: ' + t.title}
        onChange={() => update('items', { id: t.id }, t.done ? { done: false, done_at: null } : { done: true, done_at: new Date().toISOString() })} />
      <button className="body" type="button" onClick={() => openItem(t)}>
        <span className="txt">{t.title}</span>
        <span className="meta">
          {showArea && a && <span className="sp">{a.name}</span>}
          {p && <span>{p.name}</span>}
          {t.due_date && <span className={t.done ? '' : diff! < 0 ? 'late' : diff! <= 2 ? 'soon' : ''}>{fmtDate(t.due_date)}{t.due_time ? `, ${t.due_time}` : ''}</span>}
          {t.gcal_event_id && <span>в календаре</span>}
          {t.files.length > 0 && <span>📎 {t.files.length}</span>}
        </span>
      </button>
    </div>
  );
}

export function EventCard({ e, showDay }: { e: CalEvent; showDay?: boolean }) {
  const { event_links, areas, projects } = useStore();
  const { openEvent } = useApp();
  const c = classify(e, event_links, areas, projects);
  const a = areas.find((x) => x.id === c.area);
  const m = e.title.match(SUB_NUM);
  const mark = event_links.find((x) => x.event_id === e.id)?.mark;
  const d = parseIso(e.day);
  return (
    <button type="button" className={'evcard' + (isCancelled(e.title) ? ' cancel' : '') + (mark ? ' st-' + mark : '')} style={{ ...sc(a?.color || 'gray'), textAlign: 'left', width: '100%' }} onClick={() => openEvent(e)}>
      <span className="evic">{m ? <b className="num-badge">{m[1]}</b> : <Icon name="cal" w={1.8} />}</span>
      <span className="evb">
        <span className="evt">{e.title}</span>
        <small>{[showDay ? `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}` : null, e.time ? (e.endTime ? `${e.time}–${e.endTime}` : e.time) : 'весь день', e.family ? 'календарь «Семья»' : null, mark === 'went' ? 'была' : mark === 'missed' ? 'пропустила' : null].filter(Boolean).join(' · ')}</small>
      </span>
    </button>
  );
}
