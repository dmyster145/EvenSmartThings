/**
 * Page Composer — list (left), confirmation status (right).
 */

import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  ImageContainerProperty,
  TextContainerProperty,
} from '@evenrealities/even_hub_sdk';
import type { AppState } from '../state/contracts';
import {
  getSelectedDevice,
  getSelectedRoom,
  roomHasDimmable,
  roomHasSwitchable,
  getOrderedScenes,
  getOrderedRooms,
  getOrderedDevices,
  getOrderedFavorites,
  getDisplayName,
  getMainMenuOrderedItems,
} from '../state/selectors';
import {
  CONTAINER_ID_LIST,
  CONTAINER_NAME_LIST,
  CONTAINER_ID_CONFIRMATION,
  CONTAINER_NAME_CONFIRMATION,
  DISPLAY_WIDTH,
  DISPLAY_HEIGHT,
  LIST_WIDTH,
  LIST_ITEM_HEIGHT,
  CONFIRMATION_WIDTH,
  CONFIRMATION_HEIGHT,
  LIST_ITEM_NAME_MAX_LEN,
  SCENES_PER_PAGE,
  DEVICES_PER_PAGE,
  ROOMS_PER_PAGE,
  DIM_LEVELS,
  DIM_LEVELS_PER_PAGE,
  STATS_BOX_HEIGHT,
  STATS_TOP_OFFSET,
} from '../state/constants';

const LABEL_PREVIOUS = '← Previous';
const LABEL_BACK = '← Back';
const LABEL_NEXT = 'Next →';

const CONTAINER_ID_STATS = 3;
/** SDK: container name max 16 chars; glasses may reject longer names. */
const CONTAINER_NAME_STATS = 'st-statuses';
const CONTAINER_ID_BOOT_EVENT = 90;
const CONTAINER_NAME_BOOT_EVENT = 'boot-evt';
const CONTAINER_ID_BOOT_LIST = 91;
const CONTAINER_NAME_BOOT_LIST = 'boot-list';
const CONTAINER_ID_BOOT_TEXT = 92;
const CONTAINER_NAME_BOOT_TEXT = 'boot-text';
const STATS_NAME_MAX_LEN = 28;
/** Max length for a stat value (after the label); longer values are not displayed. Device name is excluded. */
const MAX_STAT_VALUE_LENGTH = 12;
/** Max number of stat lines (including title/name) to display. */
const MAX_STAT_LINES = 10;
/** Stats box to the right of the list; full width of right column. */
const STATS_LEFT_GAP = 4;
const STATS_RIGHT_MARGIN = 4;
const STATS_BOX_WIDTH = DISPLAY_WIDTH - LIST_WIDTH - STATS_LEFT_GAP - STATS_RIGHT_MARGIN;
const AUTH_EXPIRED_LIST_LABEL = 'Reconnect in app';
const AUTH_EXPIRED_STATS_TITLE = 'SmartThings Auth';
const AUTH_EXPIRED_STATS_DETAIL = 'Reconnect in app';
const CONFIRMATION_MARGIN = 8;
const TEXT_MODE_STATS_HEIGHT = DISPLAY_HEIGHT - CONFIRMATION_HEIGHT - CONFIRMATION_MARGIN;
const TEXT_MODE_LIST_TOTAL_LINES = 10;
const TEXT_MODE_LIST_MIN_VISIBLE_ROWS = 4;

function truncateName(name: string, fallback = 'Scene'): string {
  const n = name || fallback;
  return n.length <= LIST_ITEM_NAME_MAX_LEN ? n : n.slice(0, LIST_ITEM_NAME_MAX_LEN - 1) + '…';
}

function truncateStatsName(name: string, fallback: string): string {
  const n = name || fallback;
  return n.length <= STATS_NAME_MAX_LEN ? n : n.slice(0, STATS_NAME_MAX_LEN - 3) + '...';
}

function isRoomContext(state: AppState): boolean {
  const v = state.listView;
  return (v === 'devices' || v === 'device-detail' || v === 'room-all-detail' || v === 'room-all-dim') && !!state.selectedRoomId;
}

function isDeviceContext(state: AppState): boolean {
  const v = state.listView;
  return (v === 'device-detail' || v === 'device-dim') && !!state.selectedDeviceId;
}

function isDimMenu(state: AppState): boolean {
  return state.listView === 'device-dim' || state.listView === 'room-all-dim';
}

const vis = (state: AppState) => state.preferences.statsVisibility;

/** Push a "label: value" line only if visible and value length is <= MAX_STAT_VALUE_LENGTH. */
function pushStatLine(
  state: AppState,
  lines: string[],
  key: keyof AppState['preferences']['statsVisibility'],
  label: string,
  value: string
): void {
  if (!vis(state)[key]) return;
  if (value.length <= MAX_STAT_VALUE_LENGTH) {
    lines.push(`${label}: ${value}`);
  }
}

