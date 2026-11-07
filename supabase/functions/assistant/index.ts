// Разбор надиктованного текста или картинки (чек, скриншот записи): «поставь мне и Мите в календарь…», «такси 450».
// Нейросеть раскладывает фразу на записи и сама выбирает сферу и проект.
// Провайдер — Groq (бесплатно, при отказе — YandexGPT Lite), YandexGPT или Claude; выбор — секрет AI_PROVIDER или какой ключ задан.
import Anthropic from 'npm:@anthropic-ai/sdk@1';
import { handle, json, requireUser, HttpError } from '../_shared/common.ts';

type Ctx = {
  text: string;
  today: string;
  weekday: string;
  areas: { id: string; name: string; keywords?: string[]; projects?: { id: string; name: string; status?: string }[] }[];
  people: { id: string; name: string }[];
  spendCats: string[];
  incomeSources: string[];
  health?: { id: string; name: string; kind: string }[];
  payments?: { id: string; name: string; sum: number }[];
  events?: { id: string; title: string; date: string; time: string }[];
  tasks?: { id: string; title: string; date: string | null }[];
  /** Фото чека или скриншот записи: base64 без префикса data:. */
  image?: { data: string; mime: string } | null;
};

function systemPrompt(c: Ctx): string {
  const areas = c.areas.map((a) => `- ${a.id}: ${a.name}${a.keywords?.length ? ` (подсказки: ${a.keywords.join(', ')})` : ''}${a.projects?.length ? `\n  проекты: ${a.projects.map((p) => `${p.id}: ${p.name}${p.status ? ` [${p.status}]` : ''}`).join('; ')}` : ''}`).join('\n');
  const people = c.people.map((p) => `- ${p.id}: ${p.name}`).join('\n') || '- нет';
  const health = (c.health || []).map((h) => `- ${h.id}: ${h.name}${h.kind === 'count' ? ' (считается штуками)' : ''}`).join('\n') || '- нет';
  const payments = (c.payments || []).map((p) => `- ${p.id}: ${p.name}, ${p.sum} ₽`).join('\n') || '- нет';
  const events = (c.events || []).map((e) => `- ${e.id}: ${e.title} — ${e.date}${e.time ? ' ' + e.time : ''}`).join('\n') || '- нет';
  const tasks = (c.tasks || []).map((t) => `- ${t.id}: ${t.title}${t.date ? ' — ' + t.date : ''}`).join('\n') || '- нет';
  return `Ты разбираешь надиктованный голосом текст для личного органайзера. Сегодня ${c.today}, ${c.weekday}.
Разбей текст на отдельные записи и для каждой сам выбери сферу и, если подходит, проект. Пользователь не хочет потом ничего разбирать вручную, поэтому решай уверенно. Если сферу понять совсем нельзя — area_id null.

Сферы и проекты (id: название):
${areas}

Люди, которым можно ставить события (id: имя). «Мне» — это сам пользователь, его в people не указывай:
${people}

Типы записей:
- task — дело, которое нужно сделать (с датой или без). Если просят «напомнить» или «поставить в календарь» — calendar: true.
- event — событие в календарь, привязанное ко дню или времени: встреча, занятие, день рождения, поездка.
- note — заметка: факт, чтобы помнить (размер, код, показания, идея).
- expense — трата денег. Категории: ${c.spendCats.join(', ')}.
- income — полученные деньги (премия, оплата заказа, подарок). Источники: ${c.incomeSources.join(', ')}. Аванс и зарплату как income не записывай.
- wish — желание, мечта, «хочу когда-нибудь».
- paid — пользователь оплатил платёж из своего плана («оплатила ТСЖ», «заплатила за интернет 1050»). row_id — из списка ниже; amount — если названа сумма, иначе null. Если такого платежа в списке нет, это expense.
- project — новый проект в сфере («добавь проекты: приложение по русскому, мультик на заказ» — каждый отдельной записью). status: "idea" | "active" | "wait" | "done", по умолчанию "active".
- project_update — статус или заметка существующего проекта из списка («по приложению по русскому: доделываю слова», «мультик на паузе, жду ответ заказчика», «блог готов»). status: "idea" | "active" | "wait" | "done" или null, note — коротко где сейчас, или null.
- event_update — исправить, переименовать, перенести СУЩЕСТВУЮЩЕЕ событие календаря или поставить ему напоминание («исправь», «перенеси», «поменяй время», «переименуй», «напомни за час про стоматолога»). event_id — из списка событий ниже. В title, date, start, end, remind указывай только то, что меняется, остальное null.
- event_delete — удалить существующее событие («удали», «убери из календаря», «встречу отменили»). event_id — из списка.
- task_update — изменить существующее дело: перенести (date, time), переименовать (title) или отметить сделанным («сделала…», «готово…» → done: true). item_id — из списка дел.
- health — отметка ежедневного чек-листа здоровья («выпила витамины», «выпила два стакана воды»). value — сколько (для галочки 1).

Неоплаченные платежи текущего периода (id: название, сумма):
${payments}

События календаря (id: название — дата время):
${events}

Открытые дела (id: название — срок):
${tasks}

Если пришло фото или скриншот:
- Чек — одна запись expense на ИТОГОВУЮ сумму чека (не по строчкам), what — магазин или что куплено коротко, категория по содержимому, date — дата с чека, если она не в будущем.
- Скриншот записи (к врачу, на маникюр, на занятие, билет, бронь) — event с датой, временем и местом; адрес и важное (номер записи, что взять) — в title коротко, не выдумывай.
- Скриншот перевода или поступления денег — income или expense по смыслу.
- Если на картинке несколько разных вещей — несколько записей. Подпись пользователя к фото важнее: если он что-то уточнил, делай как сказано.

Если речь о том, что уже есть в списках, — меняй его (event_update, event_delete, task_update), а не создавай новое. Если подходящего нет — создавай новое.

Пункты чек-листа здоровья (id: название):
${health}

Правила:
- В одной фразе часто несколько разных записей. Каждое упоминание денег («такси 342», «заплатила за обед 500») — отдельная запись expense, даже если рядом событие или дело. Ничего не пропускай.
- Дата траты и дохода — когда потратила или получила: обычно сегодня (date: null). Дата события к трате не относится. Будущую дату у траты не ставь.
- Формулируй коротко и по-деловому, сохраняя имена и цифры. Исправь явные ошибки распознавания речи: повторы слов («исправь исправь»), оговорки («20 29 декабря» — это 29 декабря), похожие по звучанию слова. Ничего не выдумывай.
- Относительные даты («завтра», «в пятницу», «к среде», «до 9.11») переводи в YYYY-MM-DD, ближайшую будущую. Время — HH:MM.
- Слова «поставь в календарь», «напомни», «повторять» не включай в название — переводи в поля.
- День рождения — event на весь день (start null), repeat YEARLY, название «🎂 День рождения: Имя». Если перечислено несколько дней рождения — отдельная запись на каждого. Дата — ближайшая будущая, полностью YYYY-MM-DD.
- «Мне и Мите» → people: [id Мити]. «Всей семье» → все люди.
- Отпускные по умолчанию target "reserve" (их откладывают на будущие платежи). Если сказано «отложить на …» про желание — target "wish". Иначе target "live".
- remind: "now" | "15m" | "30m" | "hour" | "2h" | "day" | "week" | null («напомни за 15 минут» → "15m», «за два часа» → "2h", «напомни накануне» → "day"). Если про напоминание не сказано — null (сработает обычное напоминание календаря). repeat: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | null.

Пример. Текст: «поставь с ежегодным повторением дни рождения мама 2 июля сестра Анюта 2 августа».
Ответ: {"items":[{"type":"event","title":"🎂 День рождения: мама","area_id":"<id Дней рождения или Семьи>","project_id":null,"date":"<ближайшее 2 июля>","start":null,"end":null,"repeat":"YEARLY","remind":"day","people":[]},{"type":"event","title":"🎂 День рождения: сестра Анюта","area_id":"<тот же id>","project_id":null,"date":"<ближайшее 2 августа>","start":null,"end":null,"repeat":"YEARLY","remind":"day","people":[]}]}

Пример. Текст: «завтра в 10 стоматолог, напомни за час, и такси сегодня было 342».
Ответ: {"items":[{"type":"event","title":"Стоматолог","area_id":"<id Здоровья>","project_id":null,"date":"<завтра>","start":"10:00","end":null,"repeat":null,"remind":"hour","people":[]},{"type":"expense","what":"Такси","amount":342,"category":"Транспорт","wb":false,"date":null}]}

Ответь только JSON без пояснений:
{"items":[
 {"type":"task","title":"...","area_id":"id"|null,"project_id":"id"|null,"date":"YYYY-MM-DD"|null,"time":"HH:MM"|null,"calendar":false,"people":[],"remind":null},
 {"type":"event","title":"...","area_id":"id"|null,"project_id":"id"|null,"date":"YYYY-MM-DD","start":"HH:MM"|null,"end":"HH:MM"|null,"repeat":null,"remind":null,"people":[]},
 {"type":"note","title":"...","area_id":"id"|null,"project_id":"id"|null},
 {"type":"expense","what":"...","amount":число,"category":"...","wb":false,"date":"YYYY-MM-DD"|null},
 {"type":"income","what":"...","amount":число,"source":"...","date":"YYYY-MM-DD"|null,"target":"live"},
 {"type":"paid","row_id":"id","amount":число|null},
 {"type":"project","title":"...","area_id":"id"|null,"status":"active","note":null},
 {"type":"project_update","project_id":"id","status":"wait"|null,"note":"..."|null},
 {"type":"event_update","event_id":"id","title":"..."|null,"date":"YYYY-MM-DD"|null,"start":"HH:MM"|null,"end":"HH:MM"|null,"remind":null},
 {"type":"event_delete","event_id":"id"},
 {"type":"task_update","item_id":"id","title":"..."|null,"date":"YYYY-MM-DD"|null,"time":"HH:MM"|null,"done":true|null},
 {"type":"health","item_id":"id","value":1},
 {"type":"wish","title":"...","area_id":"id"|null,"target_sum":число|null}
]}`;
}

