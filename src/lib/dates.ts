export const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
export const WD_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
export const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const MON_N = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MON_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => iso(new Date());
export const parseIso = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const ymOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const ymShift = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); return ymOf(new Date(y, m - 1 + n, 1)); };
export const ymMonth = (ym: string) => Number(ym.split('-')[1]) - 1;
export const ymTitle = (ym: string) => `${MON_N[ymMonth(ym)]} ${ym.slice(0, 4)}`;
export const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 10, b = Math.abs(n) % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
}

export const money = (n: number) => Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽';

/** «сегодня», «завтра», «чт, 30 октября» — для экрана. */
export function fmtDate(s: string | null | undefined): string {
  if (!s) return '';
  const d = parseIso(s), t = parseIso(todayIso());
  const diff = Math.round((d.getTime() - t.getTime()) / 864e5);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === -1) return 'вчера';
  return `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`;
}

/** «вт, 27 октября» — для распечатки, без «сегодня». */
export function absDate(s: string): string {
  const d = parseIso(s);
  return `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`;
}

/** День события календаря в местном времени (для событий на весь день — сама дата). */
export function eventDay(start: string, allDay: boolean): string {
  return allDay ? start.slice(0, 10) : iso(new Date(start));
}
export function eventTime(start: string, allDay: boolean): string {
  return allDay ? '' : hhmm(new Date(start));
}

export const greeting = (h = new Date().getHours()) => (h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер');
export const uid = () => crypto.randomUUID();