function buildStatsContent(state: AppState): string {
  // The background-refresh indicator lives in the right-side stats box (not
  // cluttering the list). Show it even when stats are disabled so the wearer
  // always knows a refresh is in flight while cached items are displayed.
  const refreshing = state.listsRefreshing;
  if (!vis(state).enabled) return refreshing ? 'Refreshing…' : '';
  if (state.authStatus === 'expired') {
    return [AUTH_EXPIRED_STATS_TITLE, AUTH_EXPIRED_STATS_DETAIL].join('\n');
  }
  const lines: string[] = [];
  const showGlobalStats = !isRoomContext(state) && !isDimMenu(state);
  if (showGlobalStats) {
    lines.push('SmartThings Statuses');
    const g = state.globalStats;
    if (g) {
      pushStatLine(state, lines, 'totalDevices', 'Total Devices', String(g.total));
      pushStatLine(state, lines, 'online', 'Online', String(g.online));
      pushStatLine(state, lines, 'offline', 'Offline', String(g.offline));
    } else {
      pushStatLine(state, lines, 'totalDevices', 'Total Devices', '-');
      pushStatLine(state, lines, 'online', 'Online', '-');
      pushStatLine(state, lines, 'offline', 'Offline', '-');
    }
  }

  const showRoomStats =
    isRoomContext(state) && !isDeviceContext(state) && !isDimMenu(state);
  if (showRoomStats) {
    const room = getSelectedRoom(state);
    const roomName = room
      ? truncateStatsName(getDisplayName(state, 'room', room.roomId, room.roomName), 'Room')
      : 'Room';
    lines.push(roomName);
    if (state.roomStats) {
      pushStatLine(state, lines, 'totalDevices', 'Total Devices', String(state.roomStats.total));
      pushStatLine(state, lines, 'online', 'Online', String(state.roomStats.online));
      pushStatLine(state, lines, 'offline', 'Offline', String(state.roomStats.offline));
    } else {
      pushStatLine(state, lines, 'totalDevices', 'Total Devices', '-');
      pushStatLine(state, lines, 'online', 'Online', '-');
      pushStatLine(state, lines, 'offline', 'Offline', '-');
    }
  }

  if (isDeviceContext(state)) {
    const device = getSelectedDevice(state);
    const deviceName = device
      ? truncateStatsName(getDisplayName(state, 'device', device.deviceId, device.deviceName), 'Device')
      : 'Device';
    lines.push(deviceName);
    const deviceTypeStr = device?.deviceType?.trim() ? device.deviceType : '-';
    pushStatLine(state, lines, 'deviceType', 'Device Type', deviceTypeStr);
    const protocolStr = device?.deviceProtocol?.trim() ? device.deviceProtocol : '-';
    pushStatLine(state, lines, 'protocol', 'Protocol', protocolStr);
    if (state.deviceStats) {
      pushStatLine(state, lines, 'onlineStatus', 'Online Status', state.deviceStats.onlineStatus);
      if (device?.supportsSwitch) {
        pushStatLine(state, lines, 'switchStatus', 'On / Off Status', state.deviceStats.switchStatus);
      }
      if (device?.supportsDimmer) {
        const brightnessStr =
          state.deviceStats.brightness != null
            ? String(state.deviceStats.brightness)
            : '-';
        pushStatLine(state, lines, 'brightness', 'Brightness', brightnessStr);
      }
    } else {
      pushStatLine(state, lines, 'onlineStatus', 'Online Status', '-');
      if (device?.supportsSwitch) pushStatLine(state, lines, 'switchStatus', 'On / Off Status', '-');
      if (device?.supportsDimmer) pushStatLine(state, lines, 'brightness', 'Brightness', '-');
    }
    if (vis(state).capabilityReadings && state.deviceStats?.capabilityReadings?.length) {
      for (const entry of state.deviceStats.capabilityReadings) {
        if (entry.value.length <= MAX_STAT_VALUE_LENGTH) {
          lines.push(`${entry.label}: ${entry.value}`);
        }
      }
    }
  }

  const body = lines.slice(0, MAX_STAT_LINES);
  return (refreshing ? ['Refreshing…', ...body] : body).join('\n');
}

/** Stats text for the right panel. Use with hub.updateText() to refresh stats without rebuilding the page. */
export function getStatsContent(state: AppState): string {
  return buildStatsContent(state);
}

function buildStatsTextContainers(state: AppState): TextContainerProperty[] {
  if (!vis(state).enabled) return [];
  const stats = new TextContainerProperty({
    xPosition: LIST_WIDTH + STATS_LEFT_GAP,
    yPosition: STATS_TOP_OFFSET,
    width: STATS_BOX_WIDTH,
    height: STATS_BOX_HEIGHT,
    borderWidth: 0,
    borderColor: 0,
    borderRadius: 0,
    paddingLength: 0,
    containerID: CONTAINER_ID_STATS,
    containerName: CONTAINER_NAME_STATS,
    content: buildStatsContent(state),
    isEventCapture: 0,
  });
  return [stats];
}

