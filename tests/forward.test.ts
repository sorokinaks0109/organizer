import { describe, expect, it } from 'vitest';
import { reserveToLive, saveRowForward } from '../src/lib/moneyActions';
import type { Income, MoneyMonth } from '../src/lib/types';

// Простая замена store: держит таблицы в памяти, snapshot отдаёт текущее состояние.
function fakeStore(months: MoneyMonth[], incomes: Partial<Income>[] = []) {
  const db = { money_months: months, incomes: incomes as Income[], expenses: [] as unknown[] };
  const s = {
    get money_months() { return db.money_months; }, get incomes() { return db.incomes; }, expenses: [], settings: {},
    snapshot: () => db,
    upsert: async (_t: string, row: MoneyMonth) => { db.money_months = [...db.money_months.filter((m) => m.ym !== row.ym), row]; },
    update: async (_t: string, match: { id: string }, patch: Partial<Income>) => { db.incomes = db.incomes.map((i) => (i.id === match.id ? { ...i, ...patch } : i)); },
    remove: async (_t: string, match: { id: string }) => { db.incomes = db.incomes.filter((i) => i.id !== match.id); },
    insert: async (_t: string, row: Partial<Income>) => { const r = { id: 'new', created_at: '', ...row } as Income; db.incomes = [...db.incomes, r]; return r; },
  };
  return { s: s as never, db };
}

describe('постоянные платежи и резерв', () => {
  it('новая сумма страховки — в этом и во всех следующих месяцах', async () => {
    const row = { id: 'ins', name: 'Страхование', sum: 13000, cat: 'Страхование', paid: false };
    const mk = (ym: string): MoneyMonth => ({ ym, income: {}, got: {}, plan: { zp: [{ ...row }] } });
    const { s, db } = fakeStore([mk('2026-10'), mk('2026-12')]);
    await saveRowForward(s, { ym: '2026-11', key: 'zp' }, { ...row, sum: 14500 });
    const sum = (ym: string) => db.money_months.find((m) => m.ym === ym)!.plan.zp![0].sum;
    expect(sum('2026-10')).toBe(13000);
    expect(sum('2026-11')).toBe(14500);
    expect(sum('2026-12')).toBe(14500);
  });
  it('остаток резерва переводится на жизнь', async () => {
    const { s, db } = fakeStore([], [{ id: 'a', amount: 25000, target: 'reserve', source: 'Отпускные', got_on: '2026-10-29', created_at: '' }]);
    expect(await reserveToLive(s, 7000)).toBe(7000);
    expect(db.incomes.find((i) => i.id === 'a')!.amount).toBe(18000);
    expect(db.incomes.find((i) => i.target === 'live')!.amount).toBe(7000);
  });
});
