import { describe, expect, it, vi } from 'vitest';

// Нейросеть создаёт новый проект и в той же фразе — дела к нему (new_project вместо project_id).
vi.mock('../src/lib/supabase', () => ({
  callFn: async (_fn: string, body: Record<string, unknown>) => {
    const areas = body.areas as { id: string }[];
    return { items: [
      { type: 'task', title: 'Сделать песню', area_id: areas[0].id, project_id: null, new_project: 'Мультфильм про коллег' },
      { type: 'project', title: 'Мультфильм про коллег', area_id: areas[0].id, status: 'active', note: null },
      { type: 'note', title: 'Персонажи — 5 человек', area_id: null, project_id: null, new_project: 'мультфильм про коллег' },
    ] };
  },
}));

const { parseVoice, saveParsed } = await import('../src/lib/actions');

describe('дела к новому проекту из той же фразы', () => {
  it('привязываются к проекту, созданному при сохранении', async () => {
    const inserted: { t: string; row: Record<string, unknown> }[] = [];
    const store = {
      areas: [{ id: 'area-1', name: 'Проекты', keywords: [] }], projects: [], people: [], items: [], money_months: [], settings: {}, health_log: [],
      insert: async (t: string, row: Record<string, unknown>) => { const r = { id: t === 'projects' ? 'proj-new' : 'x' + inserted.length, ...row }; inserted.push({ t, row: r }); return r; },
    };
    const parsed = await parseVoice('тест', store as never);
    expect(parsed[0]).toMatchObject({ type: 'task', project_id: 'new:Мультфильм про коллег' });
    await saveParsed(parsed, store as never);
    expect(inserted[0].t).toBe('projects');
    const items = inserted.filter((x) => x.t === 'items').map((x) => x.row);
    expect(items).toHaveLength(2);
    expect(items.every((x) => x.project_id === 'proj-new')).toBe(true);
    expect(items[1].area_id).toBe('area-1'); // у заметки сфера взята от проекта
  });
});