/** Pure: the placeholder rows to show when the scenes list is empty, or null
 *  when there are scenes to render. Exported for regression tests so the
 *  "Loading scenes…" vs "No scenes" vs auth-expired decision is locked. */
export function scenesEmptyPlaceholder(state: AppState): string[] | null {
  if (getOrderedScenes(state).length > 0) return null;
  if (state.authStatus === 'expired') return [AUTH_EXPIRED_LIST_LABEL];
  // While a refresh is in flight, don't claim "No scenes" yet and don't
  // clutter the list with a loading row — the "Refreshing…" hint is shown in
  // the stats box instead. Just the Back affordance.
  if (state.listsRefreshing) return [LABEL_BACK];
  return [LABEL_BACK, 'No scenes'];
}

/** List item names for scenes view (paginated; first page has ← Back, others have ← Previous). */
function sceneNamesForListView(state: AppState): string[] {
  const scenes = getOrderedScenes(state);
  const { listPageIndex = 0 } = state;
  const placeholder = scenesEmptyPlaceholder(state);
  if (placeholder) return placeholder;

  const firstPageSlots = scenes.length <= SCENES_PER_PAGE ? SCENES_PER_PAGE : SCENES_PER_PAGE - 1;
  const totalPages =
    scenes.length <= SCENES_PER_PAGE
      ? 1
      : 1 + Math.ceil((scenes.length - firstPageSlots) / SCENES_PER_PAGE);
  const page = Math.min(listPageIndex, totalPages - 1);
  const isFirst = page === 0;
  const isLast = page === totalPages - 1;
  const contentSlots = isFirst ? firstPageSlots : SCENES_PER_PAGE;
  const startIndex =
    page === 0 ? 0 : firstPageSlots + (page - 1) * SCENES_PER_PAGE;
  const pageScenes = scenes.slice(startIndex, startIndex + contentSlots);
  const sceneNames = pageScenes.map((s) =>
    truncateName(getDisplayName(state, 'scene', s.sceneId, s.sceneName))
  );
  const padding =
    isFirst && isLast ? [] : Array(contentSlots - sceneNames.length).fill('');
  const scenePart = [...sceneNames, ...padding];
  const prevLabel = isFirst ? LABEL_BACK : LABEL_PREVIOUS;
  if (isFirst && isLast) return [prevLabel, ...scenePart];
  if (isFirst) return [prevLabel, ...scenePart, LABEL_NEXT];
  if (isLast) return [prevLabel, ...scenePart];
  return [prevLabel, ...scenePart, LABEL_NEXT];
}

/** List item names for rooms view (paginated; first page has ← Back). */
function roomNamesForListView(state: AppState): string[] {
  const rooms = getOrderedRooms(state);
  const { listPageIndex = 0, roomsStatus } = state;
  if (rooms.length === 0) {
    if (roomsStatus === 'loading') return ['Loading…'];
    if (state.authStatus === 'expired') return [AUTH_EXPIRED_LIST_LABEL];
    if (roomsStatus === 'error') return ['Failed to load rooms'];
    return ['No rooms'];
  }

  const firstPageSlots =
    rooms.length <= ROOMS_PER_PAGE ? ROOMS_PER_PAGE : ROOMS_PER_PAGE - 1;
  const totalPages =
    rooms.length <= ROOMS_PER_PAGE
      ? 1
      : 1 + Math.ceil((rooms.length - firstPageSlots) / ROOMS_PER_PAGE);
  const page = Math.min(listPageIndex, totalPages - 1);
  const isFirst = page === 0;
  const isLast = page === totalPages - 1;
  const contentSlots = isFirst ? firstPageSlots : ROOMS_PER_PAGE;
  const startIndex =
    page === 0 ? 0 : firstPageSlots + (page - 1) * ROOMS_PER_PAGE;
  const pageRooms = rooms.slice(startIndex, startIndex + contentSlots);
  const roomNames = pageRooms.map((r) =>
    truncateName(getDisplayName(state, 'room', r.roomId, r.roomName), 'Room')
  );
  const padding =
    isFirst && isLast ? [] : Array(contentSlots - roomNames.length).fill('');
  const roomPart = [...roomNames, ...padding];
  const prevLabel = isFirst ? LABEL_BACK : LABEL_PREVIOUS;
  if (isFirst && isLast) return [prevLabel, ...roomPart];
  if (isFirst) return [prevLabel, ...roomPart, LABEL_NEXT];
  if (isLast) return [prevLabel, ...roomPart];
  return [prevLabel, ...roomPart, LABEL_NEXT];
}

