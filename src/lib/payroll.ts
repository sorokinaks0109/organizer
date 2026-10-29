// Прогноз аванса, зарплаты и отпускных по правилам из расчётных листков:
//  • оплата по окладу = оклад × отработанные часы / норма часов месяца по графику;
//  • районный коэффициент и северная надбавка — процент сверху (у Ксении 30 % + 30 %);
//  • НДФЛ 13 % считается отдельно с оклада и с надбавок, каждый округляется до рубля;
//  • аванс (28-го) — за часы с 1 по 15 число, НДФЛ удержан;
//  • расчёт за месяц (13-го следующего) — всё за месяц минус аванс, минус НПО, минус отпускные,
//    выплаченные в этом месяце, плюс отпускные за дни отпуска этого месяца;
//  • отпускные = календарные дни отпуска без праздников × средний дневной заработок − НДФЛ,
//    платятся в четверг перед отпуском.
// Проверено на листках за июнь и август 2026: расхождение — до рубля.
import { addDays, iso, parseIso } from './dates';

export type Vacation = { start: string; end: string };
export type Payroll = {
  oklad: number;
  northPct: number;      // районный коэффициент + северная надбавка, %
  ndflPct: number;
  npo: number;           // негосударственное пенсионное обеспечение, удерживается раз в месяц
  hoursMonThu: number;
  hoursFri: number;
  avgDaily: number;      // средний дневной заработок для отпускных
  vacations: Vacation[];
};

export const DEFAULT_PAYROLL: Payroll = { oklad: 0, northPct: 60, ndflPct: 13, npo: 0, hoursMonThu: 8.2, hoursFri: 7.2, avgDaily: 0, vacations: [] };

// Производственный календарь. 2026 — по постановлению правительства (с переносами).
// Для других лет — праздники по Трудовому кодексу, праздник в выходной переносится на понедельник.
const OFF_2026 = new Set(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
  '2026-02-23', '2026-03-09', '2026-05-01', '2026-05-11', '2026-06-12', '2026-11-04', '2026-12-31']);
const PRE_2026 = new Set(['2026-04-30', '2026-05-08', '2026-06-11', '2026-11-03']);
const FIXED = ['01-01', '01-02', '01-03', '01-04', '01-05', '01-06', '01-07', '01-08', '02-23', '03-08', '05-01', '05-09', '06-12', '11-04'];

const yearCache = new Map<number, { off: Set<string>; pre: Set<string> }>();
function yearCalendar(y: number) {
  if (y === 2026) return { off: OFF_2026, pre: PRE_2026 };
  const hit = yearCache.get(y); if (hit) return hit;
  const off = new Set<string>(), pre = new Set<string>();
  for (const md of FIXED) {
    const d = parseIso(`${y}-${md}`);
    off.add(iso(d));
    if (!md.startsWith('01-0') && (d.getDay() === 0 || d.getDay() === 6)) {
      let x = addDays(d, d.getDay() === 6 ? 2 : 1);
      while (off.has(iso(x))) x = addDays(x, 1);
      off.add(iso(x));
    }
    const before = addDays(d, -1);
    if (before.getDay() !== 0 && before.getDay() !== 6) pre.add(iso(before));
  }
  for (const d of off) pre.delete(d);
  const res = { off, pre }; yearCache.set(y, res); return res;
}

export const isHoliday = (day: string) => yearCalendar(Number(day.slice(0, 4))).off.has(day);

/** Часы по графику в этот день (0 — выходной или праздник). */
export function dayHours(day: string, p: Payroll): number {
  const d = parseIso(day), wd = d.getDay();
  const cal = yearCalendar(d.getFullYear());
  if (wd === 0 || wd === 6 || cal.off.has(day)) return 0;
  const h = wd === 5 ? p.hoursFri : p.hoursMonThu;
  return cal.pre.has(day) ? h - 1 : h;
}

const inVacation = (day: string, v: Vacation[]) => v.some((x) => day >= x.start && day <= x.end);
const daysOfMonth = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
const dayOf = (ym: string, d: number) => `${ym}-${String(d).padStart(2, '0')}`;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

export function monthHours(ym: string, p: Payroll, from = 1, to = 31, excludeVacation = false) {
  let s = 0;
  for (let d = from; d <= Math.min(to, daysOfMonth(ym)); d++) {
    const day = dayOf(ym, d);
    if (excludeVacation && inVacation(day, p.vacations)) continue;
    s += dayHours(day, p);
  }
  return r1(s);
}

