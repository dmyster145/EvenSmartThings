import { describe, it, expect, vi } from 'vitest';

// composer.ts imports the Even Hub SDK for container builders; mock it so the
// module resolves under node env (mirrors composer.test.ts).
vi.mock('@evenrealities/even_hub_sdk', () => ({
  CreateStartUpPageContainer: vi.fn(),
  RebuildPageContainer: vi.fn(),
  ListContainerProperty: vi.fn(),
  ListItemContainerProperty: vi.fn(),
  ImageContainerProperty: vi.fn(),
  TextContainerProperty: vi.fn(),
}));

import { buildInitialState } from './reducer';
import { getOrderedFavorites } from './selectors';
import { scenesEmptyPlaceholder, getStatsContent } from '../render/composer';
import type { AppState } from './contracts';

// @regression — the cached-list UX: real items show immediately (favorites
// resolve from the hydrated cache), the loading hint lives in the stats box,
// and the scenes list is no longer cluttered with a loading row.

describe('@regression favorites resolve from cache, no inline loading row', () => {
  function stateWithFavorites(partial: Partial<AppState>): AppState {
    const base = buildInitialState();
    return {
      ...base,
      ...partial,
      preferences: {
        ...base.preferences,
        favoritesIds: [
          { type: 'scene', id: 's1' },
          { type: 'device', id: 'd1' },
        ],
        ...(partial.preferences ?? {}),
      },
    };
  }

  it('uses the real name when the scene/device is resolved (from cache or live)', () => {
    const s = stateWithFavorites({
      scenes: [{ sceneId: 's1', sceneName: 'Movie Night' }],
      allDevices: [{ deviceId: 'd1', deviceName: 'Lamp' }],
    });
    const fav = getOrderedFavorites(s);
    expect(fav.find((f) => f.id === 's1')!.displayName).toBe('Movie Night');
    expect(fav.find((f) => f.id === 'd1')!.displayName).toBe('Lamp');
  });

  it('falls back to plain "Scene"/"Device" (no "Loading…") when unresolved', () => {
    const s = stateWithFavorites({ listsRefreshing: true, scenes: [], allDevices: [], devices: [] });
    const fav = getOrderedFavorites(s);
    expect(fav.find((f) => f.id === 's1')!.displayName).toBe('Scene');
    expect(fav.find((f) => f.id === 'd1')!.displayName).toBe('Device');
  });
});

describe('@regression scenesEmptyPlaceholder keys off listsRefreshing', () => {
  it('while refreshing + empty: just the Back row (hint is in the stats box)', () => {
    const s = { ...buildInitialState(), listsRefreshing: true, scenes: [] } as AppState;
    expect(scenesEmptyPlaceholder(s)).toEqual(['← Back']);
  });

  it('settled + empty: "No scenes"', () => {
    const s = { ...buildInitialState(), listsRefreshing: false, scenes: [] } as AppState;
    expect(scenesEmptyPlaceholder(s)).toEqual(['← Back', 'No scenes']);
  });

  it('auth expired takes precedence', () => {
    const s = {
      ...buildInitialState(),
      authStatus: 'expired',
      listsRefreshing: true,
      scenes: [],
    } as AppState;
    expect(scenesEmptyPlaceholder(s)).toEqual(['Reconnect in app']);
  });

  it('returns null when there are scenes (caller renders the real list)', () => {
    const s = {
      ...buildInitialState(),
      listsRefreshing: false,
      scenes: [{ sceneId: 's1', sceneName: 'A' }],
    } as AppState;
    expect(scenesEmptyPlaceholder(s)).toBeNull();
  });
});

describe('@regression "Refreshing…" indicator lives in the stats box', () => {
  it('prepends "Refreshing…" while listsRefreshing is true', () => {
    const s = { ...buildInitialState(), listsRefreshing: true } as AppState;
    expect(getStatsContent(s).split('\n')[0]).toBe('Refreshing…');
  });

  it('omits "Refreshing…" once the refresh has settled', () => {
    const s = { ...buildInitialState(), listsRefreshing: false } as AppState;
    expect(getStatsContent(s).startsWith('Refreshing…')).toBe(false);
  });

  it('still shows the hint even if stats are disabled', () => {
    const base = buildInitialState();
    const s: AppState = {
      ...base,
      listsRefreshing: true,
      preferences: {
        ...base.preferences,
        statsVisibility: { ...base.preferences.statsVisibility, enabled: false },
      },
    };
    expect(getStatsContent(s)).toBe('Refreshing…');
  });
});