const LABEL_ALL = 'All';

/** List item names for devices view (paginated; first page has ← Back and "All" at top). */
function deviceNamesForListView(state: AppState): string[] {
  const devices = getOrderedDevices(state);
  const { listPageIndex = 0, devicesStatus } = state;
  if (devices.length === 0) {
    if (devicesStatus === 'loading') return [LABEL_BACK, 'Loading…'];
    if (state.authStatus === 'expired') return [LABEL_BACK, AUTH_EXPIRED_LIST_LABEL];
    if (devicesStatus === 'error') return [LABEL_BACK, 'Failed to load devices'];
    return [LABEL_BACK, 'No devices'];
  }

  const totalContentItems = 1 + devices.length; // All + devices
  const needNext = totalContentItems > DEVICES_PER_PAGE - 1;
  const firstPageContentSlots = needNext ? DEVICES_PER_PAGE - 1 : totalContentItems;
  const firstPageDeviceCount = firstPageContentSlots - 1 - (needNext ? 1 : 0); // All + devices, optional Next
  const totalPages = needNext
    ? 1 + Math.ceil((devices.length - firstPageDeviceCount) / (DEVICES_PER_PAGE - 1))
    : 1;
  const page = Math.min(listPageIndex, Math.max(0, totalPages - 1));
  const isFirst = page === 0;
  const isLast = page === totalPages - 1;

  if (isFirst) {
    const firstPageDevices = devices.slice(0, firstPageDeviceCount);
    const deviceNames = firstPageDevices.map((d) =>
      truncateName(getDisplayName(state, 'device', d.deviceId, d.deviceName), 'Device')
    );
    const contentPart = [LABEL_ALL, ...deviceNames];
    const padding =
      isFirst && isLast ? [] : Array(firstPageContentSlots - contentPart.length).fill('');
    const part = [...contentPart, ...padding];
    const prevLabel = LABEL_BACK;
    if (isFirst && isLast) return [prevLabel, ...part];
    return [prevLabel, ...part, LABEL_NEXT];
  }

  const startIndex = firstPageDeviceCount + (page - 1) * (DEVICES_PER_PAGE - 1);
  const contentSlots =
    isLast && devices.length - startIndex < DEVICES_PER_PAGE - 1
      ? devices.length - startIndex
      : DEVICES_PER_PAGE - 1;
  const pageDevices = devices.slice(startIndex, startIndex + contentSlots);
  const deviceNames = pageDevices.map((d) =>
    truncateName(getDisplayName(state, 'device', d.deviceId, d.deviceName), 'Device')
  );
  const padding = Array(contentSlots - deviceNames.length).fill('');
  const devicePart = [...deviceNames, ...padding];
  return [LABEL_PREVIOUS, ...devicePart, ...(isLast ? [] : [LABEL_NEXT])];
}

/** List item names for device-detail view. Order must match the TAP handler in app.ts. */
export function deviceDetailItemNames(state: AppState): string[] {
  const device = getSelectedDevice(state);
  const items: string[] = [LABEL_BACK];
  if (device?.supportsSwitch) items.push('On', 'Off');
  if (device?.supportsGarageDoor) items.push('Open', 'Close');
  if (device?.supportsLock) items.push('Lock', 'Unlock');
  if (device?.supportsMediaPlayback) items.push('Play', 'Pause', 'Stop');
  if (device?.supportsAudioVolume) items.push('Vol +', 'Vol -');
  if (device?.supportsAudioMute) items.push('Mute', 'Unmute');
  if (device?.supportsMediaTrackControl) items.push('Prev', 'Next');
  if (device?.supportsTvChannel) items.push('Ch+', 'Ch-');
  if (device?.supportsMediaInputSource) items.push('HDMI 1', 'HDMI 2', 'HDMI 3', 'HDMI 4', 'HDMI 5', 'HDMI 6', 'TV', 'Optical', 'BT', 'Aux', 'USB');
  if (device?.supportsWindowShade) items.push('Open', 'Close', 'Pause');
  if (device?.supportsWindowShadeLevel) items.push('Shade +', 'Shade -');
  if (device?.supportsValve) items.push('Open', 'Close');
  if (device?.supportsAlarm) items.push('Siren', 'Strobe', 'Both', 'Off');
  if (device?.supportsThermostatMode) items.push('Heat', 'Cool', 'Auto', 'Off', 'Emrg Heat');
  if (device?.supportsThermostatHeatingSetpoint) items.push('Heat +', 'Heat -');
  if (device?.supportsThermostatCoolingSetpoint) items.push('Cool +', 'Cool -');
  if (device?.supportsThermostatFanMode) items.push('Fan Auto', 'Fan On', 'Fan Circ', 'Fan Sched');
  if (device?.supportsFanSpeed) items.push('Speed +', 'Speed -');
  if (device?.supportsColorTemperature) items.push('Cooler', 'Warmer');
  if (device?.supportsColorControl) items.push('Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Purple', 'Pink');
  if (device?.supportsMomentary) items.push('Push');
  if (device?.supportsDimmer) items.push('Dim');
  return items;
}

