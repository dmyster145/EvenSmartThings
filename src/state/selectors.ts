/**
 * Selectors — derive display data from AppState.
 */

import type { AppState, SceneEntry, RoomEntry, DeviceEntry, ListOrderPreference, ListView, MainMenuItem } from './contracts';
import { DIM_LEVELS, DIM_LEVELS_PER_PAGE, DEVICES_PER_PAGE, LIST_ITEM_NAME_MAX_LEN } from './constants';

/** Display name for an entity: preference rename or fallback (truncated). */
export function getDisplayName(
  state: AppState,
  _type: 'scene' | 'room' | 'device',
  id: string,
  fallback: string
): string {
  const name = state.preferences.renames[id] ?? fallback;
  const n = (name || fallback).trim() || fallback;
  return n.length <= LIST_ITEM_NAME_MAX_LEN ? n : n.slice(0, LIST_ITEM_NAME_MAX_LEN - 1) + '…';
}

function applyOrder<T>(
  items: T[],
  getKey: (item: T) => string,
  getName: (item: T) => string,
  preference: ListOrderPreference,
  customIds: string[]
): T[] {
  if (preference === 'alphabetical') {
    return [...items].sort((a, b) =>
      (getName(a) ?? '').localeCompare(getName(b) ?? '', undefined, { sensitivity: 'base' })
    );
  }
  if (preference === 'reverse') {
    return [...items]
      .sort((a, b) =>
        (getName(a) ?? '').localeCompare(getName(b) ?? '', undefined, { sensitivity: 'base' })
      )
      .reverse();
  }
  // custom: order by customIds, append any missing at end
  const byId = new Map(items.map((item) => [getKey(item), item]));
  const ordered: T[] = [];
  for (const id of customIds) {
    const item = byId.get(id);
    if (item) {
      ordered.push(item);
      byId.delete(id);
    }
  }
  const rest = [...byId.values()].sort((a, b) =>
    (getName(a) ?? '').localeCompare(getName(b) ?? '', undefined, { sensitivity: 'base' })
  );
  return [...ordered, ...rest];
}

export function getOrderedScenes(state: AppState): SceneEntry[] {
  const { listOrder, listOrderCustomIds } = state.preferences;
  return applyOrder(
    state.scenes,
    (s) => s.sceneId,
    (s) => s.sceneName,
    listOrder.scenes,
    listOrderCustomIds.scenes
  );
}

export function getOrderedRooms(state: AppState): RoomEntry[] {
  const { listOrder, listOrderCustomIds } = state.preferences;
  return applyOrder(
    state.rooms,
    (r) => r.roomId,
    (r) => r.roomName,
    listOrder.rooms,
    listOrderCustomIds.rooms
  );
}

export function getOrderedDevices(state: AppState): DeviceEntry[] {
  const { listOrder, listOrderCustomIds } = state.preferences;
  return applyOrder(
    state.devices,
    (d) => d.deviceId,
    (d) => d.deviceName,
    listOrder.devices,
    listOrderCustomIds.devices
  );
}

export interface FavoriteItem {
  type: 'scene' | 'device';
  id: string;
  displayName: string;
  /** For devices: the DeviceEntry if found in allDevices or current devices. */
  device?: DeviceEntry;
  scene?: SceneEntry;
}

export function getOrderedFavorites(state: AppState): FavoriteItem[] {
  const { favoritesIds, listOrder, renames } = state.preferences;
  const scenesById = new Map(state.scenes.map((s) => [s.sceneId, s]));
  const devicesById = new Map<string, DeviceEntry>([
    ...state.allDevices.map((d): [string, DeviceEntry] => [d.deviceId, d]),
    ...state.devices.map((d): [string, DeviceEntry] => [d.deviceId, d]),
  ]);
  let items: Array<{ type: 'scene' | 'device'; id: string }> = [...favoritesIds];
  if (listOrder.favorites === 'alphabetical') {
    items = [...items].sort((a, b) => {
      const nameA = a.type === 'scene'
        ? (renames[a.id] ?? scenesById.get(a.id)?.sceneName ?? '')
        : (renames[a.id] ?? devicesById.get(a.id)?.deviceName ?? '');
      const nameB = b.type === 'scene'
        ? (renames[b.id] ?? scenesById.get(b.id)?.sceneName ?? '')
        : (renames[b.id] ?? devicesById.get(b.id)?.deviceName ?? '');
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    });
  } else if (listOrder.favorites === 'reverse') {
    items = [...items].sort((a, b) => {
      const nameA = a.type === 'scene'
        ? (renames[a.id] ?? scenesById.get(a.id)?.sceneName ?? '')
        : (renames[a.id] ?? devicesById.get(a.id)?.deviceName ?? '');
      const nameB = b.type === 'scene'
        ? (renames[b.id] ?? scenesById.get(b.id)?.sceneName ?? '')
        : (renames[b.id] ?? devicesById.get(b.id)?.deviceName ?? '');
      return nameB.localeCompare(nameA, undefined, { sensitivity: 'base' });
    });
  }
  // custom: already in favoritesIds order
  const result: FavoriteItem[] = [];
  for (const { type, id } of items) {
    if (type === 'scene') {
      const scene = scenesById.get(id);
      const displayName = getDisplayName(state, 'scene', id, scene?.sceneName ?? 'Scene');
      result.push({ type: 'scene', id, displayName, scene: scene ?? undefined });
    } else {
      const device = devicesById.get(id);
      const displayName = getDisplayName(state, 'device', id, device?.deviceName ?? 'Device');
      result.push({ type: 'device', id, displayName, device });
    }
  }
  return result;
}

