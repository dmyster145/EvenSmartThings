import { describe, it, expect, vi } from 'vitest';

// composer.ts pulls in the Even Hub SDK for container builders; mock it so the
// module resolves under node (mirrors composer.test.ts / loading-fallbacks).
vi.mock('@evenrealities/even_hub_sdk', () => ({
  CreateStartUpPageContainer: vi.fn(),
  RebuildPageContainer: vi.fn(),
  ListContainerProperty: vi.fn(),
  ListItemContainerProperty: vi.fn(),
  ImageContainerProperty: vi.fn(),
  TextContainerProperty: vi.fn(),
}));

import { buildInitialState } from '../state/reducer';
import { getMainMenuOrderedItems } from '../state/selectors';
import { composeTextModeListContent, getStatsContent } from '../render/composer';
import { getStoredPreferences } from '../state/preferences-storage';
import { DEFAULT_PREFERENCES, type AppState } from '../state/contracts';
import type { EvenHubBridge } from '../evenhub/bridge';

// @regression — voice is an IN-PLACE main-menu action (no dedicated screen):
//  (a) it's a default menu item labelled "Tap to speak",
//  (b) selecting it does NOT navigate (handled in app.ts),
//  (c) "Listening…" / recognized speech render in the right-side stats box
//      while staying on the main menu,
//  (d) existing users (schema v2) get the new item via migration.
describe('@regression voice main-menu integration', () => {
  it('voice is a default main-menu item', () => {
    const state = buildInitialState();
    expect(getMainMenuOrderedItems(state)).toContain('voice');
    expect(DEFAULT_PREFERENCES.listOrderCustomIds.main).toContain('voice');
  });

  it('the menu item is labelled "Tap to speak" (not "Voice")', () => {
    const content = composeTextModeListContent(buildInitialState());
    expect(content).toContain('Tap to speak');
    expect(content).not.toContain('Voice');
  });

  it('idle main menu has no voice line in the stats box', () => {
    const s = buildInitialState(); // listView 'main', voice idle
    expect(getStatsContent(s)).not.toContain('Listening…');
  });

  it('"Listening…" / speech show at the BOTTOM of the right-side stats box', () => {
    const base = buildInitialState();
    const listening: AppState = {
      ...base, listView: 'main', voice: { listening: true, status: null },
    };
    const lines = getStatsContent(listening).split('\n');
    expect(lines[lines.length - 1]).toBe('Listening…'); // below the stats
    expect(lines[0]).not.toBe('Listening…');

    const heard: AppState = {
      ...base, listView: 'main', voice: { listening: false, status: 'Heard: movie night' },
    };
    const hl = getStatsContent(heard).split('\n');
    expect(hl[hl.length - 1]).toBe('Heard: movie night');
  });

  it('voice status is scoped to the main menu (not leaked onto other screens)', () => {
    const base = buildInitialState();
    const onScenes: AppState = {
      ...base, listView: 'scenes', voice: { listening: true, status: 'Listening…' },
    };
    expect(getStatsContent(onScenes)).not.toContain('Listening…');
  });

  it('migrates a schema-v2 stored order (no "voice") by appending it', async () => {
    const v2 = JSON.stringify({
      schemaVersion: 2,
      listOrder: { main: 'custom' },
      listOrderCustomIds: { main: ['favorites', 'scenes', 'devices'] },
    });
    const stubHub = { getLocalStorage: async () => v2 } as unknown as EvenHubBridge;
    const prefs = await getStoredPreferences(stubHub);
    // User's chosen order preserved; the new 'voice' item appended at the end.
    expect(prefs.listOrderCustomIds.main).toEqual(['favorites', 'scenes', 'devices', 'voice']);
  });
});
