-- Схема базы «Органайзера». Выполняется один раз в Supabase → SQL Editor → New query → Run.
-- Повторный запуск безопасен: всё создаётся через IF NOT EXISTS / CREATE OR REPLACE.
-- Каждая строка принадлежит пользователю (user_id), чужие строки не видны благодаря RLS.

create extension if not exists pgcrypto;

-- Сферы жизни: Работа, Семья, Здоровье… Слова keywords раскладывают события календаря по сферам.
create table if not exists areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  color text not null default 'blue',
  keywords text[] not null default '{}',
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- Проекты внутри сфер: «УПЦ 2027», «Поступление в аспирантуру». У проекта есть результат и срок.
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  area_id uuid references areas on delete set null,
  name text not null,
  goal text,
  due_date date,
  done boolean not null default false,
  keywords text[] not null default '{}',
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- Дела и заметки. Событие календаря, созданное из органайзера, хранит здесь свою связь (gcal_event_id).
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null default 'task' check (kind in ('task', 'note')),
  title text not null,
  body text,
  area_id uuid references areas on delete set null,
  project_id uuid references projects on delete set null,
  due_date date,
  due_time text,
  done boolean not null default false,
  done_at timestamptz,
  files jsonb not null default '[]',
  gcal_event_id text,
  created_at timestamptz not null default now()
);
create index if not exists items_user_idx on items (user_id, done, due_date);

-- Привязка событий Google Календаря к сферам/проектам и отметки занятий («была», «пропустила»).
create table if not exists event_links (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  event_id text not null,
  area_id uuid references areas on delete set null,
  project_id uuid references projects on delete set null,
  mark text check (mark in ('went', 'missed')),
  primary key (user_id, event_id)
);

-- Люди, которым можно ставить события: Митя, Милана. Почта нужна для приглашений.
create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  email text,
  color text not null default 'teal',
  sort int not null default 0
);

-- Деньги: план месяца (выплаты аванс/зарплата и платежи с них), траты, дополнительные доходы.
create table if not exists money_months (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  ym text not null,
  income jsonb not null default '{}',
  got jsonb not null default '{}',
  plan jsonb not null default '{}',
  primary key (user_id, ym)
);
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  what text not null,
  amount numeric not null,
  category text not null default 'Прочее',
  wb boolean not null default false,
  spent_on date not null default current_date,
  created_at timestamptz not null default now()
);
create table if not exists incomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  what text not null,
  amount numeric not null,
  source text not null default 'Прочее',
  got_on date not null default current_date,
  created_at timestamptz not null default now()
);

-- Карта желаний: мечта → цель с суммой/сроком → проект с шагами.
create table if not exists wishes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  note text,
  image_url text,
  area_id uuid references areas on delete set null,
  project_id uuid references projects on delete set null,
  target_sum numeric,
  saved_sum numeric not null default 0,
  target_date date,
  status text not null default 'dream' check (status in ('dream', 'active', 'done')),
  created_at timestamptz not null default now()
);

-- Настройки одним документом: лимиты, категории трат, календарь «Семья», абонементы и т.п.
create table if not exists settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null default '{}'
);

-- Токены Google хранятся только на сервере: у браузера нет к ним доступа (RLS без политик).
create table if not exists google_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  refresh_token text not null,
  access_token text,
  expires_at timestamptz,
  email text,
  updated_at timestamptz not null default now()
);
create table if not exists oauth_states (
  state text primary key,
  user_id uuid not null references auth.users on delete cascade,
  return_to text,
  created_at timestamptz not null default now()
);

-- RLS: каждый видит и меняет только свои строки.
do $$
declare t text;
begin
  foreach t in array array['areas','projects','items','event_links','people','money_months','expenses','incomes','wishes','settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists own_rows on %I', t);
    execute format('create policy own_rows on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
alter table google_tokens enable row level security;
alter table oauth_states enable row level security;

-- Живое обновление между телефоном и компьютером.
do $$
declare t text;
begin
  foreach t in array array['areas','projects','items','event_links','people','money_months','expenses','incomes','wishes','settings'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Хранилище файлов (фото к делам, картинки желаний): папка = id пользователя.
insert into storage.buckets (id, name, public) values ('files', 'files', false) on conflict (id) do nothing;
drop policy if exists own_files on storage.objects;
create policy own_files on storage.objects for all
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
