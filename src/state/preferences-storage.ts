/**
 * Preferences persistence: load/save and migrate from bridge or localStorage.
 */

import type { Preferences, MainMenuItem } from './contracts';
import { DEFAULT_PREFERENCES, PREFERENCES_SCHEMA_VERSION } from './contracts';
import { PREFERENCES_STORAGE_KEY } from './constants';
import type { EvenHubBridge } from '../evenhub/bridge';

function migrate(parsed: unknown): Preferences {
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PREFERENCES };
  const p = parsed as Record<string, unknown>;
  const prefs: Preferences = {
    listOrder: { ...DEFAULT_PREFERENCES.listOrder },
    listOrderCustomIds: { ...DEFAULT_PREFERENCES.listOrderCustomIds },
    favoritesIds: Array.isArray(p.favoritesIds) ? (p.favoritesIds as Preferences['favoritesIds']) : [],
    statsVisibility: { ...DEFAULT_PREFERENCES.statsVisibility },
    renames: p.renames && typeof p.renames === 'object' && !Array.isArray(p.renames)
      ? (p.renames as Record<string, string>)
      : {},
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
  };
  if (p.listOrder && typeof p.listOrder === 'object') {
    const lo = p.listOrder as Record<string, string>;
    if (typeof lo.scenes === 'string') prefs.listOrder.scenes = lo.scenes as Preferences['listOrder']['scenes'];
    if (typeof lo.rooms === 'string') prefs.listOrder.rooms = lo.rooms as Preferences['listOrder']['rooms'];
    if (typeof lo.devices === 'string') prefs.listOrder.devices = lo.devices as Preferences['listOrder']['devices'];
    if (typeof lo.favorites === 'string') prefs.listOrder.favorites = lo.favorites as Preferences['listOrder']['favorites'];
    if (typeof lo.main === 'string') prefs.listOrder.main = lo.main as Preferences['listOrder']['main'];
  }
  if (p.listOrderCustomIds && typeof p.listOrderCustomIds === 'object') {
    const loc = p.listOrderCustomIds as Record<string, unknown>;
    if (Array.isArray(loc.scenes)) prefs.listOrderCustomIds.scenes = loc.scenes as string[];
    if (Array.isArray(loc.rooms)) prefs.listOrderCustomIds.rooms = loc.rooms as string[];
    if (Array.isArray(loc.devices)) prefs.listOrderCustomIds.devices = loc.devices as string[];
    if (Array.isArray(loc.favorites)) prefs.listOrderCustomIds.favorites = loc.favorites as string[];
    if (Array.isArray(loc.main)) {
      const valid: MainMenuItem[] = ['scenes', 'devices', 'favorites'];
      prefs.listOrderCustomIds.main = (loc.main as unknown[]).filter((x): x is MainMenuItem =>
        typeof x === 'string' && valid.includes(x as MainMenuItem)
      );
      if (prefs.listOrderCustomIds.main.length === 0) prefs.listOrderCustomIds.main = [...DEFAULT_PREFERENCES.listOrderCustomIds.main];
    }
  }
  if (p.statsVisibility && typeof p.statsVisibility === 'object') {
    const sv = p.statsVisibility as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_PREFERENCES.statsVisibility) as (keyof Preferences['statsVisibility'])[]) {
      if (typeof sv[key] === 'boolean') prefs.statsVisibility[key] = sv[key] as boolean;
    }
  }
  return prefs;
}

export async function getStoredPreferences(hub: EvenHubBridge): Promise<Preferences> {
  let raw: string | null = null;
  try {
    raw = await hub.getLocalStorage(PREFERENCES_STORAGE_KEY);
  } catch {
    // ignore
  }
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return migrate(parsed);
    } catch {
      // fall through to localStorage
    }
  }
  try {
    if (typeof localStorage !== 'undefined') {
      raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw) as unknown;
        return migrate(parsed);
      }
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_PREFERENCES };
}

export async function setStoredPreferences(hub: EvenHubBridge, preferences: Preferences): Promise<void> {
  const raw = JSON.stringify(preferences);
  await hub.setLocalStorage(PREFERENCES_STORAGE_KEY, raw);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(PREFERENCES_STORAGE_KEY, raw);
  } catch {
    // ignore
  }
}
