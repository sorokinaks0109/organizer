# Органайзер

Личное приложение под паролем: дела и заметки по сферам и проектам, Google Календарь, деньги (аванс, зарплата, траты, доходы, итоги), карта желаний. Главное — голос: нажимаешь микрофон, говоришь как есть («поставь мне и Мите в пятницу в 19 кино», «к среде отчёт по УПЦ», «такси 450»), нейросеть сама раскладывает по сферам и проектам и ставит в календарь то, что нужно.

Работает в браузере на телефоне и компьютере, ставится на главный экран как обычное приложение, данные синхронизируются мгновенно.

## Из чего состоит

| Часть | Где живёт | Сколько стоит |
|---|---|---|
| Само приложение | GitHub Pages | бесплатно |
| База, вход по паролю, файлы | Supabase | бесплатно (план Free) |
| Разбор голоса | YandexGPT или Claude | платно, копейки за запись |
| Календарь | Google Календарь напрямую | бесплатно |

Пароль проверяет Supabase. Чужие данные не видны даже при знании адреса: в базе включена защита строк (каждая строка принадлежит своему владельцу). Ключи нейросети и доступ к Google лежат только на сервере.

> На бесплатном плане Supabase проект засыпает, если им не пользоваться неделю. Разбудить — одна кнопка в панели Supabase (Restore). При ежедневном использовании не засыпает.

## Настройка один раз (около 40 минут)

### 1. Supabase — база и вход

1. Зарегистрируйся на [supabase.com](https://supabase.com) → **New project**. Имя `organizer`, придумай пароль базы (сохрани), регион — ближайший (Frankfurt/Stockholm).
2. Слева **SQL Editor** → **New query** → вставь всё содержимое файла [`supabase/schema.sql`](supabase/schema.sql) → **Run**. Должно быть «Success».
3. **Authentication → URL Configuration**:
   - Site URL: `https://sorokinaks0109.github.io/organizer/`
   - Redirect URLs: добавь тот же адрес.
4. **Project Settings → API** (или **API Keys**): понадобятся
   - Project URL — вида `https://abcd1234.supabase.co`; часть `abcd1234` — это **Project ref**;
   - ключ `anon` / `publishable` — его можно показывать, он защищён правилами базы.
5. [Account → Access Tokens](https://supabase.com/dashboard/account/tokens) → **Generate new token** — для автопубликации серверных функций.

### 2. GitHub — переменные и публикация

В репозитории **Settings → Secrets and variables → Actions**:

- вкладка **Variables** → New repository variable:
  - `SUPABASE_URL` — Project URL;
  - `SUPABASE_ANON_KEY` — ключ anon/publishable;
- вкладка **Secrets** → New repository secret:
  - `SUPABASE_ACCESS_TOKEN` — токен из шага 1.5;
  - `SUPABASE_PROJECT_REF` — Project ref.

**Settings → Pages → Source: GitHub Actions.**

Потом **Actions** → «Сайт» → Run workflow, и «Сервер Supabase» → Run workflow. Через пару минут приложение откроется по адресу `https://sorokinaks0109.github.io/organizer/`.

### 3. Нейросеть для голоса

Подойдёт любая из двух. Ключи кладутся в Supabase: **Edge Functions → Secrets** (или **Project Settings → Edge Functions**).

**YandexGPT**

1. [console.yandex.cloud](https://console.yandex.cloud) → создай платёжный аккаунт и каталог (папку). Скопируй **ID каталога**.
2. В каталоге: **Сервисные аккаунты → Создать**, роль `ai.languageModels.user`.
3. Открой аккаунт → **Создать новый ключ → API-ключ**. Скопируй секрет (показывается один раз).
4. Секреты в Supabase:
   - `YANDEX_API_KEY` — секрет ключа;
   - `YANDEX_FOLDER_ID` — ID каталога;
   - `AI_PROVIDER` = `yandex`;
   - по желанию `YANDEX_MODEL` = `yandexgpt-lite/latest` — дешевле, но чаще ошибается с проектами.

**Claude** (если захочется сравнить)

- `ANTHROPIC_API_KEY` — ключ с [console.anthropic.com](https://console.anthropic.com);
- `AI_PROVIDER` = `claude`.

Переключаться можно в любой момент, меняя `AI_PROVIDER`.

### 4. Google Календарь

1. [console.cloud.google.com](https://console.cloud.google.com) → создай проект `Organizer`.
2. **APIs & Services → Library** → найди **Google Calendar API** → Enable.
3. **APIs & Services → OAuth consent screen** (или **Google Auth Platform**):
   - тип **External**, название «Органайзер», своя почта;
   - **Audience → Test users** — добавь свою почту Google.
4. **Credentials → Create credentials → OAuth client ID**:
   - тип **Web application**;
   - Authorized redirect URIs: `https://<Project ref>.supabase.co/functions/v1/gcal`.
   Скопируй **Client ID** и **Client secret**.
5. Секреты в Supabase: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
6. **Важно.** Пока приложение в режиме *Testing*, Google отзывает доступ раз в 7 дней. Чтобы этого не было: **Audience → Publish app**. Проверку от Google проходить не нужно: при подключении Google покажет «Приложение не проверено» → **Дополнительно → Перейти**. Это нормально для личного приложения.

### 5. Первый вход

1. Открой приложение → **Первый вход** → почта и пароль (от 8 символов) → подтверди письмо.
2. Сразу после этого в Supabase: **Authentication → Sign In / Providers → Email** → выключи **Allow new users to sign up**. Теперь больше никто не зарегистрируется.
3. В приложении: шестерёнка → **Подключить Google Календарь**, выбери календарь «Семья», впиши почты Мити и Миланы.
4. Перенос из старого органайзера: шестерёнка → **Перенос из старого органайзера** → файл `organizer-import.json`.

## Как поставить на телефон

- **Android (Chrome):** открой адрес → меню ⋮ → **Установить приложение** (или «Добавить на главный экран»).
- **iPhone (Safari):** открой адрес → **Поделиться** → **На экран «Домой»**.
- **Компьютер (Chrome, Яндекс Браузер, Edge):** значок установки в адресной строке.

Микрофон браузер попросит разрешить один раз. Если на iPhone запись внутри установленного приложения не запускается, нажми микрофон на клавиатуре в поле «Или напиши здесь» — текст разберётся так же.

## Как это устроено

- `src/` — приложение (React + TypeScript + Vite).
  - `screens/Capture.tsx` — запись голосом и проверка того, что разобрала нейросеть.
  - `screens/Today.tsx` — день с перелистыванием: дела, события календаря, дни выплат.
  - `screens/Areas.tsx` — сферы и проекты; в каждой видно и дела, и события календаря.
  - `screens/Sheets.tsx` — карточки дела и события; отметки «была / пропустила», «отменили» с перенумерацией абонемента.
  - `screens/Money.tsx`, `Wishes.tsx`, `Settings.tsx`.
- `supabase/schema.sql` — таблицы и правила доступа.
- `supabase/functions/assistant` — разбор голоса (YandexGPT или Claude).
- `supabase/functions/gcal` — вход в Google, чтение и запись событий.

Какая сфера у события календаря: сначала ручная привязка (в карточке события), потом слова проекта, потом слова сферы («балет» → Тренировки). Слова задаются в меню сферы «⋯» и в карточке проекта.

## Разработка

```bash
npm install
cp .env.example .env.local   # вписать адрес и ключ Supabase
npm run dev
npm test
npm run build
```