/** List item names for room-all-detail view (Back, then On/Off if any switchable, then Dim if any dimmable). */
function roomAllDetailItemNames(state: AppState): string[] {
  const base = roomHasSwitchable(state) ? [LABEL_BACK, 'On', 'Off'] : [LABEL_BACK];
  return roomHasDimmable(state) ? [...base, 'Dim'] : base;
}

/** List item names for device-dim view: Back/Prev + levels 0–100 in steps of 10, paginated. */
function dimLevelItemNames(state: AppState): string[] {
  const page = state.listPageIndex ?? 0;
  const totalLevels = DIM_LEVELS.length;
  const firstPageSlots = DIM_LEVELS_PER_PAGE;
  const totalPages =
    totalLevels <= firstPageSlots
      ? 1
      : 1 + Math.ceil((totalLevels - firstPageSlots) / DIM_LEVELS_PER_PAGE);
  const isFirst = page === 0;
  const isLast = page === totalPages - 1;
  const startIndex = page === 0 ? 0 : firstPageSlots + (page - 1) * DIM_LEVELS_PER_PAGE;
  const contentSlots = isFirst
    ? firstPageSlots
    : page === totalPages - 1
      ? totalLevels - firstPageSlots - (totalPages - 2) * DIM_LEVELS_PER_PAGE
      : DIM_LEVELS_PER_PAGE - 1;
  const levelNames = DIM_LEVELS.slice(startIndex, startIndex + contentSlots).map(String);
  const padding =
    isFirst && isLast ? [] : Array(contentSlots - levelNames.length).fill('');
  const part = [...levelNames, ...padding];
  const prevLabel = isFirst ? LABEL_BACK : LABEL_PREVIOUS;
  if (isFirst && isLast) return [prevLabel, ...part];
  if (isFirst) return [prevLabel, ...part, LABEL_NEXT];
  if (isLast) return [prevLabel, ...part];
  return [prevLabel, ...part, LABEL_NEXT];
}

/** List item names for favorites view (paginated). */
function favoriteNamesForListView(state: AppState): string[] {
  const favorites = getOrderedFavorites(state);
  const { listPageIndex = 0 } = state;
  if (state.authStatus === 'expired') return [LABEL_BACK, AUTH_EXPIRED_LIST_LABEL];
  if (favorites.length === 0) return [LABEL_BACK, 'No favorites'];
  const firstPageSlots =
    favorites.length <= SCENES_PER_PAGE ? SCENES_PER_PAGE : SCENES_PER_PAGE - 1;
  const totalPages =
    favorites.length <= SCENES_PER_PAGE
      ? 1
      : 1 + Math.ceil((favorites.length - firstPageSlots) / SCENES_PER_PAGE);
  const page = Math.min(listPageIndex, totalPages - 1);
  const isFirst = page === 0;
  const isLast = page === totalPages - 1;
  const contentSlots = isFirst ? firstPageSlots : SCENES_PER_PAGE;
  const startIndex = page === 0 ? 0 : firstPageSlots + (page - 1) * SCENES_PER_PAGE;
  const pageFavorites = favorites.slice(startIndex, startIndex + contentSlots);
  const names = pageFavorites.map((f) => truncateName(f.displayName));
  const padding = isFirst && isLast ? [] : Array(contentSlots - names.length).fill('');
  const part = [...names, ...padding];
  const prevLabel = isFirst ? LABEL_BACK : LABEL_PREVIOUS;
  if (isFirst && isLast) return [prevLabel, ...part];
  if (isFirst) return [prevLabel, ...part, LABEL_NEXT];
  if (isLast) return [prevLabel, ...part];
  return [prevLabel, ...part, LABEL_NEXT];
}

const MAIN_MENU_LABELS: Record<'scenes' | 'devices' | 'favorites', string> = {
  scenes: 'Scenes',
  devices: 'Devices',
  favorites: 'Favorites',
};

