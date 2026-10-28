// Диктовка как в Claude: говоришь — текст появляется сразу, можно поправить руками.
// Работает в Chrome на Android и компьютере (распознавание речи встроено в браузер).
import { useCallback, useEffect, useRef, useState } from 'react';

type Rec = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
};
const Ctor = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  || (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;

export function useDictation(onText: (finalText: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);
  const wanted = useRef(false);
  const cb = useRef(onText); cb.current = onText;

  const start = useCallback(() => {
    if (!Ctor) { setError('Этот браузер не умеет распознавать речь. Открой приложение в Chrome.'); return; }
    setError(null);
    const r = new Ctor();
    r.lang = 'ru-RU'; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) cb.current(res[0].transcript.trim());
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { setError('Разреши доступ к микрофону в настройках браузера.'); wanted.current = false; }
      else if (e.error !== 'no-speech' && e.error !== 'aborted') setError('Распознавание прервалось, нажми микрофон ещё раз.');
    };
    // Chrome сам останавливает запись после паузы — продолжаем, пока человек не нажал «стоп».
    r.onend = () => { setInterim(''); if (wanted.current) { try { r.start(); } catch { setListening(false); } } else setListening(false); };
    rec.current = r; wanted.current = true;
    try { r.start(); setListening(true); } catch { setError('Не удалось включить микрофон.'); }
  }, []);

  const stop = useCallback(() => { wanted.current = false; rec.current?.stop(); setListening(false); }, []);
  useEffect(() => () => { wanted.current = false; rec.current?.abort(); }, []);

  return { supported: !!Ctor, listening, interim, error, start, stop };
}
