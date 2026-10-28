// Распознавание речи через Yandex SpeechKit: телефон присылает короткий кусок записи (до 30 секунд),
// функция возвращает текст. Русскую речь SpeechKit распознаёт заметно точнее, чем встроенное в браузер.
import { handle, json, requireUser, HttpError } from '../_shared/common.ts';

const MAX_BYTES = 1024 * 1024; // ограничение SpeechKit для короткого аудио

Deno.serve(handle(async (req) => {
  await requireUser(req);
  const key = Deno.env.get('YANDEX_API_KEY'), folder = Deno.env.get('YANDEX_FOLDER_ID');
  if (!key || !folder) throw new HttpError(500, 'Не заданы YANDEX_API_KEY и YANDEX_FOLDER_ID');
  const audio = new Uint8Array(await req.arrayBuffer());
  if (!audio.length) return json({ text: '' });
  if (audio.length > MAX_BYTES) throw new HttpError(413, 'Слишком длинный кусок записи');
  const url = new URL(req.url);
  const rate = url.searchParams.get('rate') === '8000' ? '8000' : '16000';
  const p = new URLSearchParams({ topic: 'general', lang: 'ru-RU', format: 'lpcm', sampleRateHertz: rate, folderId: folder, profanityFilter: 'false' });
  const res = await fetch(`https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?${p}`, {
    method: 'POST', headers: { Authorization: `Api-Key ${key}` }, body: audio,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(data?.error_message || data?.message || res.status);
    if (res.status === 401 || res.status === 403 || /permission|scope/i.test(msg)) {
      throw new HttpError(403, 'SpeechKit не разрешён для ключа: добавь сервисному аккаунту роль ai.speechkit-stt.user и область yc.ai.speechkitStt.execute у API-ключа');
    }
    throw new HttpError(502, `SpeechKit: ${msg}`);
  }
  return json({ text: String(data?.result || '').trim() });
}));
