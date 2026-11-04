import { describe, expect, it, vi } from 'vitest';

// Нейросети уходят короткие метки вместо id; в ответе они должны превратиться обратно в настоящие id.
const sent: Record<string, unknown>[] = [];
vi.mock('../src/lib/supabase', () => ({
  callFn: async (_fn: string, body: Record<string, unknown>) => {
    sent.push(body);
    const areas = body.areas as { id: string; name: string }[];
    const events = body.events as { id: string }[];
    const people = body.people as { id: string }[];
    return { items: [
      { type: 'note', title: 'Размер обуви 37', area_id: areas[0].id, project_id: null },
      { type: 'event_update', event_id: events[0].id, title: null, date: null, start: '11:00', end: null, remind: '15m' },
      { type: 'event', title: 'Кино', area_id: areas[0].id, project_id: null, date: '2099-01-02', start: '19:00', people: [people[0].id] },
    ] };
  },
}));

const { parseVoice } = await import('../src/lib/actions');

describe('короткие метки вместо id', () => {
  it('в запросе нет длинных id, в ответе они восстановлены', async () => {
    const areaId = '11111111-2222-3333-4444-555555555555', personId = '99999999-8888-7777-6666-555555555555';
    const store = { areas: [{ id: areaId, name: 'Семья', keywords: [] }], projects: [], people: [{ id: personId, name: 'Митя' }], items: [], money_months: [], settings: {} };
    const ev = { id: 'abcdefghijklmnopqrstuvwxyz0123456789_20991231T120000Z', title: 'Стоматолог', day: new Date().toISOString().slice(0, 10), time: '10:00', calendarId: 'primary' };
    const out = await parseVoice('тест', store as never, null, [ev as never]);
    const body = JSON.stringify(sent[0]);
    expect(body).not.toContain(areaId);
    expect(body).not.toContain(ev.id);
    expect(out[0]).toMatchObject({ type: 'note', area_id: areaId });
    expect(out[1]).toMatchObject({ type: 'event_update', event_id: ev.id, start: '11:00', remind: '15m' });
    expect(out[2]).toMatchObject({ type: 'event', people: [personId] });
  });
});
