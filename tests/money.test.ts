import { describe, expect, it } from 'vitest';
import { bounds, monthFrom, nextPeriod, periodOf, prevPeriod, reserveState, summarize } from '../src/lib/money';
import type { Expense, Income, MoneyMonth } from '../src/lib/types';

const exp = (p: Partial<Expense>): Expense => ({ id: 'e', what: 'x', amount: 0, category: 'Прочее', wb: false, spent_on: '2026-10-29', created_at: '', kind: 'spend', plan_ref: null, from_reserve: false, ...p });
const inc = (p: Partial<Income>): Income => ({ id: 'i', what: 'x', amount: 0, source: 'Прочее', got_on: '2026-10-29', created_at: '', target: 'live', plan_ref: null, wish_id: null, ...p });

describe('периоды выплат', () => {
  it('определяет период по дате', () => {
    expect(periodOf('2026-10-28')).toEqual({ ym: '2026-10', key: 'avans' });
    expect(periodOf('2026-11-05')).toEqual({ ym: '2026-10', key: 'avans' });
    expect(periodOf('2026-11-13')).toEqual({ ym: '2026-10', key: 'zp' });
    expect(periodOf('2026-11-27')).toEqual({ ym: '2026-10', key: 'zp' });
    expect(periodOf('2026-01-05')).toEqual({ ym: '2025-12', key: 'avans' });
  });
  it('границы периодов', () => {
    expect(bounds({ ym: '2026-10', key: 'avans' })).toEqual({ start: '2026-10-28', end: '2026-11-12' });
    expect(bounds({ ym: '2026-10', key: 'zp' })).toEqual({ start: '2026-11-13', end: '2026-11-27' });
    expect(bounds({ ym: '2026-12', key: 'avans' })).toEqual({ start: '2026-12-28', end: '2027-01-12' });
  });
  it('листает периоды', () => {
    expect(nextPeriod({ ym: '2026-10', key: 'avans' })).toEqual({ ym: '2026-10', key: 'zp' });
    expect(nextPeriod({ ym: '2026-10', key: 'zp' })).toEqual({ ym: '2026-11', key: 'avans' });
    expect(prevPeriod({ ym: '2026-11', key: 'avans' })).toEqual({ ym: '2026-10', key: 'zp' });
  });
});

describe('итог периода', () => {
  const month: MoneyMonth = {
    ym: '2026-10', income: { avans: 64000, zp: 65000 }, got: { avans: true },
    plan: {
      avans: [
        { id: 'a', name: 'ТСЖ', sum: 1700, cat: 'ЖКХ и связь', paid: true, paid_sum: 1850 },
        { id: 'b', name: 'СГК', sum: 6000, cat: 'ЖКХ и связь', paid: false },
        { id: 'c', name: 'Страховка', sum: 14000, cat: 'Страхование', paid: false, reserve: true },
      ],
      zp: [{ id: 'z', name: 'ИИС', sum: 40000, cat: 'Инвестиции', paid: false }, { id: 'y', name: 'Страховки', sum: 26200, cat: 'Страхование', paid: false }],
    },
  };
  it('считает свободные деньги и сумму в день', () => {
    const s = summarize(month, { ym: '2026-10', key: 'avans' }, [exp({ amount: 342 }), exp({ amount: 5000, kind: 'payment' })], [inc({ amount: 10000 })], '2026-10-29');
    expect(s.planned).toBe(7850);          // ТСЖ по факту + СГК, страховка из резерва не считается
    expect(s.paid).toBe(1850);
    expect(s.fromReserve).toBe(14000);
    expect(s.spent).toBe(342);             // оплаченный платёж — не трата
    expect(s.income).toBe(74000);
    expect(s.free).toBe(74000 - 7850 - 342);
    expect(s.days).toBe(16);
    expect(s.daysLeft).toBe(15);
    expect(Math.round(s.perDay)).toBe(Math.round((74000 - 7850 - 342) / 15));
  });
  it('показывает нехватку', () => {
    const s = summarize(month, { ym: '2026-10', key: 'zp' }, [], [], '2026-11-13');
    expect(s.free).toBe(-1200);
    expect(s.perDay).toBe(0);
  });
  it('резерв', () => {
    const r = reserveState([month], [inc({ amount: 80000, target: 'reserve' })]);
    expect(r).toEqual({ put: 80000, allocated: 14000, free: 66000, balance: 80000 });
  });
  it('новый месяц без разовых платежей', () => {
    const m = monthFrom({ ...month, plan: { avans: [...month.plan.avans!, { id: 'o', name: 'Корпоратив', sum: 2750, cat: 'Прочее', paid: true, once: true }] } }, '2026-11');
    expect(m.plan.avans!.map((r) => r.name)).toEqual(['ТСЖ', 'СГК', 'Страховка']);
    expect(m.plan.avans!.every((r) => !r.paid && !r.reserve)).toBe(true);
    // id те же, что в прошлом месяце: правка и удаление строки будущего месяца находят её
    expect(m.plan.avans!.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    // сумма выплат не копируется — её считает прогноз или вводит пользователь
    expect(m.income).toEqual({});
  });
});
