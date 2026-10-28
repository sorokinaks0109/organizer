// Все данные пользователя: загружаются при входе и обновляются вживую (Supabase Realtime).
// Последняя копия хранится в браузере, чтобы приложение открывалось мгновенно и без сети.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import type { Area, EventLink, Expense, Income, Item, MoneyMonth, Person, Project, Settings, Wish } from './types';

export type Tables = {
  areas: Area[]; projects: Project[]; items: Item[]; event_links: EventLink[]; people: Person[];
  money_months: MoneyMonth[]; expenses: Expense[]; incomes: Income[]; wishes: Wish[];
};
type TableName = keyof Tables;
const TABLES: TableName[] = ['areas', 'projects', 'items', 'event_links', 'people', 'money_months', 'expenses', 'incomes', 'wishes'];
const EMPTY: Tables = { areas: [], projects: [], items: [], event_links: [], people: [], money_months: [], expenses: [], incomes: [], wishes: [] };
const CACHE_KEY = 'org.cache.v1';

type Store = Tables & {
  settings: Settings;
  loaded: boolean;
  online: boolean;
  insert: <T extends TableName>(t: T, row: Partial<Tables[T][number]>) => Promise<Tables[T][number] | null>;
  update: <T extends TableName>(t: T, match: Record<string, string>, patch: Partial<Tables[T][number]>) => Promise<void>;
  remove: (t: TableName, match: Record<string, string>) => Promise<void>;
  upsert: <T extends TableName>(t: T, row: Partial<Tables[T][number]>) => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  reload: () => Promise<void>;
};

const Ctx = createContext<Store | null>(null);
export const useStore = () => { const s = useContext(Ctx); if (!s) throw new Error('StoreProvider missing'); return s; };

function readCache(): { t: Tables; s: Settings } | null {
  try { const raw = localStorage.getItem(CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export function StoreProvider({ userId, children, onError }: { userId: string; children: ReactNode; onError: (m: string) => void }) {
  const cached = readCache();
  const [data, setData] = useState<Tables>(cached?.t ?? EMPTY);
  const [settings, setSettings] = useState<Settings>(cached?.s ?? {});
  const [loaded, setLoaded] = useState(!!cached);
  const [online, setOnline] = useState(navigator.onLine);
  const dataRef = useRef(data); dataRef.current = data;

  const fetchTable = useCallback(async (t: TableName) => {
    const order = t === 'items' || t === 'expenses' || t === 'incomes' || t === 'wishes' ? 'created_at' : t === 'areas' || t === 'projects' || t === 'people' ? 'sort' : null;
    let q = supabase!.from(t).select('*');
    if (order) q = q.order(order, { ascending: true });
    const { data: rows, error } = await q;
    if (error) throw error;
    setData((d) => ({ ...d, [t]: rows ?? [] }));
  }, []);

  const reload = useCallback(async () => {
    try {
      await Promise.all(TABLES.map(fetchTable));
      const { data: s } = await supabase!.from('settings').select('data').maybeSingle();
      setSettings((s?.data as Settings) ?? {});
      setLoaded(true);
    } catch (e) { onError(`Не удалось загрузить данные: ${(e as Error).message}`); }
  }, [fetchTable, onError]);

  useEffect(() => { reload(); }, [reload, userId]);

  useEffect(() => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: data, s: settings })); } catch { /* место в браузере кончилось — не страшно */ }
  }, [data, settings]);

  useEffect(() => {
    const ch = supabase!.channel('org-live');
    for (const t of TABLES) ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => { fetchTable(t).catch(() => {}); });
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, async () => {
      const { data: s } = await supabase!.from('settings').select('data').maybeSingle();
      setSettings((s?.data as Settings) ?? {});
    });
    ch.subscribe();
    const on = () => { setOnline(true); reload(); }, off = () => setOnline(false);
    const vis = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener('online', on); window.addEventListener('offline', off); document.addEventListener('visibilitychange', vis);
    return () => { supabase!.removeChannel(ch); window.removeEventListener('online', on); window.removeEventListener('offline', off); document.removeEventListener('visibilitychange', vis); };
  }, [fetchTable, reload]);

  const fail = useCallback((e: unknown) => { onError(navigator.onLine ? `Не сохранилось: ${(e as Error).message}` : 'Нет интернета — изменение не сохранилось'); }, [onError]);

  const store = useMemo<Store>(() => ({
    ...data, settings, loaded, online, reload,
    insert: async (t, row) => {
      const { data: r, error } = await supabase!.from(t).insert(row as never).select().single();
      if (error) { fail(error); return null; }
      setData((d) => ({ ...d, [t]: [...(d[t] as unknown[]), r] }));
      return r;
    },
    update: async (t, match, patch) => {
      setData((d) => ({ ...d, [t]: (d[t] as Record<string, unknown>[]).map((x) => (Object.entries(match).every(([k, v]) => x[k] === v) ? { ...x, ...patch } : x)) }));
      let q = supabase!.from(t).update(patch as never);
      for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
      const { error } = await q;
      if (error) { fail(error); fetchTable(t).catch(() => {}); }
    },
    remove: async (t, match) => {
      setData((d) => ({ ...d, [t]: (d[t] as Record<string, unknown>[]).filter((x) => !Object.entries(match).every(([k, v]) => x[k] === v)) }));
      let q = supabase!.from(t).delete();
      for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
      const { error } = await q;
      if (error) { fail(error); fetchTable(t).catch(() => {}); }
    },
    upsert: async (t, row) => {
      const { error } = await supabase!.from(t).upsert(row as never);
      if (error) fail(error);
      fetchTable(t).catch(() => {});
    },
    saveSettings: async (patch) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      const { error } = await supabase!.from('settings').upsert({ user_id: userId, data: next });
      if (error) fail(error);
    },
  }), [data, settings, loaded, online, reload, fail, fetchTable, userId]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
