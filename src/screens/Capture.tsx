// Большая кнопка «+»: надиктовать что угодно, нейросеть разложит по сферам и проектам, в календарь — что нужно.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { useApp } from '../lib/context';
import { useDictation } from '../lib/voice';
import { imageForAi, lastGroqError, lastProvider, parsedLabel, parseVoice, saveParsed } from '../lib/actions';
const PROVIDER: Record<string, string> = { groq: 'Groq, бесплатно', yandex: 'YandexGPT', claude: 'Claude' };
import { fmtDate, money, parseIso, MON } from '../lib/dates';
import { DEFAULT_HEALTH, DEFAULT_SPEND_CATS, INCOME_SOURCES, PROJECT_STATUS, type Parsed, type ProjectStatus } from '../lib/types';
import { Icon, Sheet, useToast } from '../components/ui';

const TYPE_NAME: Record<Parsed['type'], string> = { task: 'Дело', event: 'Событие в календарь', note: 'Заметка', expense: 'Трата', income: 'Доход', wish: 'Желание', paid: 'Платёж оплачен', health: 'Здоровье', event_update: 'Изменить событие', event_delete: 'Удалить событие', task_update: 'Изменить дело', project: 'Новый проект', project_update: 'Статус проекта' };
const REPEAT: Record<string, string> = { DAILY: 'каждый день', WEEKLY: 'каждую неделю', MONTHLY: 'каждый месяц', YEARLY: 'каждый год' };
const REMIND: Record<string, string> = { now: 'в момент начала', '15m': 'за 15 минут', '30m': 'за 30 минут', hour: 'за час', '2h': 'за 2 часа', day: 'за день', week: 'за неделю', none: 'без напоминания' };
// У события на весь день напоминание бывает только заранее: накануне в 9:00, за 2 дня, за неделю.
const REMIND_ALLDAY: Record<string, string> = { day: 'накануне в 9:00', '2d': 'за 2 дня в 9:00', week: 'за неделю', none: 'без напоминания' };