const MAIN_MENU_ITEMS: MainMenuItem[] = ['scenes', 'devices', 'favorites'];
const MAIN_MENU_LABEL: Record<MainMenuItem, string> = { scenes: 'Scenes', devices: 'Devices', favorites: 'Favorites' };

/** Ordered main menu items (for display). Excludes Favorites if user has none. */
export function getMainMenuOrderedItems(state: AppState): MainMenuItem[] {
  const { listOrder, listOrderCustomIds } = state.preferences;
  const hasFavorites = state.preferences.favoritesIds.length > 0;
  let items: MainMenuItem[];
  if (listOrder.main === 'alphabetical') {
    items = [...MAIN_MENU_ITEMS].sort((a, b) =>
      MAIN_MENU_LABEL[a].localeCompare(MAIN_MENU_LABEL[b], undefined, { sensitivity: 'base' })
    );
  } else if (listOrder.main === 'reverse') {
    items = [...MAIN_MENU_ITEMS].sort((a, b) =>
      MAIN_MENU_LABEL[b].localeCompare(MAIN_MENU_LABEL[a], undefined, { sensitivity: 'base' })
    );
  } else {
    items = listOrderCustomIds.main.length > 0 ? [...listOrderCustomIds.main] : [...MAIN_MENU_ITEMS];
  }
  return hasFavorites ? items : items.filter((x) => x !== 'favorites');
}

/** ListView to open for each main menu position (scenes -> 'scenes', devices -> 'rooms', favorites -> 'favorites'). */
export function getMainMenuOrderedViews(state: AppState): ListView[] {
  const items = getMainMenuOrderedItems(state);
  return items.map((item) => (item === 'devices' ? 'rooms' : item));
}

export function getSceneByIndex(state: AppState, index: number): SceneEntry | null {
  const ordered = getOrderedScenes(state);
  return ordered[index] ?? null;
}

export function getRoomByIndex(state: AppState, index: number): RoomEntry | null {
  const ordered = getOrderedRooms(state);
  return ordered[index] ?? null;
}

export function getDeviceByIndex(state: AppState, index: number): DeviceEntry | null {
  const ordered = getOrderedDevices(state);
  return ordered[index] ?? null;
}

export function getFavoriteByIndex(state: AppState, index: number): FavoriteItem | null {
  const ordered = getOrderedFavorites(state);
  return ordered[index] ?? null;
}

export function getSelectedRoom(state: AppState): RoomEntry | null {
  const id = state.selectedRoomId;
  if (!id) return null;
  return state.rooms.find((r) => r.roomId === id) ?? null;
}

export function getSelectedDevice(state: AppState): DeviceEntry | null {
  const id = state.selectedDeviceId;
  if (!id) return null;
  return state.devices.find((d) => d.deviceId === id) ?? null;
}

/** True if any device in the current room has dimmer support (for "All" -> Dim option). */
export function roomHasDimmable(state: AppState): boolean {
  return state.devices.some((d) => d.supportsDimmer);
}

/** True if any device in the current room has switch support (for "All" -> On/Off options). */
export function roomHasSwitchable(state: AppState): boolean {
  return state.devices.some((d) => d.supportsSwitch);
}

/**
 * For devices list view (with "All" on first page): returns -1 if tap is "All", else device index.
 * Returns -2 for Back/Prev/Next. Call only when listView === 'devices' and devices.length > 0.
 * Uses ordered devices for index mapping.
 */
export function getDeviceIndexFromDevicesList(
  state: AppState,
  page: number,
  listIndex: number
): number {
  const devices = getOrderedDevices(state);
  const totalContentItems = 1 + devices.length;
  const needNext = totalContentItems > DEVICES_PER_PAGE - 1;
  const firstPageContentSlots = needNext ? DEVICES_PER_PAGE - 1 : totalContentItems;
  const firstPageDeviceCount = firstPageContentSlots - 1 - (needNext ? 1 : 0);
  if (page === 0) {
    if (listIndex === 1) return -1; // All
    if (listIndex <= 0) return -2; // Back
    const deviceIndex = listIndex - 2; // 2 = Back + All
    return deviceIndex >= 0 && deviceIndex < firstPageDeviceCount ? deviceIndex : -2;
  }
  const startIndex = firstPageDeviceCount + (page - 1) * (DEVICES_PER_PAGE - 1);
  const slotIndex = listIndex - 1; // Prev at 0
  const deviceIndex = startIndex + slotIndex;
  return deviceIndex >= 0 && deviceIndex < devices.length ? deviceIndex : -2;
}

/**
 * In device-dim view, map (state, listIndex) to brightness level 0–100 or null (Back/Prev/Next).
 */
export function getDimLevelByStateAndIndex(state: AppState, listIndex: number): number | null {
  if (state.listView !== 'device-dim' && state.listView !== 'room-all-dim') return null;
  if (listIndex <= 0) return null;
  const page = state.listPageIndex ?? 0;
  const levelIndex = page === 0 ? listIndex - 1 : DIM_LEVELS_PER_PAGE + (listIndex - 1);
  if (levelIndex < 0 || levelIndex >= DIM_LEVELS.length) return null;
  const level = DIM_LEVELS[levelIndex];
  return level ?? null;
}

export function truncateSceneName(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + '…';
}
