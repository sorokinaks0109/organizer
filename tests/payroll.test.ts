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
  it('отпускные платятся в четверг перед отпуском и вычитаются из расчёта того месяца', () => {
    const v = { start: '2026-11-05', end: '2026-11-13' };
    expect(vacationPayDate(v)).toBe('2026-10-29');
    const withVac = { ...p, vacations: [v] };
    const pay = vacationPayments(withVac)[0];
    expect(pay.days).toBe(9);
    expect(Math.round(pay.amount)).toBe(Math.round(9 * 6692.28 - Math.round(9 * 6692.28 * 0.13)));
    const oct = zpForecast('2026-10', withVac, 68000).amount;
    expect(Math.round(zpForecast('2026-10', p, 68000).amount - oct)).toBe(Math.round(pay.amount));
  });
  it('день выплаты переносится на рабочий день раньше', () => {
    expect(payDay('2026-06-28', p)).toBe('2026-06-26');
    expect(payDay('2026-09-13', p)).toBe('2026-09-11');
    expect(payDay('2026-06-13', p)).toBe('2026-06-11');
  });
});
