import { describe, it, expect } from 'vitest';
import { serializeListSnapshot, parseListSnapshot, LIST_CACHE_KEY } from './list-cache';
import type { SceneEntry, RoomEntry, DeviceEntry } from './contracts';

// @regression — on-device list cache round-trip + defensive parsing. The
// cache lets the wearer see real items immediately on a slow/backgrounded
// launch instead of placeholders; a bad/stale blob must degrade to "no
// cache" (skip hydration) rather than mis-render.
describe('@regression list-cache', () => {
  const scenes: SceneEntry[] = [{ sceneId: 's1', sceneName: 'Movie' }];
  const rooms: RoomEntry[] = [{ roomId: 'r1', roomName: 'Den' }];
  const devices: DeviceEntry[] = [
    { deviceId: 'd1', deviceName: 'Lamp', supportsSwitch: true },
  ];

  it('round-trips a snapshot', () => {
    const raw = serializeListSnapshot({ scenes, rooms, allDevices: devices });
    const parsed = parseListSnapshot(raw);
    expect(parsed).toEqual({ scenes, rooms, allDevices: devices });
  });

  it('uses a stable bridge-storage key', () => {
    expect(LIST_CACHE_KEY).toBe('smartthings_controls_list_cache');
  });

  it('returns null for missing / empty input', () => {
    expect(parseListSnapshot(null)).toBeNull();
    expect(parseListSnapshot(undefined)).toBeNull();
    expect(parseListSnapshot('')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseListSnapshot('{not json')).toBeNull();
    expect(parseListSnapshot('42')).toBeNull();
    expect(parseListSnapshot('"a string"')).toBeNull();
  });

  it('returns null on schema-version mismatch (stale older build)', () => {
    const stale = JSON.stringify({ v: 999, cachedAt: 0, scenes, rooms, allDevices: devices });
    expect(parseListSnapshot(stale)).toBeNull();
  });

  it('returns null when every list is empty (nothing worth hydrating)', () => {
    const empty = serializeListSnapshot({ scenes: [], rooms: [], allDevices: [] });
    expect(parseListSnapshot(empty)).toBeNull();
  });

  it('tolerates partially-present arrays', () => {
    const raw = serializeListSnapshot({ scenes, rooms: [], allDevices: [] });
    expect(parseListSnapshot(raw)).toEqual({ scenes, rooms: [], allDevices: [] });
  });

  it('coerces non-array fields to empty arrays', () => {
    const weird = JSON.stringify({ v: 1, cachedAt: 0, scenes: 'nope', rooms: null, allDevices: devices });
    expect(parseListSnapshot(weird)).toEqual({ scenes: [], rooms: [], allDevices: devices });
  });
});
