import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { initApp } from './app';
import './styles/app.css';
import { ConfigShell } from './ui/config-shell';

const rootEl = document.getElementById('root');

if (!rootEl) {
  throw new Error('Missing root element');
}

flushSync(() => {
  createRoot(rootEl).render(createElement(ConfigShell));
});

initApp().catch((err) => {
  console.error('[SmartThingsControls] Failed to initialize:', err);
});
