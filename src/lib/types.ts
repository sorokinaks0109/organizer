export type Color = 'blue' | 'navy' | 'red' | 'green' | 'teal' | 'orange' | 'brown' | 'purple' | 'pink' | 'gray';
export const COLORS: Color[] = ['blue', 'red', 'purple', 'green', 'orange', 'teal', 'brown', 'navy', 'pink', 'gray'];

export type Area = { id: string; name: string; color: Color; keywords: string[]; sort: number };
export type Project = { id: string; area_id: string | null; name: string; goal: string | null; due_date: string | null; done: boolean; keywords: string[]; sort: number };
export type FileRef = { path: string; name: string; type: string };
export type Item = {
  id: string; kind: 'task' | 'note'; title: string; body: string | null; area_id: string | null; project_id: string | null;
  due_date: string | null; due_time: string | null; done: boolean; done_at: string | null; files: FileRef[]; gcal_event_id: string | null; created_at: string;
};
export type EventLink = { event_id: string; area_id: string | null; project_id: string | null; mark: 'went' | 'missed' | null };
export type Person = { id: string; name: string; email: string | null; color: Color; sort: number };
export type PlanRow = { id: string; name: string; sum: number; cat: string; paid: boolean };
export type MoneyMonth = { ym: string; income: { avans?: number; zp?: number }; got: { avans?: boolean; zp?: boolean }; plan: { avans?: PlanRow[]; zp?: PlanRow[]; other?: PlanRow[] } };
export type Expense = { id: string; what: string; amount: number; category: string; wb: boolean; spent_on: string; created_at: string };
export type Income = { id: string; what: string; amount: number; source: string; got_on: string; created_at: string };
export type Wish = { id: string; title: string; note: string | null; image_url: string | null; area_id: string | null; project_id: string | null; target_sum: number | null; saved_sum: number; target_date: string | null; status: 'dream' | 'active' | 'done'; created_at: string };
export type Settings = {
  familyCalendarId?: string;
  wbLimit?: number;
  spendCats?: string[];
  planCats?: string[];
  autoSave?: boolean;
  /** Сферы по умолчанию уже созданы при первом входе. */
  seeded?: boolean;
  subscriptions?: { prefix: string; total: number }[];
};

/** Событие Google Календаря в том виде, в каком его отдаёт функция gcal. */
export type GEvent = {
  id: string; calendarId: string; family: boolean; title: string; link: string;
  start: string; end: string; allDay: boolean; attendees: string[]; fromOrganizer: boolean; recurring: boolean;
};

/** Что вернул разбор голоса. */
export type Parsed =
  | { type: 'task'; title: string; area_id: string | null; project_id: string | null; date: string | null; time: string | null; calendar?: boolean; people?: string[]; remind?: string | null }
  | { type: 'event'; title: string; area_id: string | null; project_id: string | null; date: string; start: string | null; end: string | null; repeat: string | null; remind: string | null; people?: string[] }
  | { type: 'note'; title: string; area_id: string | null; project_id: string | null }
  | { type: 'expense'; what: string; amount: number; category: string; wb?: boolean; date: string | null }
  | { type: 'income'; what: string; amount: number; source: string; date: string | null }
  | { type: 'wish'; title: string; area_id: string | null; target_sum: number | null };

export const DEFAULT_SPEND_CATS = ['Продукты', 'Кафе и доставка', 'Транспорт', 'Красота и уход', 'Одежда и обувь', 'Здоровье', 'Милана', 'Быт и покупки', 'Подарки и помощь', 'Развлечения', 'Прочее'];
export const DEFAULT_PLAN_CATS = ['ЖКХ и связь', 'Страхование', 'Инвестиции', 'Кредиты', 'Обучение моё', 'Милана', 'Балет и секции', 'Здоровье', 'Быт и покупки', 'Отпуск и поездки', 'Подарки и помощь', 'Прочее'];
export const INCOME_SOURCES = ['Премия', 'Заказы', 'Подработка', 'Подарки', 'Возвраты и кешбэк', 'Проценты', 'Прочее'];
