// Код для входа: приложение закрыто кодом при каждом открытии и после минуты в фоне.
// Код хранится только на этом телефоне в виде отпечатка (сам код никуда не записывается).
// Забыла код — выход из аккаунта, вход почтой и паролем, новый код.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';

const KEY = 'org.pin.v1';
const LOCK_AFTER_MS = 60 * 1000;
const LEN = 4;

type Stored = { salt: string; hash: string };
const read = (): Stored | null => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };

async function digest(pin: string, salt: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Сбросить код (в настройках — «Сменить код»): при следующем открытии попросит придумать новый. */
export function resetPin() { try { localStorage.removeItem(KEY); } catch { /* нет хранилища — нечего сбрасывать */ } }

export function PinGate({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<Stored | null>(read);
  const [locked, setLocked] = useState(true);
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    const vis = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > LOCK_AFTER_MS) setLocked(true);
    };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, []);

  const setPin = useCallback(async (pin: string) => {
    const salt = crypto.randomUUID();
    const s = { salt, hash: await digest(pin, salt) };
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* без хранилища код не запомнится */ }
    setStored(s); setLocked(false);
  }, []);

  if (!stored) return <PinPad title="Придумай код для входа" hint="4 цифры. Приложение будет спрашивать его при каждом открытии." confirm onDone={setPin} />;
  if (locked) return <PinPad title="Органайзер" hint="Введи код" check={async (pin) => (await digest(pin, stored.salt)) === stored.hash} onDone={() => setLocked(false)} />;
  return <>{children}</>;
}

function PinPad({ title, hint, confirm, check, onDone }: { title: string; hint: string; confirm?: boolean; check?: (pin: string) => Promise<boolean>; onDone: (pin: string) => void }) {
  const [pin, setPin] = useState('');
  const [first, setFirst] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [fails, setFails] = useState(0);
  const press = async (k: string) => {
    if (k === '⌫') { setPin((x) => x.slice(0, -1)); return; }
    const next = (pin + k).slice(0, LEN);
    setPin(next); setMsg('');
    if (next.length < LEN) return;
    if (confirm) {
      if (!first) { setFirst(next); setPin(''); setMsg('Повтори код'); return; }
      if (first !== next) { setFirst(null); setPin(''); setMsg('Коды не совпали, придумай заново'); return; }
      onDone(next); return;
    }
    if (check && await check(next)) { onDone(next); return; }
    setFails((f) => f + 1); setPin(''); setMsg('Неверный код');
  };
  const forgot = async () => { resetPin(); await supabase?.auth.signOut(); try { localStorage.removeItem('org.cache.v2'); } catch { /* не страшно */ } location.reload(); };
  return (
    <div className="lock">
      <h1 className="h">{title}</h1>
      <span className="muted">{msg || (first ? 'Повтори код' : hint)}</span>
      <div className="lock-dots" aria-label={`Введено ${pin.length} из ${LEN}`}>{Array.from({ length: LEN }, (_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
      <div className="lock-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => k ? <button key={i} type="button" aria-label={k === '⌫' ? 'Стереть' : k} onClick={() => press(k)}>{k}</button> : <span key={i} />)}
      </div>
      {!confirm && fails >= 3 && <button className="btn ghost" type="button" onClick={forgot}>Забыла код — войти заново по почте и паролю</button>}
    </div>
  );
}
