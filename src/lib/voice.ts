// Диктовка: говоришь — текст появляется в поле, можно поправить руками.
// Два способа распознавания:
//  • «yandex» — запись идёт в браузере, после «стоп» вся фраза уходит в Yandex SpeechKit. Точнее для русского.
//  • «browser» — встроенное распознавание Chrome. Работает без ключей, но чаще ошибается.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

export type VoiceEngine = 'yandex' | 'browser';

type Rec = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
};
const w = (typeof window === 'undefined' ? {} : window) as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec; AudioContext?: typeof AudioContext };
const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
const canRecord = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!w.AudioContext;

/** Текст фразы целиком. Android иногда отдаёт части с нарастанием («написать», «написать Анатолию»), берём самую полную. */
export function phraseText(parts: string[]): string {
  const clean = parts.map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of clean) {
    const last = out[out.length - 1];
    if (last && p.toLowerCase().startsWith(last.toLowerCase())) out[out.length - 1] = p;
    else if (!last || !last.toLowerCase().endsWith(p.toLowerCase())) out.push(p);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

const RATE = 16000;

/** Переводит звук из частоты микрофона в 16 кГц, 16 бит — формат, который принимает SpeechKit. */
export function toPcm16(input: Float32Array, fromRate: number): Int16Array {
  const ratio = fromRate / RATE;
  const n = Math.floor(input.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += input[j];
    const v = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

type Piece = { pcm: Int16Array; len: number; rms: number };
const MAX_SEC = 180;
const VOICE = 0.01;

/** Убирает тишину в начале и в конце записи, оставляя небольшой запас, чтобы не съесть первый и последний звук. */
export function trimSilence<T extends { len: number; rms: number }>(pieces: T[]): T[] {
  const first = pieces.findIndex((p) => p.rms > VOICE);
  if (first < 0) return pieces.reduce((n, p) => n + p.len, 0) > RATE / 2 ? pieces : [];
  let last = pieces.length - 1; while (last > first && pieces[last].rms <= VOICE) last--;
  let a = first, pre = 0; while (a > 0 && pre < RATE * 0.4) { a--; pre += pieces[a].len; }
  let b = last, post = 0; while (b < pieces.length - 1 && post < RATE * 0.6) { b++; post += pieces[b].len; }
  return pieces.slice(a, b + 1);
}

/** Режет запись на части не длиннее max (лимит SpeechKit — 30 секунд) по самому тихому месту. */
export function segment<T extends { len: number; rms: number }>(pieces: T[], max = 25 * RATE, look = 5 * RATE): T[][] {
  const out: T[][] = []; let cur: T[] = []; let n = 0;
  for (const p of pieces) {
    if (n + p.len > max && cur.length) {
      let best = cur.length - 1, acc = 0;
      for (let i = cur.length - 1; i >= 0 && acc < look; i--) { acc += cur[i].len; if (cur[i].rms < cur[best].rms) best = i; }
      out.push(cur.slice(0, best + 1)); cur = cur.slice(best + 1); n = cur.reduce((x, y) => x + y.len, 0);
    }
    cur.push(p); n += p.len;
  }
  if (cur.length) out.push(cur);
  return out;
}

const join = (ps: Piece[]) => { const out = new Int16Array(ps.reduce((n, p) => n + p.len, 0)); let o = 0; for (const p of ps) { out.set(p.pcm, o); o += p.len; } return out; };

async function recognize(pcm: Int16Array): Promise<string> {
  const { data } = await supabase!.auth.getSession();
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/speech?rate=${RATE}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/octet-stream' },
    body: new Blob([pcm.buffer as ArrayBuffer]),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Распознавание: ошибка ${res.status}`);
  return String(j.text || '');
}

export function useDictation(onText: (finalText: string) => void, engine: VoiceEngine = 'yandex') {
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cb = useRef(onText); cb.current = onText;
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const useYandex = engine === 'yandex' && canRecord && !!supabase;

  // ——— Yandex SpeechKit: записываем всю фразу и отправляем целиком после «стоп» ———
  // Целиком — потому что по кускам SpeechKit теряет начало фразы и путает слова на стыках.
  const startYandex = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    // Браузер сам качественно переводит звук в 16 кГц, если попросить такую частоту; не вышло — переводим сами.
    let ctx: AudioContext, src: MediaStreamAudioSourceNode;
    try { ctx = new w.AudioContext!({ sampleRate: RATE }); src = ctx.createMediaStreamSource(stream); }
    catch { ctx = new w.AudioContext!(); src = ctx.createMediaStreamSource(stream); }
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const pieces: Piece[] = [];
    let total = 0;
    proc.onaudioprocess = (ev) => {
      if (total >= MAX_SEC * RATE) return;
      const input = ev.inputBuffer.getChannelData(0);
      let sum = 0; for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const pcm = toPcm16(input, ctx.sampleRate);
      pieces.push({ pcm, len: pcm.length, rms: Math.sqrt(sum / input.length) });
      total += pcm.length;
      const sec = Math.floor(total / RATE);
      setInterim(total >= MAX_SEC * RATE ? 'Запись ограничена 3 минутами — нажми «стоп»' : `Запись ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
    };
    src.connect(proc); proc.connect(ctx.destination);
    stopRef.current = async () => {
      proc.onaudioprocess = null;
      try { src.disconnect(); proc.disconnect(); } catch { /* уже отключено */ }
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      setInterim('');
      const parts = segment(trimSilence(pieces));
      if (!parts.length) return;
      setBusy(true);
      try {
        // Длинная запись режется по самым тихим местам и распознаётся параллельно, порядок сохраняется.
        const texts = await Promise.all(parts.map((ps) => recognize(join(ps))));
        const t = texts.filter(Boolean).join(' ').trim();
        if (t) cb.current(t); else setError('Не расслышала. Говори ближе к телефону или напиши руками.');
      } catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    };
  }, []);

  // ——— Встроенное распознавание Chrome: короткими фразами, чтобы Android не повторял слова ———
  const startBrowser = useCallback(() => {
    if (!Ctor) throw new Error('Этот браузер не умеет распознавать речь. Открой приложение в Chrome.');
    let wanted = true, phrase = '';
    let cur: Rec | null = null;
    const commit = () => { const t = phrase.trim(); phrase = ''; setInterim(''); if (t) cb.current(t); };
    const listen = () => {
      const r = new Ctor();
      r.lang = 'ru-RU'; r.continuous = false; r.interimResults = true; r.maxAlternatives = 1;
      r.onresult = (e) => { phrase = phraseText(Array.from(e.results, (x) => x[0].transcript)); setInterim(phrase); };
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { setError('Разреши доступ к микрофону в настройках браузера.'); wanted = false; }
        else if (e.error !== 'no-speech' && e.error !== 'aborted') setError('Распознавание прервалось, нажми микрофон ещё раз.');
      };
      r.onend = () => {
        if (cur !== r) return;
        commit();
        if (wanted) { try { listen(); return; } catch { /* не вышло перезапустить */ } }
        setListening(false);
      };
      cur = r; r.start();
    };
    listen();
    stopRef.current = async () => { wanted = false; const r = cur; cur = null; commit(); r?.abort(); };
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      if (useYandex) await startYandex(); else startBrowser();
      setListening(true);
    } catch (e) {
      const m = (e as Error).message || '';
      setError(/denied|not allowed|permission/i.test(m) ? 'Разреши доступ к микрофону в настройках браузера.' : m || 'Не удалось включить микрофон.');
    }
  }, [useYandex, startYandex, startBrowser]);

  /** Останавливает запись и ждёт, пока весь сказанный текст распознается. */
  const stop = useCallback(async () => {
    setListening(false);
    const f = stopRef.current; stopRef.current = async () => {};
    await f();
  }, []);

  useEffect(() => () => { stopRef.current().catch(() => {}); }, []);

  return { supported: useYandex || !!Ctor, listening, busy, interim, error, start, stop };
}