function RemindSel({ value, allDay, onChange }: { value: string | null; allDay: boolean; onChange: (v: string | null) => void }) {
  const opts = allDay ? REMIND_ALLDAY : REMIND;
  return (
    <select aria-label="Напоминание" value={value && value in opts ? value : ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">🔔 как обычно в календаре</option>
      {Object.entries(opts).map(([k, l]) => <option key={k} value={k}>🔔 {l}</option>)}
    </select>
  );
}

// Черновик записи: если телефон выгрузил страницу до «Сохранить», при следующем открытии всё вернётся.
const DRAFT = 'org.capture.draft';
type Draft = { text: string; items: Parsed[] | null; at: number };
export function readDraft(): Draft | null {
  try { const d = JSON.parse(localStorage.getItem(DRAFT) || 'null') as Draft | null; return d && Date.now() - d.at < 2 * 864e5 && (d.text.trim() || d.items?.length) ? d : null; } catch { return null; }
}
const clearDraft = () => { try { localStorage.removeItem(DRAFT); } catch { /* нет хранилища */ } };

export function Capture({ open, onClose, preferArea }: { open: boolean; onClose: () => void; preferArea?: string | null }) {
  const store = useStore();
  const { events, refreshEvents } = useApp();
  const toast = useToast();
  const [draft] = useState(() => (open ? readDraft() : null));
  const [text, setText] = useState(draft?.text ?? '');
  const [items, setItems] = useState<Parsed[] | null>(draft?.items ?? null);
  useEffect(() => {
    if (!open) return;
    try { if (text.trim() || items?.length) localStorage.setItem(DRAFT, JSON.stringify({ text, items, at: Date.now() })); else localStorage.removeItem(DRAFT); } catch { /* без черновика */ }
  }, [open, text, items]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [image, setImage] = useState<{ data: string; mime: string; preview: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Текст держим и в ref: после остановки записи разбор должен получить всё распознанное, не дожидаясь перерисовки.
  const textRef = useRef(text);
  const setBoth = (t: string) => { textRef.current = t; setText(t); };
  const dict = useDictation((t) => setBoth((textRef.current ? textRef.current.replace(/\s*$/, ' ') : '') + t), store.settings.voice === 'browser' ? 'browser' : 'yandex');
  // По умолчанию диктуем микрофоном клавиатуры: на телефоне он распознаёт русский лучше всего.
  const keyboard = (store.settings.voice ?? 'keyboard') === 'keyboard';

  const close = () => { dict.stop(); clearDraft(); setBoth(''); setItems(null); setErr(null); setImage(null); onClose(); };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr(null); setItems(null);
    try {
      const img = await imageForAi(f);
      setImage(img);
      parse(textRef.current, img); // сразу разбираем; подпись можно дописать и разобрать заново
    } catch (e) { setErr((e as Error).message); }
  };

  const parse = async (t = text, img = image) => {
    if (!t.trim() && !img) return;
    setBusy(true); setErr(null);
    try {
      const res = await parseVoice(t, store, preferArea, events || [], img);
      if (!res.length) { setErr('Не поняла, что записать. Скажи иначе или допиши руками.'); return; }
      if (store.settings.autoSave) { toast(await saveParsed(res, store)); close(); refreshAfter(res); return; }
      setItems(res);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  // Изменения в календаре сразу видны на экране, не дожидаясь обновления раз в 10 минут.
  const refreshAfter = (list: Parsed[]) => { if (list.some((x) => x.type === 'event' || x.type === 'event_update' || x.type === 'event_delete' || (x.type === 'task' && (x.calendar || x.people?.length)))) refreshEvents(); };

  const toggleMic = async () => {
    if (dict.listening) { await dict.stop(); parse(textRef.current); }
    else { setItems(null); dict.start(); }
  };

  const save = async () => {
    if (!items) return;
    setBusy(true);
    const msg = await saveParsed(items, store);
    setBusy(false); toast(msg); close(); refreshAfter(items);
  };

  const patch = (i: number, p: Partial<Parsed>) => setItems((list) => {
    const old = list![i];
    // Переименовали новый проект — дела, привязанные к нему, идут следом.
    const renamed = old.type === 'project' && 'title' in p && p.title !== old.title ? { from: `new:${old.title}`, to: `new:${p.title}` } : null;
    return list!.map((x, j) => {
      if (j === i) return { ...x, ...p } as Parsed;
      if (renamed && 'project_id' in x && x.project_id === renamed.from) return { ...x, project_id: renamed.to } as Parsed;
      return x;
    });
  });
  const newProjects = (items || []).filter((x) => x.type === 'project').map((x) => (x as { title: string }).title);

  return (
    <Sheet open={open} onClose={close}>
      <h3>Что записать?</h3>
      {draft && <span className="alert ok" style={{ margin: 0 }}>Вернула то, что ты не успела сохранить. Проверь и нажми «Сохранить всё» или закрой крестиком, если не нужно.</span>}
      {keyboard ? (
        <p className="kbd-hint">Нажми <b>🎙 на клавиатуре</b> и говори как есть: «поставь мне и Мите в пятницу кино», «к среде отчёт», «такси 342», «перенеси стоматолога на четверг».</p>
      ) : (
        <>
          <button className={'mic' + (dict.listening ? ' on' : '')} type="button" aria-label={dict.listening ? 'Остановить запись' : 'Надиктовать'} onClick={toggleMic}>
            <Icon name={dict.listening ? 'stop' : 'mic'} />
          </button>
          <p className="mini" style={{ textAlign: 'center', margin: 0 }}>
            {dict.listening ? 'Говори. Нажми ещё раз, когда закончишь — разберу сама.' : 'Нажми и говори как есть: «поставь мне и Мите в календарь…», «к среде отчёт», «такси 450».'}
          </p>
          {dict.error && <p className="err">{dict.error}</p>}
        </>
      )}
      <textarea className="field" rows={keyboard ? 4 : 3} autoFocus={keyboard && !items} value={text} onChange={(e) => setBoth(e.target.value)} placeholder={keyboard ? 'Здесь появится текст. Можно и напечатать.' : 'Или напиши здесь'} />
      {(dict.interim || dict.busy) && <div className="interim">{dict.busy ? 'Распознаю…' : dict.interim}</div>}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      {image && (
        <div className="row" style={{ alignItems: 'center' }}>
          <img src={image.preview} alt="Фото для разбора" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10 }} />
          <span className="mini" style={{ flex: 1 }}>{busy ? 'Смотрю, что на фото…' : 'Можно дописать подпись выше («это ВБ», «запись для Миланы») и нажать «Разобрать» ещё раз.'}</span>
          <button className="x" type="button" aria-label="Убрать фото" onClick={() => setImage(null)}>×</button>
        </div>
      )}
      {!items && (
        <div className="row">
          <button className="btn primary" type="button" disabled={busy || (!text.trim() && !image)} onClick={() => parse()}>{busy ? 'Разбираю…' : 'Разобрать'}</button>
          <button className="btn" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>📷 Фото или скрин</button>
          {text && <button className="btn ghost" type="button" onClick={() => setBoth('')}>Очистить</button>}
        </div>
      )}
      {err && <p className="err">{err}</p>}
      {items && (
        <>
          <span className="lbl-t">Проверь и сохрани{lastProvider ? <small className="mini" style={{ fontWeight: 400 }}> · разобрал {PROVIDER[lastProvider] || lastProvider}</small> : null}</span>
          {lastGroqError && <span className="mini" style={{ overflowWrap: 'anywhere' }}>Groq не ответил: {lastGroqError}</span>}
          {items.map((p, i) => <PreviewCard key={i} p={p} newProjects={newProjects} onChange={(x) => patch(i, x)} onRemove={() => setItems(items.filter((_, j) => j !== i))} />)}
          <div className="row">
            <button className="btn primary" type="button" disabled={busy || !items.length} onClick={save}>{busy ? 'Сохраняю…' : 'Сохранить всё'}</button>
            <button className="btn ghost" type="button" onClick={() => setItems(null)}>Назад к тексту</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function PreviewCard({ p, newProjects, onChange, onRemove }: { p: Parsed; newProjects: string[]; onChange: (x: Partial<Parsed>) => void; onRemove: () => void }) {
  const { areas, projects, people, settings, wishes } = useStore();
  const title = parsedLabel(p);
  const editable = p.type !== 'paid' && p.type !== 'health';
  if (p.type === 'project_update') {
    return (
      <div className="pv-card">
        <div className="pv-top">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <span className="pv-type">{TYPE_NAME[p.type]}</span>
            <b style={{ fontSize: 15.5, overflowWrap: 'anywhere' }}>{p.was}</b>
          </div>
          <button className="x" type="button" aria-label="Убрать" onClick={onRemove}>×</button>
        </div>
        <div className="pv-row">
          <select aria-label="Статус" value={p.status ?? ''} onChange={(e) => onChange({ status: (e.target.value || null) as ProjectStatus | null } as Partial<Parsed>)}>
            <option value="">статус без изменений</option>
            {(Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((k) => <option key={k} value={k}>{PROJECT_STATUS[k].name}</option>)}
          </select>
        </div>
        <input value={p.note ?? ''} placeholder="Где сейчас (если меняется)" aria-label="Где сейчас" style={{ border: 0, background: 'var(--surface)', borderRadius: 10, padding: '9px 10px', fontSize: 15 }} onChange={(e) => onChange({ note: e.target.value || null } as Partial<Parsed>)} />
      </div>
    );
  }
  if (p.type === 'event_update' || p.type === 'event_delete' || p.type === 'task_update') {
    const isTask = p.type === 'task_update';
    return (
      <div className="pv-card">
        <div className="pv-top">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <span className="pv-type">{TYPE_NAME[p.type]}</span>
            <b style={{ fontSize: 15.5, overflowWrap: 'anywhere' }}>{p.was}</b>
          </div>
          <button className="x" type="button" aria-label="Убрать" onClick={onRemove}>×</button>
        </div>
        {p.type === 'event_delete' ? <span className="mini">Событие будет удалено из Google Календаря.</span> : (
          <>
            <input value={p.title ?? ''} placeholder="Новое название (если меняется)" aria-label="Новое название" style={{ border: 0, background: 'var(--surface)', borderRadius: 10, padding: '9px 10px', fontSize: 16 }}
              onChange={(e) => onChange({ title: e.target.value || null } as Partial<Parsed>)} />
            <div className="pv-row">
              <span className="mini">{isTask ? 'Срок:' : 'Когда:'}</span>
              <input type="date" aria-label="Новая дата" value={p.date ?? ''} onChange={(e) => onChange({ date: e.target.value || null } as Partial<Parsed>)} />
              <input type="time" aria-label="Новое время" value={(isTask ? p.time : p.start) ?? ''} onChange={(e) => onChange((isTask ? { time: e.target.value || null } : { start: e.target.value || null }) as Partial<Parsed>)} />
              {p.type === 'task_update' && p.done && <span className="mini">· отмечу сделанным</span>}
            </div>
            {p.type === 'event_update' && <div className="pv-row"><RemindSel value={p.remind ?? null} allDay={false} onChange={(v) => onChange({ remind: v } as Partial<Parsed>)} /></div>}
            <span className="mini">Пустые поля не меняются.</span>
          </>
        )}
      </div>
    );
  }
  const areaSel = 'area_id' in p && (
    <select aria-label="Сфера" value={p.area_id ?? ''} onChange={(e) => onChange({ area_id: e.target.value || null, ...('project_id' in p ? { project_id: null } : {}) } as Partial<Parsed>)}>
      <option value="">Без сферы</option>
      {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
  const projOpts = 'project_id' in p && 'area_id' in p ? projects.filter((x) => !x.done && (!p.area_id || x.area_id === p.area_id)) : [];
  const fresh = p.type === 'project' ? [] : newProjects.filter(Boolean);
  const projSel = 'project_id' in p && (projOpts.length > 0 || fresh.length > 0) && (
    <select aria-label="Проект" value={p.project_id ?? ''} onChange={(e) => onChange({ project_id: e.target.value || null } as Partial<Parsed>)}>
      <option value="">Без проекта</option>
      {fresh.map((t) => <option key={'new:' + t} value={'new:' + t}>★ {t} (новый)</option>)}
      {projOpts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
    </select>
  );
  const peopleChips = (p.type === 'task' || p.type === 'event') && people.length > 0 && (
    <div className="pv-row">
      <span className="mini">Для:</span>
      <span className="chip sm" aria-pressed="true">Я</span>
      {people.map((x) => {
        const on = (p.people || []).includes(x.id);
        return <button key={x.id} type="button" className="chip sm" aria-pressed={on} onClick={() => onChange({ people: on ? (p.people || []).filter((y) => y !== x.id) : [...(p.people || []), x.id] } as Partial<Parsed>)}>{x.name}</button>;
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
      {(p.type === 'task' || p.type === 'note' || p.type === 'event' || p.type === 'wish' || p.type === 'project') && <div className="pv-row">{areaSel}{projSel}</div>}
      {p.type === 'project' && (
        <div className="pv-row">
          <select aria-label="Статус" value={p.status} onChange={(e) => onChange({ status: e.target.value as ProjectStatus } as Partial<Parsed>)}>
            {(Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((k) => <option key={k} value={k}>{PROJECT_STATUS[k].name}</option>)}
          </select>
          {p.note && <span className="mini">{p.note}</span>}
        </div>
      )}
      {p.type === 'task' && (
        <div className="pv-row">
          <input type="date" aria-label="Срок" value={p.date ?? ''} onChange={(e) => onChange({ date: e.target.value || null })} />
          <input type="time" aria-label="Время" value={p.time ?? ''} onChange={(e) => onChange({ time: e.target.value || null })} />
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!p.calendar} disabled={!p.date} onChange={(e) => onChange({ calendar: e.target.checked })} /> в календарь</label>
        </div>
      )}
      {p.type === 'task' && p.calendar && p.date && <div className="pv-row"><RemindSel value={p.remind ?? null} allDay={!p.time} onChange={(v) => onChange({ remind: v })} /></div>}
      {p.type === 'event' && (
        <div className="pv-row">
          <input type="date" aria-label="Дата" value={p.date} onChange={(e) => onChange({ date: e.target.value })} />
          <input type="time" aria-label="Начало" value={p.start ?? ''} onChange={(e) => onChange({ start: e.target.value || null })} />
          <span className="mini">{[p.start ? null : 'весь день', p.repeat ? REPEAT[p.repeat] : null].filter(Boolean).join(' · ')}</span>
        </div>
      )}
      {p.type === 'event' && <div className="pv-row"><RemindSel value={p.remind} allDay={!p.start} onChange={(v) => onChange({ remind: v })} /></div>}
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
