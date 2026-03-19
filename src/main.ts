import { initApp } from './app';

initApp().catch((err) => {
  console.error('[SmartThingsControls] Failed to initialize:', err);
});