type Usage = { input: number; output: number };
type AskResult = { text: string; usage: Usage; model: string };

async function askYandex(system: string, text: string, model = Deno.env.get('YANDEX_MODEL') || 'yandexgpt/latest'): Promise<AskResult> {
  const key = Deno.env.get('YANDEX_API_KEY'), folder = Deno.env.get('YANDEX_FOLDER_ID');
  if (!key || !folder) throw new HttpError(500, 'Не заданы YANDEX_API_KEY и YANDEX_FOLDER_ID');
  const res = await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
    method: 'POST',
    headers: { Authorization: `Api-Key ${key}`, 'x-folder-id': folder, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelUri: `gpt://${folder}/${model}`,
      completionOptions: { stream: false, temperature: 0.1, maxTokens: '3000' },
      messages: [{ role: 'system', text: system }, { role: 'user', text }],
    }),
  });
  if (!res.ok) throw new HttpError(502, `YandexGPT ответил ошибкой ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const u = data?.result?.usage ?? {};
  return { text: data?.result?.alternatives?.[0]?.message?.text ?? '', usage: { input: Number(u.inputTextTokens || 0), output: Number(u.completionTokens || 0) }, model };
}

/** Groq, бесплатный тариф (ключ GROQ_API_KEY): Llama 3.3 70B. Дневной лимит небольшой — при отказе разбор уходит в Яндекс. */
async function askGroq(system: string, text: string): Promise<AskResult> {
  const model = Deno.env.get('GROQ_MODEL') || 'llama-3.3-70b-versatile';
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('GROQ_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.1, max_tokens: 3000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: text }] }),
  });
  if (!res.ok) throw new HttpError(502, `Groq ответил ошибкой ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return { text: data?.choices?.[0]?.message?.content ?? '', usage: { input: Number(data?.usage?.prompt_tokens || 0), output: Number(data?.usage?.completion_tokens || 0) }, model };
}

