// Оболочка: вход, загрузка данных, переключение экранов, нижнее меню и общие окна.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { StoreProvider, useStore } from './lib/store';
import { useGoogleEvents, type CalEvent } from './lib/gcal';
import { App as AppCtxProvider, type View } from './lib/context';
import type { Area, Item } from './lib/types';
import { Icon, useToast } from './components/ui';
import { Login, NotConfigured } from './screens/Login';
import { Today } from './screens/Today';
import { AreaView, Tiles } from './screens/Areas';
import { Money, Reserve, Stats } from './screens/Money';
import { Wishes } from './screens/Wishes';
import { Settings } from './screens/Settings';
import { Capture } from './screens/Capture';
import { EventSheet, ItemSheet } from './screens/Sheets';

export function Root() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const toast = useToast();
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (!supabase) return <NotConfigured />;
  if (session === undefined) return null;
  if (!session) return <Login />;
  return <StoreProvider userId={session.user.id} onError={toast}><Shell /></StoreProvider>;
}

const DEFAULT_AREAS: Pick<Area, 'name' | 'color' | 'keywords'>[] = [
  { name: 'Работа', color: 'blue', keywords: ['упц', 'исм', 'кайдзен'] },
  { name: 'Семья', color: 'purple', keywords: ['стрельб', 'рисован', 'картин', 'мастер-класс', 'мастер класс'] },
  { name: 'Милана', color: 'orange', keywords: ['милан'] },
  { name: 'Аспирантура', color: 'brown', keywords: ['аспирант', 'семинар'] },
  { name: 'Здоровье', color: 'teal', keywords: ['массаж', 'косметолог', 'врач', 'анализ', 'стоматолог', 'клиник'] },
  { name: 'Тренировки', color: 'pink', keywords: ['балет', 'тренировк', 'бассейн', 'фитнес', 'йог', 'растяжк'] },
  { name: 'Проекты', color: 'green', keywords: [] },
  { name: 'Мурфография', color: 'red', keywords: ['мурф'] },
  { name: 'Тренажёр', color: 'navy', keywords: [] },
  { name: 'Дни рождения', color: 'gray', keywords: ['день рождения', '🎂'] },
  { name: 'Разное', color: 'gray', keywords: [] },
];

function Shell() {
  const store = useStore();
  const toast = useToast();
  const g = useGoogleEvents(store.loaded);
  const [view, setView] = useState<View>(() => (history.state as View | null) ?? { name: 'today' });
  const [item, setItem] = useState<{ it: Item | null; preset?: Partial<Item> } | null>(null);
  const [event, setEvent] = useState<CalEvent | null>(null);
  const [capture, setCapture] = useState<{ area: string | null } | null>(null);

  // Кнопка «Назад» на телефоне возвращает на прошлый экран, а не закрывает приложение.
  const go = useCallback((v: View) => { history.pushState(v, ''); setView(v); window.scrollTo(0, 0); }, []);
  useEffect(() => {
    const pop = (e: PopStateEvent) => setView((e.state as View | null) ?? { name: 'today' });
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  // Возврат после подключения Google.
  useEffect(() => {
    const u = new URL(location.href);
    if (u.searchParams.get('google') !== 'ok') return;
    u.searchParams.delete('google');
    history.replaceState(history.state, '', u.pathname + u.search);
    toast('Google Календарь подключён');
    g.refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Первый вход: сферы по умолчанию и семья (почты добавляются в настройках).
  useEffect(() => {
    if (!store.loaded || store.settings.seeded) return;
    (async () => {
      await store.saveSettings({ seeded: true });
      if (store.areas.length) return;
      for (const [i, a] of DEFAULT_AREAS.entries()) await store.insert('areas', { ...a, sort: i });
      if (!store.people.length) {
        await store.insert('people', { name: 'Митя', color: 'navy', sort: 0 });
        await store.insert('people', { name: 'Милана', color: 'pink', sort: 1 });
      }
    })();
  }, [store.loaded, store.settings.seeded]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = useMemo(() => ({
    events: g.events, gError: g.error, gConnected: g.connected, refreshEvents: g.refresh, go,
    openItem: (it: Item | null, preset?: Partial<Item>) => setItem({ it, preset }),
    openEvent: (e: CalEvent) => setEvent(e),
    openCapture: (area?: string | null) => setCapture({ area: area ?? null }),
  }), [g.events, g.error, g.connected, g.refresh, go]);

  const tab = view.name === 'today' || view.name === 'settings' ? 'today'
    : view.name === 'areas' || view.name === 'area' ? 'areas'
    : view.name === 'wishes' ? 'wishes' : 'money';
  const hero = view.name === 'area' || view.name === 'reserve' || view.name === 'stats' || view.name === 'settings';
  const areaForCapture = view.name === 'area' ? view.id : null;

  return (
    <AppCtxProvider.Provider value={ctx}>
      {!store.online && <div className="offline">Нет интернета — показываю сохранённое</div>}
      <div className="app">
        <main id="main" className={hero ? 'has-hero' : undefined}>
          {view.name === 'today' && <Today />}
          {view.name === 'areas' && <><div className="hello"><span className="date">Все сферы жизни</span><h1 className="h">Сферы</h1></div><Tiles /></>}
          {view.name === 'area' && <AreaView key={view.id + (view.project || '')} id={view.id} project={view.project} tab={view.tab} />}
          {view.name === 'money' && <Money />}
          {view.name === 'reserve' && <Reserve />}
          {view.name === 'stats' && <Stats />}
          {view.name === 'wishes' && <Wishes />}
          {view.name === 'settings' && <Settings />}
        </main>
      </div>
      <nav className="nav" aria-label="Разделы">
        <div className="nav-in">
          <NavBtn icon="home" label="Сегодня" on={tab === 'today'} onClick={() => go({ name: 'today' })} />
          <NavBtn icon="grid" label="Сферы" on={tab === 'areas'} onClick={() => go({ name: 'areas' })} />
          <button className="plus" type="button" aria-label="Записать голосом" onClick={() => setCapture({ area: areaForCapture })}><Icon name="mic" /></button>
          <NavBtn icon="money" label="Деньги" on={tab === 'money'} onClick={() => go({ name: 'money' })} />
          <NavBtn icon="star" label="Желания" on={tab === 'wishes'} onClick={() => go({ name: 'wishes' })} />
        </div>
      </nav>
      {item && <ItemSheet key={item.it?.id ?? 'new'} item={item.it} preset={item.preset} onClose={() => setItem(null)} />}
      {event && <EventSheet key={event.id} e={event} onClose={() => setEvent(null)} />}
      <Capture key={capture ? 'open' : 'closed'} open={!!capture} preferArea={capture?.area} onClose={() => setCapture(null)} />
    </AppCtxProvider.Provider>
  );
}

function NavBtn({ icon, label, on, onClick }: { icon: string; label: string; on: boolean; onClick: () => void }) {
  return <button className="tabb" type="button" aria-current={on ? 'page' : undefined} onClick={onClick}><Icon name={icon} />{label}</button>;
}