/** List item names for current listView (main, scenes, rooms, devices, favorites, device-detail, device-dim, room-all-*). */
function listItemNamesForState(state: AppState): string[] {
  if (state.listView === 'main') {
    return getMainMenuOrderedItems(state).map((item) => MAIN_MENU_LABELS[item]);
  }
  if (state.authStatus === 'expired') {
    if (state.listView === 'device-detail' || state.listView === 'device-dim') {
      return [LABEL_BACK, AUTH_EXPIRED_LIST_LABEL];
    }
    if (state.listView === 'room-all-detail' || state.listView === 'room-all-dim') {
      return [LABEL_BACK, AUTH_EXPIRED_LIST_LABEL];
    }
  }
  if (state.listView === 'scenes') return sceneNamesForListView(state);
  if (state.listView === 'rooms') return roomNamesForListView(state);
  if (state.listView === 'favorites') return favoriteNamesForListView(state);
  if (state.listView === 'device-detail') return deviceDetailItemNames(state);
  if (state.listView === 'device-dim') return dimLevelItemNames(state);
  if (state.listView === 'room-all-detail') return roomAllDetailItemNames(state);
  if (state.listView === 'room-all-dim') return dimLevelItemNames(state);
  return deviceNamesForListView(state);
}

function selectableListIndexesForItemNames(itemNames: string[]): number[] {
  return itemNames.reduce<number[]>((indexes, itemName, index) => {
    if (itemName.trim().length > 0) indexes.push(index);
    return indexes;
  }, []);
}

export function getSelectableListIndexes(state: AppState): number[] {
  return selectableListIndexesForItemNames(listItemNamesForState(state));
}

export function getNormalizedFocusedListIndex(state: AppState): number {
  const itemNames = listItemNamesForState(state);
  const selectableIndexes = selectableListIndexesForItemNames(itemNames);
  if (selectableIndexes.length === 0) return 0;

  const desiredIndex = Math.min(Math.max(state.focusedListIndex, 0), Math.max(itemNames.length - 1, 0));
  if (selectableIndexes.includes(desiredIndex)) return desiredIndex;

  for (let index = selectableIndexes.length - 1; index >= 0; index -= 1) {
    const selectableIndex = selectableIndexes[index];
    if (selectableIndex !== undefined && selectableIndex < desiredIndex) return selectableIndex;
  }

  const firstSelectableIndex = selectableIndexes[0];
  return firstSelectableIndex ?? 0;
}

export function composeStartupPage(state: AppState): CreateStartUpPageContainer {
  const textObjects = buildStartupTextContainers(state);
  const imageObjects = buildImageContainers();
  return new CreateStartUpPageContainer({
    containerTotalNum: textObjects.length + imageObjects.length,
    textObject: textObjects,
    imageObject: imageObjects,
  });
}

/** Minimal full-screen text page used as the first paint after bridge init,
 *  so the wearer sees something immediately while session/network work runs. */
export function composeLoadingStartupPage(message: string): CreateStartUpPageContainer {
  const textObjects = buildFullScreenTextContainers(message);
  return new CreateStartUpPageContainer({
    containerTotalNum: textObjects.length,
    textObject: textObjects,
  });
}

/** Rebuild equivalent of composeStartupPage — used to swap from the loading
 *  page to the menu without a second createStartUpPageContainer call. */
export function composeMenuRebuildPage(state: AppState): RebuildPageContainer {
  const textObjects = buildStartupTextContainers(state);
  const imageObjects = buildImageContainers();
  return new RebuildPageContainer({
    containerTotalNum: textObjects.length + imageObjects.length,
    textObject: textObjects,
    imageObject: imageObjects,
  });
}

export function composePageForState(state: AppState, focusIndex?: number): RebuildPageContainer {
  const listObjects = buildListContainers(state, focusIndex);
  const textObjects = buildStatsTextContainers(state);
  const imageObjects = buildImageContainers();
  return new RebuildPageContainer({
    containerTotalNum: listObjects.length + textObjects.length + imageObjects.length,
    listObject: listObjects,
    textObject: textObjects,
    imageObject: imageObjects,
  });
}

export function composeListOnlyPage(state: AppState, focusIndex?: number): RebuildPageContainer {
  const listObjects = buildListContainers(state, focusIndex);
  return new RebuildPageContainer({
    containerTotalNum: listObjects.length,
    listObject: listObjects,
  });
}

export function composeTextFallbackPage(message: string): RebuildPageContainer {
  const textObjects = buildFullScreenTextContainers(message);
  return new RebuildPageContainer({
    containerTotalNum: textObjects.length,
    textObject: textObjects,
  });
}

export function composeTextModeListContent(state: AppState): string {
  const itemNames = listItemNamesForState(state);
  const focusIndex = getNormalizedFocusedListIndex(state);
  const title = textModeTitle(state);
  const maxVisibleRows = Math.max(TEXT_MODE_LIST_MIN_VISIBLE_ROWS, TEXT_MODE_LIST_TOTAL_LINES - 1);
  const visibleRows = Math.min(itemNames.length, maxVisibleRows);
  const startIndex = Math.max(
    0,
    Math.min(
      focusIndex - Math.floor(visibleRows / 2),
      Math.max(0, itemNames.length - visibleRows)
    )
  );
  const endIndex = startIndex + visibleRows;

  const lines = title ? [title] : [];
  for (let index = startIndex; index < endIndex; index += 1) {
    const itemName = itemNames[index] ?? '';
    const name = itemName.trim().length > 0 ? itemName : ' ';
    lines.push(`${index === focusIndex ? '>' : ' '} ${name}`);
  }
  return lines.join('\n');
}

