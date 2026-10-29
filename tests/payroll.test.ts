import { describe, expect, it } from 'vitest';
import { avansForecast, DEFAULT_PAYROLL, monthHours, payDay, vacationPayDate, vacationPayments, zpForecast, type Payroll } from '../src/lib/payroll';

const p: Payroll = { ...DEFAULT_PAYROLL, oklad: 98000, npo: 5000, avgDaily: 6692.28 };

describe('норма часов по графику пн–чт 8,2 ч, пт 7,2 ч (как в расчётных листках)', () => {
  it('совпадает с листками за июнь–сентябрь 2026', () => {
    expect(monthHours('2026-06', p)).toBe(168.2);
    expect(monthHours('2026-07', p)).toBe(183.6);
    expect(monthHours('2026-08', p)).toBe(168.2);
    expect(monthHours('2026-09', p)).toBe(176.4);
  });
});

describe('прогноз выплат', () => {
  it('аванс за июнь — как в листке, до рубля', () => {
    expect(Math.abs(avansForecast('2026-06', p).amount - 64883.85)).toBeLessThan(1.5);
  });
  it('зарплата за июнь при фактическом авансе — точно', () => {
    expect(Math.abs(zpForecast('2026-06', p, 64883.85).amount - 66532.15)).toBeLessThan(0.5);
  });
  it('отпуск в первой половине месяца уменьшает аванс', () => {
    const withVac = { ...p, vacations: [{ start: '2026-11-05', end: '2026-11-13' }] };
    expect(avansForecast('2026-11', withVac).amount).toBeLessThan(avansForecast('2026-11', p).amount / 2);
  });
  it('отпускные платятся в четверг перед отпуском и на зарплату не влияют, отпуск уменьшает только часы', () => {
    const v = { start: '2026-11-05', end: '2026-11-13' };
    expect(vacationPayDate(v)).toBe('2026-10-29');
    const withVac = { ...p, vacations: [v] };
    const pay = vacationPayments(withVac)[0];
    expect(pay.days).toBe(9);
    expect(Math.round(pay.amount)).toBe(Math.round(9 * 6692.28 - Math.round(9 * 6692.28 * 0.13)));
    // Октябрь отработан полностью: остаток 13 ноября как обычно, ~62,8 тыс. при авансе 68 600
    expect(Math.round(zpForecast('2026-10', withVac, 68600).amount)).toBe(Math.round(zpForecast('2026-10', p, 68600).amount));
    expect(zpForecast('2026-10', withVac, 68600).amount).toBeGreaterThan(62000);
    // Ноябрь: отпуск 5–13 ноября уменьшает и аванс, и остаток 11 декабря — но не до нуля
    const a = avansForecast('2026-11', withVac).amount;
    const dec = zpForecast('2026-11', withVac, a).amount;
    expect(dec).toBeLessThan(zpForecast('2026-11', p, avansForecast('2026-11', p).amount).amount + 20000);
    expect(dec).toBeGreaterThan(60000);
  });
  it('лишнее, пришедшее вместе с отпускными, вычитается из расчёта (как в августе 2026)', () => {
    // август: 120 ч из 168,2 + замещение, аванс 66 796,88, вместе с отпускными доплатили 23 252 → 13 сентября ~3 тыс.
    const aug = zpForecast('2026-08', { ...p, vacations: [{ start: '2026-08-24', end: '2026-09-04' }] }, 66796.88, 23252);
    expect(aug.amount).toBeLessThan(6000);
  });
  it('день выплаты переносится на рабочий день раньше', () => {
    expect(payDay('2026-06-28', p)).toBe('2026-06-26');
    expect(payDay('2026-09-13', p)).toBe('2026-09-11');
    expect(payDay('2026-06-13', p)).toBe('2026-06-11');
  });
});