/** На руки с начисления по окладу: оклад + надбавки, НДФЛ отдельно с каждой части. */
function netOf(base: number, p: Payroll) {
  const north = r2(base * p.northPct / 100);
  const tax = Math.round(base * p.ndflPct / 100) + Math.round(north * p.ndflPct / 100);
  return { gross: r2(base + north), tax, net: r2(base + north - tax) };
}

/** Отпускные за дни (календарные, без праздников) — на руки. */
function vacationNet(days: number, p: Payroll) {
  const gross = r2(days * p.avgDaily);
  return r2(gross - Math.round(gross * p.ndflPct / 100));
}

/** Дни отпуска внутри месяца (праздники не считаются). */
function vacationDaysIn(ym: string, v: Vacation) {
  let n = 0;
  for (let d = 1; d <= daysOfMonth(ym); d++) { const day = dayOf(ym, d); if (day >= v.start && day <= v.end && !isHoliday(day)) n++; }
  return n;
}
function vacationDaysTotal(v: Vacation) {
  let n = 0;
  for (let d = parseIso(v.start); iso(d) <= v.end; d = addDays(d, 1)) if (!isHoliday(iso(d))) n++;
  return n;
}

/** Отпускные платят в четверг перед началом отпуска. */
export function vacationPayDate(v: Vacation): string {
  let d = addDays(parseIso(v.start), -1);
  while (d.getDay() !== 4) d = addDays(d, -1);
  return iso(d);
}

export type VacationPay = { vacation: Vacation; date: string; days: number; amount: number };
export function vacationPayments(p: Payroll): VacationPay[] {
  if (!p.avgDaily) return [];
  return p.vacations.map((v) => { const days = vacationDaysTotal(v); return { vacation: v, date: vacationPayDate(v), days, amount: vacationNet(days, p) }; })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** День выплаты: 28-е (аванс) или 13-е (зарплата); если выходной или праздник — ближайший рабочий день раньше. */
export function payDay(day: string, p: Payroll): string {
  let d = parseIso(day);
  while (dayHours(iso(d), p) === 0) d = addDays(d, -1);
  return iso(d);
}

export type Forecast = { amount: number; lines: [string, number][] };

export const payrollReady = (p?: Payroll | null): p is Payroll => !!p && p.oklad > 0;

/** Аванс за месяц ym: часы с 1 по 15, без дней отпуска. */
export function avansForecast(ym: string, p: Payroll): Forecast {
  const norm = monthHours(ym, p), h = monthHours(ym, p, 1, 15, true);
  const base = r2(p.oklad * h / norm);
  const n = netOf(base, p);
  return { amount: n.net, lines: [[`Оклад за ${fmtH(h)} ч из ${fmtH(norm)}`, base], [`Надбавки ${p.northPct} %`, r2(n.gross - base)], ['НДФЛ', -n.tax]] };
}

/** Расчёт за месяц ym (платится 13-го следующего месяца). avans — фактический или ожидаемый аванс этого месяца. */
export function zpForecast(ym: string, p: Payroll, avans: number): Forecast {
  const norm = monthHours(ym, p), h = monthHours(ym, p, 1, 31, true);
  const base = r2(p.oklad * h / norm);
  const n = netOf(base, p);
  const lines: [string, number][] = [[`Оклад за ${fmtH(h)} ч из ${fmtH(norm)}`, base], [`Надбавки ${p.northPct} %`, r2(n.gross - base)], ['НДФЛ', -n.tax]];
  let total = n.net;
  for (const v of p.vacations) {
    const days = vacationDaysIn(ym, v);
    if (days && p.avgDaily) { const x = vacationNet(days, p); total += x; lines.push([`Отпуск ${days} дн. в этом месяце`, x]); }
  }
  for (const vp of vacationPayments(p)) if (vp.date.slice(0, 7) === ym) { total -= vp.amount; lines.push([`Отпускные уже выплачены ${parseIso(vp.date).getDate()}-го`, -vp.amount]); }
  if (p.npo) { total -= p.npo; lines.push(['НПО', -p.npo]); }
  total -= avans; lines.push(['Аванс', -avans]);
  return { amount: r2(Math.max(0, total)), lines };
}

const fmtH = (x: number) => String(x).replace('.', ',');
