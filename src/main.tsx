import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from './components/ui';
import { Root } from './App';
import './base.css';
import './app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider><Root /></ToastProvider>
  </StrictMode>,
);

// Работа без сети и установка на телефон.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}); });
}
