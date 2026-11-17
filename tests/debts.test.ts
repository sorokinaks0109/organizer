import { describe, expect, it } from 'vitest';
import { principalOf, schedule } from '../src/lib/debts';

describe('долги', () => {
  it('без процентов: остаток делится на платёж', () => {
    const s = schedule({ balance: 25000, payment: 10000, rate: null }, '2026-11');
    expect(s.map((r) => r.ym)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(s[2]).toMatchObject({ payment: 5000, left: 0 });
  });
  it('с процентами: часть платежа — проценты, остаток уменьшается на остальное', () => {
    const s = schedule({ balance: 100000, payment: 10000, rate: 24 }, '2026-11');
    expect(s[0]).toMatchObject({ interest: 2000, principal: 8000, left: 92000 });
    expect(s[s.length - 1].left).toBe(0);
    expect(principalOf({ balance: 100000, rate: 24 }, 10000)).toBe(8000);
  });
  it('платёж меньше процентов — график пустой', () => {
    expect(schedule({ balance: 100000, payment: 1000, rate: 24 }, '2026-11')).toEqual([]);
  });
});
