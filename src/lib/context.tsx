// Общие для экранов вещи: события Google и открытие окон (дело, событие, «+»).
import { createContext, useContext } from 'react';
import type { CalEvent } from './gcal';
import type { Item } from './types';

export type AppCtx = {
  events: CalEvent[] | null;
  gError: string | null;
  gConnected: boolean | null;
  refreshEvents: () => Promise<void>;
  openItem: (it: Item | null, preset?: Partial<Item>) => void;
  openEvent: (e: CalEvent) => void;
  openCapture: (preferArea?: string | null) => void;
  go: (v: View) => void;
};
export type View =
  | { name: 'today' } | { name: 'areas' } | { name: 'area'; id: string; project?: string | null; tab?: 'deals' | 'notes' }
  | { name: 'money' } | { name: 'reserve' } | { name: 'stats' }
  | { name: 'wishes' } | { name: 'settings' };

export const App = createContext<AppCtx | null>(null);
export const useApp = () => { const a = useContext(App); if (!a) throw new Error('App ctx missing'); return a; };
