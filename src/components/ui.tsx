import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { Color } from '../lib/types';

export const sc = (c: Color | string): CSSProperties => ({ ['--sc' as string]: `var(--c-${c})`, ['--sp' as string]: `var(--p-${c})`, ['--sd' as string]: `var(--d-${c})` });

const P: Record<string, string> = {
  back: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7', more: 'M5 12h.01M12 12h.01M19 12h.01', plus: 'M12 5v14M5 12h14',
  home: 'M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  money: 'M3 7h18v12H3zM3 11h18M16 15h2', star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  stop: 'M7 7h10v10H7z', cal: 'M4.5 6h15v14h-15zM4.5 10.5h15M9 3.5v4M15 3.5v4', send: 'M12 19V5M6 11l6-6 6 6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14', note: 'M5 4h10l4 4v12H5zM15 4v4h4M8.5 12h7M8.5 16h5',
  pen: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', up: 'M12 19V5M6 11l6-6 6 6', down: 'M12 5v14M6 13l6 6 6-6',
  stats: 'M4 20h16M7 20v-6M12 20V8M17 20v-9', image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
};
export function Icon({ name, w = 1.9 }: { name: keyof typeof P | string; w?: number }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={P[name] || ''} fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

// Всплывающее сообщение внизу экрана.
const ToastCtx = createContext<(m: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3400); return () => clearTimeout(t); }, [msg]);
  return <ToastCtx.Provider value={useCallback((m: string) => setMsg(m), [])}>{children}{msg && <div className="toast" role="status">{msg}</div>}</ToastCtx.Provider>;
}

/** Окно, выезжающее снизу. Закрывается по затемнению, крестику и Esc. */
export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="dim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-in">
          <div className="grab" />
          <button className="sheet-x" type="button" aria-label="Закрыть" onClick={onClose}>×</button>
          {children}
        </div>
      </div>
    </>
  );
}

export function Chip({ on, color, onClick, children }: { on?: boolean; color?: Color; onClick?: () => void; children: ReactNode }) {
  return <button type="button" className="chip" style={color ? sc(color) : undefined} aria-pressed={!!on} onClick={onClick}>{color && <i />}{children}</button>;
}

export function Hero({ color, title, onBack, onMenu, children }: { color?: Color; title: string; onBack: () => void; onMenu?: () => void; children?: ReactNode }) {
  return (
    <div className="hero" style={color ? sc(color) : undefined}>
      <div className="hero-top">
        <button className="ibtn" type="button" aria-label="Назад" onClick={onBack}><Icon name="back" /></button>
        {onMenu ? <button className="ibtn" type="button" aria-label="Меню" onClick={onMenu}><Icon name="more" w={3} /></button> : <span />}
      </div>
      <h1 className="h">{title}</h1>
      {children}
    </div>
  );
}
