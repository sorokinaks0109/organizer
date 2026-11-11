// Посещения занятий по абонементу: была, пропуск по уважительной или без, отменили; оплаты абонемента; текст для преподавателя.
// Отметки хранятся в настройках (раньше «была/пропустила» лежали в event_links — их тоже читаем).
import { isCancelled, SUB_NUM, type CalEvent } from './gcal';
import { MON, parseIso, WD } from './dates';
import type { useStore } from './store';

type Store = ReturnType<typeof useStore>;
export type TrainMark = 'went' | 'excused' | 'missed';
export type TrainPay = { id: string; date: string; sum: number | null; note?: string };

export const MARK_NAME: Record<TrainMark, string> = { went: 'была', excused: 'пропуск по уважительной причине', missed: 'пропуск без уважительной причины' };

export function trainMark(store: Pick<Store, 'settings' | 'event_links'>, id: string, title = ''): TrainMark | null {
  const m = store.settings.trainMarks?.[id];
  if (m) return m;
  const old = store.event_links.find((x) => x.event_id === id)?.mark;
  if (old === 'went' || old === 'missed') return old;
  // В названии уже написано «отработка» — была; «пропуск» — пропуск без уважительной, пока не отмечено иначе.
  if (/отработ/i.test(title)) return 'went';
  return /пропуск/i.test(title) ? (/уважит/i.test(title) && !/без уваж/i.test(title) ? 'excused' : 'missed') : null;
}

export async function setTrainMark(store: Store, id: string, mark: TrainMark | null) {
  const all = { ...store.settings.trainMarks };
  if (mark) all[id] = mark; else delete all[id];
  await store.saveSettings({ trainMarks: all });
  // Старая отметка в event_links перебила бы снятую — убираем её.
  if (store.event_links.some((x) => x.event_id === id && x.mark)) await store.update('event_links', { event_id: id }, { mark: null });
}

const dd = (d: string) => { const x = parseIso(d); return `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}`; };

/** Текст для преподавателя: оплаты, каждое занятие со статусом, итог. */
export function attendanceText(list: CalEvent[], mark: (e: CalEvent) => TrainMark | null, pays: TrainPay[], name = 'Балет'): string {
  const lines: string[] = [`${name} — посещения`];
  for (const p of [...pays].sort((a, b) => a.date.localeCompare(b.date))) {
    const x = parseIso(p.date);
    lines.push(`Абонемент оплачен ${x.getDate()} ${MON[x.getMonth()]}${p.sum ? `, ${p.sum.toLocaleString('ru-RU')} ₽` : ''}${p.note ? ` (${p.note})` : ''}`);
  }
  lines.push('');
  const cnt = { went: 0, excused: 0, missed: 0, cancelled: 0, open: 0 };
  for (const e of list) {
    const d = parseIso(e.day), num = e.title.match(SUB_NUM)?.[1];
    let st: string;
    if (isCancelled(e.title)) { st = 'отменено'; cnt.cancelled++; }
    else { const m = mark(e); if (m) { st = MARK_NAME[m]; cnt[m]++; } else { st = 'не отмечено'; cnt.open++; } }
    const note = e.title.match(/\(([^)]*отработ[^)]*)\)/i)?.[1];
    lines.push(`${dd(e.day)} ${WD[d.getDay()]}${e.time ? ' ' + e.time : ''}${num ? ` (№${num})` : ''} — ${st}${note ? ` (${note})` : ''}`);
  }
  lines.push('', `Итого: была ${cnt.went}` + (cnt.excused ? `, по уважительной ${cnt.excused}` : '') + (cnt.missed ? `, без уважительной ${cnt.missed}` : '') + (cnt.cancelled ? `, отменено ${cnt.cancelled}` : '') + (cnt.open ? `, не отмечено ${cnt.open}` : '') + '.');
  return lines.join('\n');
}
