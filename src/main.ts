import { initApp } from './app';

initApp().catch((err) => {
  console.error('[EvenSmartThings] Failed to initialize:', err);
});
