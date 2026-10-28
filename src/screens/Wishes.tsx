// Карта желаний: мечта → цель (сумма, срок, сколько накоплено) → проект с делами в нужной сфере.
import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { useApp } from '../lib/context';
import { supabase } from '../lib/supabase';
import { saveToWish } from '../lib/moneyActions';
import { fmtDate, money } from '../lib/dates';
import type { Wish } from '../lib/types';
import { Icon, Sheet, sc, useToast } from '../components/ui';

const STATUS: { key: Wish['status']; name: string }[] = [
  { key: 'dream', name: 'Мечты' }, { key: 'active', name: 'Цели' }, { key: 'done', name: 'Сбылось' },
];

/** Картинки лежат в закрытом хранилище, поэтому ссылку на них получаем на час. */
function useImage(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) { setUrl(null); return; }
    let alive = true;
    supabase!.storage.from('files').createSignedUrl(path, 3600).then(({ data }) => { if (alive) setUrl(data?.signedUrl ?? null); });
    return () => { alive = false; };
  }, [path]);
  return url;
}

export function Wishes() {
  const { wishes, areas } = useStore();
  const { openCapture } = useApp();
  const [tab, setTab] = useState<Wish['status']>('dream');
  const [open, setOpen] = useState<Wish | 'new' | null>(null);
  const list = wishes.filter((w) => w.status === tab);
  return (
    <>
      <div className="topbar">
        <div className="hello"><span className="date">Чего хочется</span><h1 className="h">Карта желаний</h1></div>
        <button className="ibtn" type="button" aria-label="Надиктовать желание" style={{ background: 'var(--surface)' }} onClick={() => openCapture(null)}><Icon name="mic" /></button>
      </div>
      <div className="seg seg3" role="tablist">
        {STATUS.map((s) => <button key={s.key} type="button" role="tab" aria-selected={tab === s.key} onClick={() => setTab(s.key)}>{s.name} {wishes.filter((w) => w.status === s.key).length || ''}</button>)}
      </div>
      {!list.length && <div className="empty">{tab === 'dream' ? 'Скажи «хочу в Японию» или добавь картинку — сюда попадает всё, о чём мечтаешь.' : tab === 'active' ? 'Здесь мечты, у которых есть сумма и срок. Открой мечту и нажми «Сделать целью».' : 'Пока пусто. Всё впереди.'}</div>}
      <div className="wishes">
        {list.map((w) => <WishCard key={w.id} w={w} color={areas.find((a) => a.id === w.area_id)?.color} onClick={() => setOpen(w)} />)}
        <button className="tile add" type="button" onClick={() => setOpen('new')}>+ Желание</button>
      </div>
      <WishSheet key={open === 'new' ? 'new' : open?.id ?? 'none'} wish={open === 'new' ? null : open} open={!!open} status={tab} onClose={() => setOpen(null)} />
    </>
  );
}

function WishCard({ w, color, onClick }: { w: Wish; color?: string; onClick: () => void }) {
  const img = useImage(w.image_url);
  const pct = w.target_sum ? Math.min(100, Math.round((w.saved_sum / w.target_sum) * 100)) : null;
  return (
    <button className={'wish' + (w.status === 'done' ? ' done' : '')} type="button" style={sc(color || 'gray')} onClick={onClick}>
      {img ? <img src={img} alt="" /> : <div className="ph">✦</div>}
      <div className="wb">
        <b>{w.title}</b>
        {pct != null && <><div className="bar"><i style={{ width: `${pct}%` }} /></div><span className="mini">{money(w.saved_sum)} из {money(w.target_sum!)}</span></>}
        {w.target_date && <span className="mini">к {fmtDate(w.target_date)}</span>}
      </div>
    </button>
  );
}

