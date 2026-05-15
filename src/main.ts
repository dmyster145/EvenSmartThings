import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { initApp } from './app';
import './styles/app.css';
import { ConfigShell } from './ui/config-shell';

const rootEl = document.getElementById('root');

if (!rootEl) {
  throw new Error('Missing root element');
}

// Mount React asynchronously and start initApp in parallel. The glasses
// don't need the React companion tree to be ready before the bridge work
// starts; previously flushSync forced a synchronous render that loaded
// even-toolkit + Tailwind + ConfigShell on the boot critical path.
// pushDebugLine in app.ts uses live getElementById lookups, so any
// log lines emitted before the panel mounts simply queue in the
// in-memory buffer and flush on the next write once the panel exists.
createRoot(rootEl).render(createElement(ConfigShell));

initApp().catch((err) => {
  console.error('[SmartThingsControls] Failed to initialize:', err);
});
