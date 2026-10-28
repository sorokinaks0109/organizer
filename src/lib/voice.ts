// Диктовка: говоришь — текст появляется в поле, можно поправить руками.
// Два способа распознавания:
//  • «yandex» — запись идёт в браузере, после каждой паузы кусок уходит в Yandex SpeechKit. Точнее для русского.
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

  // ——— Yandex SpeechKit: запись кусками по паузам ———
  const startYandex = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    const ctx = new w.AudioContext!();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    let chunk: Int16Array[] = [], samples = 0, voiced = false, silent = 0;
    let chain: Promise<void> = Promise.resolve();
    let pending = 0;
    const send = (parts: Int16Array[], len: number) => {
      const pcm = new Int16Array(len); let o = 0;
      for (const p of parts) { pcm.set(p, o); o += p.length; }
      pending++; setBusy(true);
      // Куски распознаются по очереди, чтобы текст шёл в том порядке, в каком говорили.
      chain = chain.then(async () => {
        try { const t = await recognize(pcm); if (t) cb.current(t); }
        catch (e) { setError((e as Error).message); }
        finally { pending--; if (!pending) setBusy(false); }
      });
    };
    const flush = () => { if (voiced && samples) send(chunk, samples); chunk = []; samples = 0; voiced = false; silent = 0; };
    proc.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0);
      let sum = 0; for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      const pcm = toPcm16(input, ctx.sampleRate);
      chunk.push(pcm); samples += pcm.length;
      const dur = input.length / ctx.sampleRate;
      if (rms > 0.012) { voiced = true; silent = 0; } else silent += dur;
      const sec = samples / RATE;
      // Пауза после фразы — отправляем; совсем длинный кусок режем на 25 секундах (лимит SpeechKit — 30).
      if ((voiced && silent >= 0.9 && sec >= 1.2) || sec >= 25) flush();
      // Тишина до начала речи не копится: оставляем последние полсекунды.
      else if (!voiced && sec > 2) { while (samples > RATE / 2 && chunk.length > 1) samples -= chunk.shift()!.length; }
      setInterim(voiced ? 'Слушаю…' : 'Говори');
    };
    src.connect(proc); proc.connect(ctx.destination);
    stopRef.current = async () => {
      proc.onaudioprocess = null;
      flush();
      try { src.disconnect(); proc.disconnect(); } catch { /* уже отключено */ }
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      setInterim('');
      await chain;
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
