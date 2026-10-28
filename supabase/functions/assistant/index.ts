// Разбор надиктованного текста: «поставь мне и Мите в календарь…», «купить витамины к среде», «такси 450».
// Нейросеть раскладывает фразу на записи и сама выбирает сферу и проект. Провайдер — YandexGPT или Claude.
import Anthropic from 'npm:@anthropic-ai/sdk@1';
import { handle, json, requireUser, HttpError } from '../_shared/common.ts';

type Ctx = {
  text: string;
  today: string;
  weekday: string;
  areas: { id: string; name: string; keywords?: string[]; projects?: { id: string; name: string }[] }[];
  people: { id: string; name: string }[];
  spendCats: string[];
  incomeSources: string[];
  health?: { id: string; name: string; kind: string }[];
  payments?: { id: string; name: string; sum: number }[];
};

function systemPrompt(c: Ctx): string {
  const areas = c.areas.map((a) => `- ${a.id}: ${a.name}${a.keywords?.length ? ` (подсказки: ${a.keywords.join(', ')})` : ''}${a.projects?.length ? `\n  проекты: ${a.projects.map((p) => `${p.id}: ${p.name}`).join('; ')}` : ''}`).join('\n');
  const people = c.people.map((p) => `- ${p.id}: ${p.name}`).join('\n') || '- нет';
  const health = (c.health || []).map((h) => `- ${h.id}: ${h.name}${h.kind === 'count' ? ' (считается штуками)' : ''}`).join('\n') || '- нет';
  const payments = (c.payments || []).map((p) => `- ${p.id}: ${p.name}, ${p.sum} ₽`).join('\n') || '- нет';
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
- health — отметка ежедневного чек-листа здоровья («выпила витамины», «выпила два стакана воды»). value — сколько (для галочки 1).

Неоплаченные платежи текущего периода (id: название, сумма):
${payments}

Пункты чек-листа здоровья (id: название):
${health}

Правила:
- Формулируй коротко и по-деловому, сохраняя имена и цифры. Исправь явные ошибки распознавания речи. Ничего не выдумывай.
- Относительные даты («завтра», «в пятницу», «к среде», «до 9.11») переводи в YYYY-MM-DD, ближайшую будущую. Время — HH:MM.
- Слова «поставь в календарь», «напомни», «повторять» не включай в название — переводи в поля.
- День рождения — event на весь день, repeat YEARLY, если не сказано иное.
- «Мне и Мите» → people: [id Мити]. «Всей семье» → все люди.
- Отпускные по умолчанию target "reserve" (их откладывают на будущие платежи). Если сказано «отложить на …» про желание — target "wish". Иначе target "live".
- remind: "hour" | "day" | "week" | null. repeat: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | null.

Ответь только JSON без пояснений:
{"items":[
 {"type":"task","title":"...","area_id":"id"|null,"project_id":"id"|null,"date":"YYYY-MM-DD"|null,"time":"HH:MM"|null,"calendar":false,"people":[],"remind":null},
 {"type":"event","title":"...","area_id":"id"|null,"project_id":"id"|null,"date":"YYYY-MM-DD","start":"HH:MM"|null,"end":"HH:MM"|null,"repeat":null,"remind":null,"people":[]},
 {"type":"note","title":"...","area_id":"id"|null,"project_id":"id"|null},
 {"type":"expense","what":"...","amount":число,"category":"...","wb":false,"date":"YYYY-MM-DD"|null},
 {"type":"income","what":"...","amount":число,"source":"...","date":"YYYY-MM-DD"|null,"target":"live"},
 {"type":"paid","row_id":"id","amount":число|null},
 {"type":"health","item_id":"id","value":1},
 {"type":"wish","title":"...","area_id":"id"|null,"target_sum":число|null}
]}`;
}

async function askYandex(system: string, text: string): Promise<string> {
  const key = Deno.env.get('YANDEX_API_KEY'), folder = Deno.env.get('YANDEX_FOLDER_ID');
  if (!key || !folder) throw new HttpError(500, 'Не заданы YANDEX_API_KEY и YANDEX_FOLDER_ID');
  const model = Deno.env.get('YANDEX_MODEL') || 'yandexgpt/latest';
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
  return data?.result?.alternatives?.[0]?.message?.text ?? '';
}

async function askClaude(system: string, text: string): Promise<string> {
  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
  const response = await client.messages.create({
    model: Deno.env.get('CLAUDE_MODEL') || 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'low' },
    system,
    messages: [{ role: 'user', content: text }],
  });
  if (response.stop_reason === 'refusal') throw new HttpError(422, 'Нейросеть отказалась разбирать этот текст');
  return response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
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
  if (!ctx?.text?.trim()) throw new HttpError(400, 'Пустой текст');
  const provider = (Deno.env.get('AI_PROVIDER') || (Deno.env.get('YANDEX_API_KEY') ? 'yandex' : 'claude')).toLowerCase();
  const system = systemPrompt(ctx);
  const raw = provider === 'claude' ? await askClaude(system, ctx.text) : await askYandex(system, ctx.text);
  const parsed = extractJson(raw) as { items?: unknown[] };
  return json({ items: Array.isArray(parsed.items) ? parsed.items : [], provider });
}));