export function composeTextModeStatsContent(state: AppState): string {
  const statsContent = getStatsContent(state).trim();
  return statsContent.length > 0 ? statsContent : ' ';
}

/** Last item index on the current page (for scroll-to-bottom). */
export function getLastListIndex(state: AppState): number {
  const selectableIndexes = getSelectableListIndexes(state);
  const lastSelectableIndex = selectableIndexes[selectableIndexes.length - 1];
  return lastSelectableIndex ?? 0;
}

/** Total pages for current listView (for pagination in app). */
export function getTotalPages(state: AppState): number {
  if (state.listView === 'main') return 1;
  if (state.listView === 'favorites') {
    const n = getOrderedFavorites(state).length;
    if (n === 0) return 1;
    const first = n <= SCENES_PER_PAGE ? SCENES_PER_PAGE : SCENES_PER_PAGE - 1;
    return n <= SCENES_PER_PAGE ? 1 : 1 + Math.ceil((n - first) / SCENES_PER_PAGE);
  }
  if (state.listView === 'device-detail' || state.listView === 'room-all-detail') return 1;
  if (state.listView === 'device-dim' || state.listView === 'room-all-dim') {
    const totalLevels = DIM_LEVELS.length;
    return totalLevels <= DIM_LEVELS_PER_PAGE
      ? 1
      : 1 + Math.ceil((totalLevels - DIM_LEVELS_PER_PAGE) / DIM_LEVELS_PER_PAGE);
  }
  if (state.listView === 'scenes') {
    const n = getOrderedScenes(state).length;
    if (n === 0) return 1;
    const first = n <= SCENES_PER_PAGE ? SCENES_PER_PAGE : SCENES_PER_PAGE - 1;
    return n <= SCENES_PER_PAGE ? 1 : 1 + Math.ceil((n - first) / SCENES_PER_PAGE);
  }
  if (state.listView === 'rooms') {
    const n = getOrderedRooms(state).length;
    if (n === 0) return 1;
    const first = n <= ROOMS_PER_PAGE ? ROOMS_PER_PAGE : ROOMS_PER_PAGE - 1;
    return n <= ROOMS_PER_PAGE ? 1 : 1 + Math.ceil((n - first) / ROOMS_PER_PAGE);
  }
  if (state.listView === 'devices') {
    const n = getOrderedDevices(state).length;
    if (n === 0) return 1;
    const totalContentItems = 1 + n;
    const needNext = totalContentItems > DEVICES_PER_PAGE - 1;
    const firstPageDeviceCount = needNext
      ? DEVICES_PER_PAGE - 1 - 1 - 1
      : n;
    return needNext
      ? 1 + Math.ceil((n - firstPageDeviceCount) / (DEVICES_PER_PAGE - 1))
      : 1;
  }
  return 1;
}

/** Content slots on first page (Back takes one); used for scene/device/room index mapping. */
export function getFirstPageContentSlots(state: AppState): number {
  if (state.listView === 'main') return getMainMenuOrderedItems(state).length;
  if (state.listView === 'favorites') {
    const n = getOrderedFavorites(state).length;
    return n <= SCENES_PER_PAGE ? SCENES_PER_PAGE : SCENES_PER_PAGE - 1;
  }
  if (state.listView === 'device-detail') return deviceDetailItemNames(state).length - 1;
  if (state.listView === 'room-all-detail') return roomAllDetailItemNames(state).length - 1;
  if (state.listView === 'device-dim' || state.listView === 'room-all-dim') return DIM_LEVELS_PER_PAGE;
  if (state.listView === 'scenes') {
    const n = state.scenes.length;
    return n <= SCENES_PER_PAGE ? SCENES_PER_PAGE : SCENES_PER_PAGE - 1;
  }
  if (state.listView === 'rooms') {
    const n = state.rooms.length;
    return n <= ROOMS_PER_PAGE ? ROOMS_PER_PAGE : ROOMS_PER_PAGE - 1;
  }
  if (state.listView === 'devices') {
    const n = state.devices.length;
    if (n === 0) return 1;
    const totalContentItems = 1 + n;
    const needNext = totalContentItems > DEVICES_PER_PAGE - 1;
    return needNext ? DEVICES_PER_PAGE - 1 : totalContentItems;
  }
  return 1;
}