function WishSheet({ wish, open, status, onClose }: { wish: Wish | null; open: boolean; status: Wish['status']; onClose: () => void }) {
  const store = useStore();
  const { go } = useApp();
  const toast = useToast();
  const [title, setTitle] = useState(wish?.title || '');
  const [note, setNote] = useState(wish?.note || '');
  const [area, setArea] = useState(wish?.area_id || '');
  const [target, setTarget] = useState(wish?.target_sum ? String(wish.target_sum) : '');
  const [saved, setSaved] = useState(wish ? String(wish.saved_sum || '') : '');
  const [date, setDate] = useState(wish?.target_date || '');
  const [image, setImage] = useState<string | null>(wish?.image_url || null);
  const [busy, setBusy] = useState(false);
  const [put, setPut] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const preview = useImage(image);

  const fields = () => ({
    title: title.trim(), note: note.trim() || null, area_id: area || null, image_url: image,
    target_sum: Number(target) || null, saved_sum: Number(saved) || 0, target_date: date || null,
  });
  const save = async (patch: Partial<Wish> = {}) => {
    if (!title.trim()) return;
    if (wish) await store.update('wishes', { id: wish.id }, { ...fields(), ...patch });
    else await store.insert('wishes', { ...fields(), status, ...patch });
    onClose();
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    const { data: u } = await supabase!.auth.getUser();
    const path = `${u.user!.id}/wishes/${crypto.randomUUID()}-${f.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}`;
    const { error } = await supabase!.storage.from('files').upload(path, f, { contentType: f.type });
    setBusy(false);
    if (error) toast(`Картинка не загрузилась: ${error.message}`); else setImage(path);
  };
  // Цель становится проектом: появляется в сфере, туда можно надиктовывать шаги.
  const toProject = async () => {
    if (!title.trim()) return;
    const goal = [target && `накопить ${money(Number(target))}`, note.trim()].filter(Boolean).join('. ') || null;
    const p = await store.insert('projects', { name: title.trim(), area_id: area || null, goal, due_date: date || null, keywords: [], sort: store.projects.length });
    if (!p) return;
    const w = { ...fields(), status: 'active' as const, project_id: p.id };
    if (wish) await store.update('wishes', { id: wish.id }, w); else await store.insert('wishes', w);
    onClose();
    toast('Проект создан — добавь в него первые шаги');
    if (area) go({ name: 'area', id: area, project: p.id });
  };
  const project = wish?.project_id ? store.projects.find((p) => p.id === wish.project_id) : null;

  return (
    <Sheet open={open} onClose={onClose}>
      <h3>{wish ? 'Желание' : 'Новое желание'}</h3>
      <label className="lbl" style={{ flex: 'none' }}>Что хочу<input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Поездка в Японию" /></label>
      {preview && <img src={preview} alt="" style={{ width: '100%', borderRadius: 14, maxHeight: 280, objectFit: 'contain', background: 'var(--field)' }} />}
      <label className="btn" style={{ textAlign: 'center' }}>
        <Icon name="image" /> {busy ? 'Загружаю…' : image ? 'Заменить картинку' : 'Добавить картинку'}
        <input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
      </label>
      <label className="lbl" style={{ flex: 'none' }}>Зачем, какое оно<textarea className="field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="row">
        <label className="lbl">Сколько нужно<input className="field" type="number" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="₽" /></label>
        <label className="lbl">Уже есть<input className="field" type="number" inputMode="numeric" value={saved} onChange={(e) => setSaved(e.target.value)} placeholder="₽" /></label>
      </div>
      {wish && wish.status !== 'done' && (
        <div className="row">
          <input className="field" style={{ flex: '1 1 120px' }} type="number" inputMode="numeric" placeholder="Сколько отложить, ₽" value={put} onChange={(e) => setPut(e.target.value)} />
          <button className="btn" type="button" disabled={!(Number(put) > 0)} onClick={async () => { await saveToWish(store, wish, Number(put)); toast(`Отложено ${money(Number(put))} — видно в расходах как «Копилка»`); onClose(); }}>Отложить</button>
        </div>
      )}
      <div className="row">
        <label className="lbl">К какому сроку<input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="lbl">Сфера
          <select className="field" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Без сферы</option>
            {store.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </div>
      {project && <button className="btn" type="button" onClick={() => { onClose(); go({ name: 'area', id: project.area_id || area, project: project.id }); }}>Открыть проект «{project.name}»</button>}
      <div className="row">
        <button className="btn primary" type="button" disabled={!title.trim()} onClick={() => save()}>Сохранить</button>
        {wish?.status === 'dream' && <button className="btn" type="button" onClick={() => save({ status: 'active' })}>Сделать целью</button>}
        {!project && wish?.status !== 'done' && <button className="btn" type="button" disabled={!title.trim()} onClick={toProject}>Сделать проектом</button>}
        {wish && wish.status !== 'done' && <button className="btn" type="button" onClick={() => save({ status: 'done' })}>Сбылось ✓</button>}
        {wish?.status === 'done' && <button className="btn" type="button" onClick={() => save({ status: 'active' })}>Вернуть в цели</button>}
        <span style={{ flex: 1 }} />
        {wish && !confirmDel && <button className="btn ghost danger" type="button" onClick={() => setConfirmDel(true)}>Удалить</button>}
        {wish && confirmDel && <button className="btn primary" type="button" style={{ background: 'var(--danger)', color: '#fff' }} onClick={async () => { await store.remove('wishes', { id: wish.id }); onClose(); }}>Точно удалить</button>}
      </div>
    </Sheet>
  );
}
