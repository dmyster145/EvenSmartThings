/**
 * Ensures Node-like globals (Buffer, util, etc.) exist before the app and @smartthings/core-sdk load.
 * Must be the entry point so these are set before any SDK dependency runs.
 */
import { Buffer } from 'buffer';
import * as util from 'util';

const g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : self);
(g as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
(g as unknown as { util: typeof util }).util = util;

await import('./main');
