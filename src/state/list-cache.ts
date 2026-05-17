/**
 * On-device list cache.
 *
 * Persists the last-known scenes / rooms / all-devices snapshot to Even bridge
 * storage (the only store that survives WebView restarts on the device —
 * WebView localStorage is wiped between launches). On the next launch we
 * hydrate the store from this snapshot so the wearer sees their REAL items
 * immediately, while the (slow, SDK/Even-bound) live refresh runs in the
 * background. Pure serialize/parse so it's unit-testable; the bridge I/O is
 * done by the caller in app.ts.
 */

import type { SceneEntry, RoomEntry, DeviceEntry } from './contracts';

/** Bridge-storage key. Bump SCHEMA_VERSION if the entry shapes change so a
 *  stale snapshot from an older build is ignored rather than mis-rendered. */
export const LIST_CACHE_KEY = 'smartthings_controls_list_cache';
const SCHEMA_VERSION = 1;

export interface ListSnapshot {
  scenes: SceneEntry[];
  rooms: RoomEntry[];
  allDevices: DeviceEntry[];
}

interface StoredSnapshot extends ListSnapshot {
  v: number;
  cachedAt: number;
}

export function serializeListSnapshot(snapshot: ListSnapshot): string {
  const payload: StoredSnapshot = {
    v: SCHEMA_VERSION,
    cachedAt: Date.now(),
    scenes: snapshot.scenes,
    rooms: snapshot.rooms,
    allDevices: snapshot.allDevices,
  };
  return JSON.stringify(payload);
}

/** Parse a stored snapshot. Returns null on any problem (missing, bad JSON,
 *  wrong schema version, wrong shape, or completely empty) so the caller
 *  simply skips hydration and waits for the live load. */
export function parseListSnapshot(raw: string | null | undefined): ListSnapshot | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const s = parsed as Partial<StoredSnapshot>;
  if (s.v !== SCHEMA_VERSION) return null;
  const scenes = Array.isArray(s.scenes) ? (s.scenes as SceneEntry[]) : [];
  const rooms = Array.isArray(s.rooms) ? (s.rooms as RoomEntry[]) : [];
  const allDevices = Array.isArray(s.allDevices) ? (s.allDevices as DeviceEntry[]) : [];
  // Nothing worth hydrating ⇒ treat as no cache.
  if (scenes.length === 0 && rooms.length === 0 && allDevices.length === 0) {
    return null;
  }
  return { scenes, rooms, allDevices };
}
