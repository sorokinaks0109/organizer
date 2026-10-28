// Большая кнопка «+»: надиктовать что угодно, нейросеть разложит по сферам и проектам, в календарь — что нужно.
import { useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { useDictation } from '../lib/voice';
import { parsedLabel, parseVoice, saveParsed } from '../lib/actions';
import { fmtDate, money, parseIso, MON } from '../lib/dates';
import { DEFAULT_HEALTH, DEFAULT_SPEND_CATS, INCOME_SOURCES, type Parsed } from '../lib/types';
import { Icon, Sheet, useToast } from '../components/ui';

const TYPE_NAME: Record<Parsed['type'], string> = { task: 'Дело', event: 'Событие в календарь', note: 'Заметка', expense: 'Трата', income: 'Доход', wish: 'Желание', paid: 'Платёж оплачен', health: 'Здоровье' };
const REPEAT: Record<string, string> = { DAILY: 'каждый день', WEEKLY: 'каждую неделю', MONTHLY: 'каждый месяц', YEARLY: 'каждый год' };
const REMIND: Record<string, string> = { hour: 'за час', day: 'за день', week: 'за неделю', none: 'без напоминания' };

export function Capture({ open, onClose, preferArea }: { open: boolean; onClose: () => void; preferArea?: string | null }) {
  const store = useStore();
  const toast = useToast();
  const [text, setText] = useState('');
  const [items, setItems] = useState<Parsed[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const textRef = useRef(text); textRef.current = text;
  const dict = useDictation((t) => setText((cur) => (cur ? cur.replace(/\s*$/, ' ') : '') + t));

  const close = () => { dict.stop(); setText(''); setItems(null); setErr(null); onClose(); };

  const parse = async (t = text) => {
    if (!t.trim()) return;
    setBusy(true); setErr(null);
    try {
      const res = await parseVoice(t, store, preferArea);
      if (!res.length) { setErr('Не поняла, что записать. Скажи иначе или допиши руками.'); return; }
      if (store.settings.autoSave) { toast(await saveParsed(res, store)); close(); return; }
      setItems(res);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const toggleMic = () => {
    if (dict.listening) { dict.stop(); setTimeout(() => parse(textRef.current), 700); }
    else { setItems(null); dict.start(); }
  };

  const save = async () => {
    if (!items) return;
    setBusy(true);
    const msg = await saveParsed(items, store);
    setBusy(false); toast(msg); close();
  };

  const patch = (i: number, p: Partial<Parsed>) => setItems((list) => list!.map((x, j) => (j === i ? ({ ...x, ...p } as Parsed) : x)));

  return (
    <Sheet open={open} onClose={close}>
      <h3>Что записать?</h3>
      <button className={'mic' + (dict.listening ? ' on' : '')} type="button" aria-label={dict.listening ? 'Остановить запись' : 'Надиктовать'} onClick={toggleMic}>
        <Icon name={dict.listening ? 'stop' : 'mic'} />
      </button>
      <p className="mini" style={{ textAlign: 'center', margin: 0 }}>
        {dict.listening ? 'Говори. Нажми ещё раз, когда закончишь — разберу сама.' : 'Нажми и говори как есть: «поставь мне и Мите в календарь…», «к среде отчёт», «такси 450».'}
      </p>
      {dict.error && <p className="err">{dict.error}</p>}
      <textarea className="field" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Или напиши здесь" />
      {dict.interim && <div className="interim">{dict.interim}</div>}
      {!items && (
        <div className="row">
          <button className="btn primary" type="button" disabled={busy || !text.trim()} onClick={() => parse()}>{busy ? 'Разбираю…' : 'Разобрать'}</button>
          {text && <button className="btn ghost" type="button" onClick={() => setText('')}>Очистить</button>}
        </div>
      )}
      {err && <p className="err">{err}</p>}
      {items && (
        <>
          <span className="lbl-t">Проверь и сохрани</span>
          {items.map((p, i) => <PreviewCard key={i} p={p} onChange={(x) => patch(i, x)} onRemove={() => setItems(items.filter((_, j) => j !== i))} />)}
          <div className="row">
            <button className="btn primary" type="button" disabled={busy || !items.length} onClick={save}>{busy ? 'Сохраняю…' : 'Сохранить всё'}</button>
            <button className="btn ghost" type="button" onClick={() => setItems(null)}>Назад к тексту</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function PreviewCard({ p, onChange, onRemove }: { p: Parsed; onChange: (x: Partial<Parsed>) => void; onRemove: () => void }) {
  const { areas, projects, people, settings, wishes } = useStore();
  const title = parsedLabel(p);
  const editable = p.type !== 'paid' && p.type !== 'health';
  const areaSel = 'area_id' in p && (
    <select aria-label="Сфера" value={p.area_id ?? ''} onChange={(e) => onChange({ area_id: e.target.value || null, ...('project_id' in p ? { project_id: null } : {}) } as Partial<Parsed>)}>
      <option value="">Без сферы</option>
      {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
  const projOpts = 'project_id' in p ? projects.filter((x) => !x.done && (!p.area_id || x.area_id === p.area_id)) : [];
  const projSel = 'project_id' in p && projOpts.length > 0 && (
    <select aria-label="Проект" value={p.project_id ?? ''} onChange={(e) => onChange({ project_id: e.target.value || null } as Partial<Parsed>)}>
      <option value="">Без проекта</option>
      {projOpts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
    </select>
  );
  const peopleChips = (p.type === 'task' || p.type === 'event') && people.length > 0 && (
    <div className="pv-row">
      <span className="mini">Для:</span>
      <span className="chip" aria-pressed="true" style={{ padding: '5px 10px', fontSize: 13 }}>Я</span>
      {people.map((x) => {
        const on = (p.people || []).includes(x.id);
        return <button key={x.id} type="button" className="chip" aria-pressed={on} style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => onChange({ people: on ? (p.people || []).filter((y) => y !== x.id) : [...(p.people || []), x.id] } as Partial<Parsed>)}>{x.name}</button>;
      })}
    </div>
  );
  return (
    <div className="pv-card">
      <div className="pv-top">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span className="pv-type">{TYPE_NAME[p.type]}</span>
          {editable ? <input value={title} aria-label="Название" onChange={(e) => onChange(('title' in p ? { title: e.target.value } : { what: e.target.value }) as Partial<Parsed>)} /> : <b style={{ fontSize: 16 }}>{p.type === 'health' ? (settings.health ?? DEFAULT_HEALTH).find((h) => h.id === p.item_id)?.name + (p.value > 1 ? ` · ${p.value}` : '') : title}</b>}
        </div>
        <button className="x" type="button" aria-label="Убрать" onClick={onRemove}>×</button>
      </div>
      {(p.type === 'task' || p.type === 'note' || p.type === 'event' || p.type === 'wish') && <div className="pv-row">{areaSel}{projSel}</div>}
      {p.type === 'task' && (
        <div className="pv-row">
          <input type="date" aria-label="Срок" value={p.date ?? ''} onChange={(e) => onChange({ date: e.target.value || null })} />
          <input type="time" aria-label="Время" value={p.time ?? ''} onChange={(e) => onChange({ time: e.target.value || null })} />
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!p.calendar} disabled={!p.date} onChange={(e) => onChange({ calendar: e.target.checked })} /> в календарь</label>
        </div>
      )}
      {p.type === 'event' && (
        <div className="pv-row">
          <input type="date" aria-label="Дата" value={p.date} onChange={(e) => onChange({ date: e.target.value })} />
          <input type="time" aria-label="Начало" value={p.start ?? ''} onChange={(e) => onChange({ start: e.target.value || null })} />
          <span className="mini">{[p.start ? null : 'весь день', p.repeat ? REPEAT[p.repeat] : null, p.remind ? `напомнить ${REMIND[p.remind]}` : null].filter(Boolean).join(' · ')}</span>
        </div>
      )}
      {peopleChips}
      {p.type === 'expense' && (
        <div className="pv-row">
          <input type="number" inputMode="numeric" aria-label="Сумма" value={p.amount} style={{ width: 110 }} onChange={(e) => onChange({ amount: Number(e.target.value) || 0 })} />
          <select aria-label="Категория" value={p.category} onChange={(e) => onChange({ category: e.target.value })}>{(settings.spendCats?.length ? settings.spendCats : DEFAULT_SPEND_CATS).map((c) => <option key={c}>{c}</option>)}</select>
          <span className="mini">{money(p.amount)} · {dateLabel(p.date)}</span>
        </div>
      )}
      {p.type === 'income' && (
        <div className="pv-row">
          <input type="number" inputMode="numeric" aria-label="Сумма" value={p.amount} style={{ width: 110 }} onChange={(e) => onChange({ amount: Number(e.target.value) || 0 })} />
          <select aria-label="Источник" value={p.source} onChange={(e) => onChange({ source: e.target.value })}>{INCOME_SOURCES.map((c) => <option key={c}>{c}</option>)}</select>
          <span className="mini">+{money(p.amount)} · {dateLabel(p.date)}</span>
        </div>
      )}
      {p.type === 'income' && (
        <div className="pv-row">
          <span className="mini">Куда:</span>
          <select aria-label="Куда направить" value={p.target || 'live'} onChange={(e) => onChange({ target: e.target.value as 'live' | 'reserve' | 'wish' })}>
            <option value="live">на жизнь сейчас</option>
            <option value="reserve">в резерв на будущие платежи</option>
            {wishes.some((w) => w.status !== 'done') && <option value="wish">в копилку желания</option>}
          </select>
          {p.target === 'wish' && <select aria-label="Желание" value={p.wish_id || ''} onChange={(e) => onChange({ wish_id: e.target.value || null })}><option value="">выбери желание</option>{wishes.filter((w) => w.status !== 'done').map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}</select>}
        </div>
      )}
      {p.type === 'paid' && (
        <div className="pv-row">
          <input type="number" inputMode="numeric" aria-label="Сумма" value={p.amount} style={{ width: 110 }} onChange={(e) => onChange({ amount: Number(e.target.value) || 0 })} />
          <span className="mini">отмечу оплаченным, попадёт в расходы</span>
        </div>
      )}
    </div>
  );
}

function dateLabel(d: string | null) {
  if (!d) return 'сегодня';
  const x = parseIso(d);
  return `${fmtDate(d)}, ${x.getDate()} ${MON[x.getMonth()]}`;
}