function buildListContainers(state: AppState, focusIndex?: number): ListContainerProperty[] {
  const itemNames = listItemNamesForState(state);
  const listHeight = Math.min(DISPLAY_HEIGHT, Math.max(1, itemNames.length) * LIST_ITEM_HEIGHT);
  const list = new ListContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: LIST_WIDTH,
    height: listHeight,
    borderWidth: 0,
    borderColor: 0,
    borderRadius: 0,
    paddingLength: 0,
    containerID: CONTAINER_ID_LIST,
    containerName: CONTAINER_NAME_LIST,
    itemContainer: new ListItemContainerProperty({
      itemCount: itemNames.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: itemNames,
    }),
    isEventCapture: 1,
  });
  if (
    !OMIT_SELECT_INDEX_ON_REBUILD &&
    focusIndex !== undefined &&
    focusIndex >= 0
  ) {
    (list as unknown as Record<string, unknown>).currentSelectItemIndex = focusIndex;
  }
  return [list];
}

function buildStartupTextContainers(state: AppState): TextContainerProperty[] {
  const capture = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: DISPLAY_WIDTH,
    height: DISPLAY_HEIGHT,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: CONTAINER_ID_BOOT_EVENT,
    containerName: CONTAINER_NAME_BOOT_EVENT,
    content: ' ',
    isEventCapture: 1,
  });
  const list = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: LIST_WIDTH,
    height: DISPLAY_HEIGHT,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: CONTAINER_ID_BOOT_LIST,
    containerName: CONTAINER_NAME_BOOT_LIST,
    content: composeTextModeListContent(state),
    isEventCapture: 0,
  });
  const stats = new TextContainerProperty({
    xPosition: LIST_WIDTH + STATS_LEFT_GAP,
    yPosition: STATS_TOP_OFFSET,
    width: STATS_BOX_WIDTH,
    height: TEXT_MODE_STATS_HEIGHT,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: CONTAINER_ID_STATS,
    containerName: CONTAINER_NAME_STATS,
    content: composeTextModeStatsContent(state),
    isEventCapture: 0,
  });
  return [capture, list, stats];
}

function buildFullScreenTextContainers(content: string): TextContainerProperty[] {
  const capture = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: DISPLAY_WIDTH,
    height: DISPLAY_HEIGHT,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: CONTAINER_ID_BOOT_EVENT,
    containerName: CONTAINER_NAME_BOOT_EVENT,
    content: ' ',
    isEventCapture: 1,
  });
  const screen = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: DISPLAY_WIDTH,
    height: DISPLAY_HEIGHT,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: CONTAINER_ID_BOOT_TEXT,
    containerName: CONTAINER_NAME_BOOT_TEXT,
    content,
    isEventCapture: 0,
  });
  return [capture, screen];
}

function textModeTitle(state: AppState): string {
  if (state.listView === 'main') return '';
  if (state.listView === 'scenes') return 'Scenes';
  if (state.listView === 'rooms') return 'Rooms';
  if (state.listView === 'favorites') return 'Favorites';
  if (state.listView === 'devices') {
    const room = getSelectedRoom(state);
    return room ? truncateStatsName(getDisplayName(state, 'room', room.roomId, room.roomName), 'Devices') : 'Devices';
  }
  if (state.listView === 'device-detail' || state.listView === 'device-dim') {
    const device = getSelectedDevice(state);
    return device ? truncateStatsName(getDisplayName(state, 'device', device.deviceId, device.deviceName), 'Device') : 'Device';
  }
  if (state.listView === 'room-all-detail' || state.listView === 'room-all-dim') {
    const room = getSelectedRoom(state);
    return room ? `${truncateStatsName(getDisplayName(state, 'room', room.roomId, room.roomName), 'Room')} All` : 'Room';
  }
  return 'SmartThings';
}

/** Omit currentSelectItemIndex from rebuild payloads; host may reject unknown fields and return false. */
const OMIT_SELECT_INDEX_ON_REBUILD = true;

function buildImageContainers(): ImageContainerProperty[] {
  const statusX = DISPLAY_WIDTH - CONFIRMATION_WIDTH - CONFIRMATION_MARGIN;
  const statusY = DISPLAY_HEIGHT - CONFIRMATION_HEIGHT - CONFIRMATION_MARGIN;
  const confirmation = new ImageContainerProperty({
    xPosition: statusX,
    yPosition: statusY,
    width: CONFIRMATION_WIDTH,
    height: CONFIRMATION_HEIGHT,
    containerID: CONTAINER_ID_CONFIRMATION,
    containerName: CONTAINER_NAME_CONFIRMATION,
  });
  return [confirmation];
}

export {
  CONTAINER_ID_BOOT_LIST,
  CONTAINER_NAME_BOOT_LIST,
  CONTAINER_ID_LIST,
  CONTAINER_NAME_LIST,
  CONTAINER_ID_CONFIRMATION,
  CONTAINER_NAME_CONFIRMATION,
  CONTAINER_ID_STATS,
  CONTAINER_NAME_STATS,
};