// Примерная цена 1000 токенов в рублях — только для счётчика в логах. Groq на бесплатном тарифе — 0.
const RUB_PER_1K: Record<string, number> = { 'yandexgpt/latest': 1.2, 'yandexgpt/rc': 1.2, 'yandexgpt-lite/latest': 0.2, 'yandexgpt-lite/rc': 0.2 };

type Img = { data: string; mime: string };
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

async function askClaude(system: string, text: string, image?: Img | null): Promise<AskResult> {
  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
  const mime = (IMG_TYPES as readonly string[]).includes(image?.mime || '') ? image!.mime as typeof IMG_TYPES[number] : 'image/jpeg';
  const model = Deno.env.get('CLAUDE_MODEL') || 'claude-opus-5-5';
  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    output_config: { effort: 'low' },
    system,
    messages: [{
      role: 'user',
      content: image
        ? [{ type: 'image', source: { type: 'base64', media_type: mime, data: image.data } }, { type: 'text', text }]
        : text,
    }],
  });
  if (response.stop_reason === 'refusal') throw new HttpError(422, 'Нейросеть отказалась разбирать этот текст');
  return { text: response.content.map((b) => (b.type === 'text' ? b.text : '')).join(''), usage: { input: response.usage?.input_tokens || 0, output: response.usage?.output_tokens || 0 }, model };
}

