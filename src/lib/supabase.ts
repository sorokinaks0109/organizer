import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** null — приложение ещё не подключено к Supabase (см. README). */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

/** Вызов серверной функции с токеном входа. Ошибки возвращаются текстом для человека. */
export async function callFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Приложение не подключено к Supabase');
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') { try { const j = await ctx.json(); if (j?.error) msg = j.error; } catch { /* оставляем общее сообщение */ } }
    throw new Error(msg);
  }
  return data as T;
}
