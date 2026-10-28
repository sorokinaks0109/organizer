// Вход по почте и паролю. Регистрация нужна один раз, потом её выключают в Supabase (см. README).
import { useState } from 'react';
import { supabase } from '../lib/supabase';

export function Login() {
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ err: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const mail = email.trim().toLowerCase();
    if (mode === 'in') {
      const { error } = await supabase!.auth.signInWithPassword({ email: mail, password: pass });
      if (error) setMsg({ err: true, text: error.message === 'Invalid login credentials' ? 'Неверная почта или пароль' : error.message });
    } else if (mode === 'up') {
      const { data, error } = await supabase!.auth.signUp({ email: mail, password: pass, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) setMsg({ err: true, text: error.message });
      else if (!data.session) setMsg({ err: false, text: 'Готово. Открой письмо от Supabase и нажми ссылку — после этого войди с этим паролем.' });
    } else {
      const { error } = await supabase!.auth.resetPasswordForEmail(mail, { redirectTo: location.origin + location.pathname });
      setMsg(error ? { err: true, text: error.message } : { err: false, text: 'Письмо со ссылкой отправлено. После входа смени пароль в настройках.' });
    }
    setBusy(false);
  };

  return (
    <form className="login card" onSubmit={submit}>
      <h1 className="h">Органайзер</h1>
      <span className="muted">{mode === 'in' ? 'Войди, чтобы открыть свои дела' : mode === 'up' ? 'Первый вход: придумай пароль' : 'Восстановление пароля'}</span>
      <input className="field" type="email" autoComplete="email" required placeholder="Почта" value={email} onChange={(e) => setEmail(e.target.value)} />
      {mode !== 'reset' && <input className="field" type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} required minLength={8} placeholder="Пароль" value={pass} onChange={(e) => setPass(e.target.value)} />}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Минутку…' : mode === 'in' ? 'Войти' : mode === 'up' ? 'Зарегистрироваться' : 'Прислать ссылку'}</button>
      {msg && <p className={msg.err ? 'err' : 'muted'} style={{ margin: 0 }}>{msg.text}</p>}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {mode !== 'in' && <button className="btn ghost" type="button" onClick={() => setMode('in')}>Уже есть пароль</button>}
        {mode === 'in' && <button className="btn ghost" type="button" onClick={() => setMode('up')}>Первый вход</button>}
        {mode === 'in' && <button className="btn ghost" type="button" onClick={() => setMode('reset')}>Забыла пароль</button>}
      </div>
    </form>
  );
}

/** Показывается, если в сборке нет адреса Supabase. */
export function NotConfigured() {
  return (
    <div className="setup card">
      <h1 className="h">Органайзер ещё не подключён</h1>
      <p>В сборке нет адреса базы. Добавь в GitHub → Settings → Secrets and variables → Actions две переменные: <b>VITE_SUPABASE_URL</b> и <b>VITE_SUPABASE_ANON_KEY</b>, затем перезапусти публикацию. Подробно — в README.</p>
    </div>
  );
}
