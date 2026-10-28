// Диктовка как в Claude: говоришь — текст появляется сразу, можно поправить руками.
// Работает в Chrome на Android и компьютере (распознавание речи встроено в браузер).
// Chrome на Android в непрерывном режиме повторяет уже распознанные слова («написать написать написать»),
// поэтому слушаем короткими фразами: каждая фраза записывается один раз, после паузы запись продолжается сама.
import { useCallback, useEffect, useRef, useState } from 'react';

type Rec = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
};
const w = (typeof window === 'undefined' ? {} : window) as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;

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

export function useDictation(onText: (finalText: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);
  const wanted = useRef(false);
  const phrase = useRef('');
  const cb = useRef(onText); cb.current = onText;

  // Фраза записывается в поле один раз — когда закончилась или когда нажали «стоп».
  const commit = useCallback(() => {
    const t = phrase.current.trim();
    phrase.current = '';
    setInterim('');
    if (t) cb.current(t);
  }, []);

  const listen = useCallback(() => {
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = 'ru-RU'; r.continuous = false; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = (e) => {
      phrase.current = phraseText(Array.from(e.results, (x) => x[0].transcript));
      setInterim(phrase.current);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { setError('Разреши доступ к микрофону в настройках браузера.'); wanted.current = false; }
      else if (e.error !== 'no-speech' && e.error !== 'aborted') setError('Распознавание прервалось, нажми микрофон ещё раз.');
    };
    r.onend = () => {
      if (rec.current !== r) return;
      commit();
      if (wanted.current) { try { listen(); return; } catch { /* не вышло перезапустить */ } }
      setListening(false);
    };
    rec.current = r;
    r.start();
  }, [commit]);

  const start = useCallback(() => {
    if (!Ctor) { setError('Этот браузер не умеет распознавать речь. Открой приложение в Chrome.'); return; }
    setError(null); phrase.current = ''; wanted.current = true;
    try { listen(); setListening(true); } catch { setError('Не удалось включить микрофон.'); }
  }, [listen]);

  const stop = useCallback(() => {
    wanted.current = false;
    const r = rec.current; rec.current = null;
    commit();
    r?.abort();
    setListening(false);
  }, [commit]);

  useEffect(() => () => { wanted.current = false; const r = rec.current; rec.current = null; r?.abort(); }, []);

  return { supported: !!Ctor, listening, interim, error, start, stop };
}
