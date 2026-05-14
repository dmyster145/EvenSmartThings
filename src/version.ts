// Single source of truth for the app version. Importing app.json directly
// avoids relying on Vite's `define` mechanism, which substitutes textually at
// build time but can leave the `__APP_VERSION__` token literal in dev mode for
// some module/transformer combinations — leading to a stale "v1.3.0" label
// even after bumping app.json.

import appJson from '../app.json';

export const APP_VERSION: string = (appJson as { version?: string }).version ?? 'dev';