/** Текст с картинки через Yandex Vision OCR — когда нейросеть Яндекса, которая картинки не читает. */
async function yandexOcr(image: Img): Promise<string> {
  const key = Deno.env.get('YANDEX_API_KEY'), folder = Deno.env.get('YANDEX_FOLDER_ID');
  if (!key || !folder) throw new HttpError(500, 'Не заданы YANDEX_API_KEY и YANDEX_FOLDER_ID');
  const res = await fetch('https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText', {
    method: 'POST',
    headers: { Authorization: `Api-Key ${key}`, 'x-folder-id': folder, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mimeType: image.mime === 'image/png' ? 'PNG' : 'JPEG', languageCodes: ['ru', 'en'], model: 'page', content: image.data }),
  });
  if (!res.ok) throw new HttpError(502, `Распознавание текста на фото не удалось (${res.status}). Нужна роль ai.vision.user у сервисного аккаунта Яндекса или ключ ANTHROPIC_API_KEY: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?.result?.textAnnotation?.fullText ?? '';
}

/** Достаём JSON из ответа, даже если модель обернула его в ``` или добавила слова. */
export function extractJson(raw: string): unknown {
  const s = raw.replace(/```(?:json)?/gi, '');
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new HttpError(502, 'Нейросеть вернула не JSON');
  return JSON.parse(s.slice(start, end + 1));
}

Deno.serve(handle(async (req) => {
  await requireUser(req);
  const ctx = (await req.json()) as Ctx;
  const image = ctx?.image?.data ? ctx.image : null;
  if (!ctx?.text?.trim() && !image) throw new HttpError(400, 'Пустой текст');
  let provider = (Deno.env.get('AI_PROVIDER') || (Deno.env.get('GROQ_API_KEY') ? 'groq' : Deno.env.get('YANDEX_API_KEY') ? 'yandex' : 'claude')).toLowerCase();
  const system = systemPrompt(ctx);
  // Картинку Claude читает сам; если ключа Claude нет — сначала достаём текст с картинки и разбираем его.
  if (image && Deno.env.get('ANTHROPIC_API_KEY')) provider = 'claude';
  if (image && provider !== 'claude') {
    const seen = (await yandexOcr(image)).trim();
    if (!seen) throw new HttpError(422, 'На картинке не нашлось текста');
    ctx.text = `${ctx.text?.trim() ? ctx.text.trim() + '\n\n' : ''}Текст, распознанный на фото или скриншоте:\n${seen.slice(0, 6000)}`;
  } else if (image) {
    ctx.text = ctx.text?.trim() ? `Подпись к картинке: ${ctx.text.trim()}` : 'Разбери, что на картинке.';
  }
  const usage: Usage = { input: 0, output: 0 };
  let rub = 0, model = '';
  const count = (r: AskResult) => { usage.input += r.usage.input; usage.output += r.usage.output; rub += ((r.usage.input + r.usage.output) / 1000) * (RUB_PER_1K[r.model] ?? 0); model = r.model; return r.text; };
  // Groq бесплатный, но с дневным лимитом: если он отказал или ответил не JSON — тот же разбор делает Яндекс (по умолчанию Lite, дешёвая).
  const spareModel = Deno.env.get('YANDEX_FALLBACK_MODEL') || 'yandexgpt-lite/latest';
  let spare = false, groqError = '';
  const ask = async (txt: string): Promise<AskResult> => {
    if (provider === 'claude') return askClaude(system, txt, image);
    if (spare) return askYandex(system, txt, spareModel);
    if (provider !== 'groq') return askYandex(system, txt);
    try { const r = await askGroq(system, txt); extractJson(r.text); return r; }
    catch (e) {
      if (!Deno.env.get('YANDEX_API_KEY')) throw e;
      groqError = (e as Error).message.replace(/gsk_[A-Za-z0-9]+/g, 'gsk_…').slice(0, 200);
      console.log(`Groq не ответил, разбирает Яндекс: ${groqError}`);
      provider = 'yandex'; spare = true;
      return askYandex(system, txt, spareModel);
    }
  };
  const tryParse = (s: string) => { try { return extractJson(s) as { items?: unknown[] }; } catch { return null; } };
  let raw = count(await ask(ctx.text));
  let maybe = tryParse(raw);
  // Lite иногда пишет сломанный JSON — тогда тот же разбор делает основная модель Яндекса.
  if (!maybe && spare) { spare = false; raw = count(await askYandex(system, ctx.text)); maybe = tryParse(raw); }
  if (!maybe) throw new HttpError(502, `Нейросеть ответила с ошибкой в формате, попробуй ещё раз${groqError ? `. Groq не ответил: ${groqError}` : ''}`);
  let parsed = maybe;
  // Пустой ответ — переспрашиваем один раз: модель иногда «теряется» на длинных списках.
  if (!Array.isArray(parsed.items) || !parsed.items.length) {
    const again = count(await ask(provider === 'claude' ? ctx.text : `${ctx.text}\n\n(Разбери этот текст на записи. Ответь JSON, в items должна быть хотя бы одна запись.)`));
    try { parsed = extractJson(again) as { items?: unknown[] }; } catch { /* оставляем первый ответ */ }
  }
  const items = Array.isArray(parsed.items) ? parsed.items : Array.isArray(parsed) ? parsed as unknown[] : [];
  // Счётчик расхода — в логах функции в Supabase: сколько токенов и примерно рублей ушло на разбор.
  const approxRub = Math.round(rub * 100) / 100;
  console.log(JSON.stringify({ provider, model, ...usage, approxRub }));
  return json({ items, provider, usage, approxRub, groqError: groqError || undefined, raw: items.length ? undefined : raw.slice(0, 400) });
}));
