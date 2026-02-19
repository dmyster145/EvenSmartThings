/**
 * Core type definitions for the Even SmartThings app.
 */

export interface SceneEntry {
  sceneId: string;
  sceneName: string;
}

export interface DeviceEntry {
  deviceId: string;
  deviceName: string;
  /** Human-readable device type (e.g. Light, Outlet, from profile category). */
  deviceType?: string;
  /** Protocol/integration type (e.g. Zigbee, Z-Wave, LAN). */
  deviceProtocol?: string;
  /** True if device has switch capability (on/off). */
  supportsSwitch?: boolean;
  /** True if device has switchLevel capability (dimmable). */
  supportsDimmer?: boolean;
}

export interface RoomEntry {
  roomId: string;
  roomName: string;
}

/** Total/online/offline counts for global or room stats. */
export interface GlobalStats {
  total: number;
  online: number;
  offline: number;
}

/** Online and switch status for a single device. */
export interface DeviceStats {
  onlineStatus: string;
  switchStatus: string;
  /** Dim level 0–100, or null if not dimmable / not available. */
  brightness: number | null;
  /** Dynamic capability attribute readings (e.g. Motion, Temperature) for display at bottom of stats. */
  capabilityReadings?: Array<{ label: string; value: string }>;
}

export type AppStatus = 'loading' | 'ready' | 'executing' | 'done' | 'error';

export type ListView =
  | 'main'
  | 'scenes'
  | 'rooms'
  | 'devices'
  | 'device-detail'
  | 'device-dim'
  | 'room-all-detail'
  | 'room-all-dim'
  | 'favorites';

/** List order preference per list type. */
export type ListOrderPreference = 'alphabetical' | 'reverse' | 'custom';

/** Home screen menu items (order determines main menu). */
export type MainMenuItem = 'scenes' | 'devices' | 'favorites';

/** Custom order: ordered IDs per list type. When preference is 'custom', use this order. */
export interface ListOrderCustomIds {
  scenes: string[];
  rooms: string[];
  devices: string[];
  favorites: string[];
  main: MainMenuItem[];
}

/** Which stat lines to show on the glasses (per-stat keys). enabled: false hides the entire stats section. */
export interface StatsVisibility {
  enabled: boolean;
  totalDevices: boolean;
  online: boolean;
  offline: boolean;
  deviceType: boolean;
  protocol: boolean;
  onlineStatus: boolean;
  switchStatus: boolean;
  brightness: boolean;
  capabilityReadings: boolean;
}

/** User preferences (list order, favorites, stats visibility, local renames). */
export interface Preferences {
  listOrder: {
    scenes: ListOrderPreference;
    rooms: ListOrderPreference;
    devices: ListOrderPreference;
    favorites: ListOrderPreference;
    main: ListOrderPreference;
  };
  listOrderCustomIds: ListOrderCustomIds;
  /** Ordered: type + id; display order when favorites order is 'custom'. */
  favoritesIds: Array<{ type: 'scene' | 'device'; id: string }>;
  statsVisibility: StatsVisibility;
  /** Map entity ID (sceneId, roomId, deviceId) → display name. */
  renames: Record<string, string>;
  schemaVersion: number;
}

export const PREFERENCES_SCHEMA_VERSION = 1;

export const DEFAULT_STATS_VISIBILITY: StatsVisibility = {
  enabled: true,
  totalDevices: true,
  online: true,
  offline: true,
  deviceType: true,
  protocol: true,
  onlineStatus: true,
  switchStatus: true,
  brightness: true,
  capabilityReadings: true,
};

export const DEFAULT_PREFERENCES: Preferences = {
  listOrder: {
    scenes: 'alphabetical',
    rooms: 'alphabetical',
    devices: 'alphabetical',
    favorites: 'alphabetical',
    main: 'alphabetical',
  },
  listOrderCustomIds: {
    scenes: [],
    rooms: [],
    devices: [],
    favorites: [],
    main: ['scenes', 'devices', 'favorites'],
  },
  favoritesIds: [],
  statsVisibility: DEFAULT_STATS_VISIBILITY,
  renames: {},
  schemaVersion: PREFERENCES_SCHEMA_VERSION,
};

export interface AppState {
  /** Which list screen is shown: main menu, scenes, rooms list, devices-in-room, or device controls. */
  listView: ListView;
  scenes: SceneEntry[];
  /** Current list page (0-based) for pagination. */
  listPageIndex: number;
  status: AppStatus;
  errorMessage?: string;
  rooms: RoomEntry[];
  roomsStatus: 'idle' | 'loading' | 'ready' | 'error';
  /** When listView is 'devices', the room whose devices we're showing. */
  selectedRoomId: string | null;
  devices: DeviceEntry[];
  devicesStatus: 'idle' | 'loading' | 'ready' | 'error';
  /** When listView is 'device-detail', the device whose controls we're showing. */
  selectedDeviceId: string | null;
  /** Cached global device counts (total / online / offline). */
  globalStats: GlobalStats | null;
  /** Cached room device counts when in room/device context. */
  roomStats: GlobalStats | null;
  /** Cached selected device online + switch status when in device context. */
  deviceStats: DeviceStats | null;
  /** Last list index selected (from tap); used when rebuilding page to preserve scroll position. */
  focusedListIndex: number;
  /** User preferences (list order, favorites, stats visibility, renames). */
  preferences: Preferences;
  /** All devices for location (for resolving favorite device names when not in a room). */
  allDevices: DeviceEntry[];
}

export type Action =
  | { type: 'TAP'; selectedIndex: number; /** 1 = single, 2 = double (from SDK); we count to 3 in app */ gestureTaps?: number }
  | { type: 'LIST_PAGE'; pageIndex: number }
  | { type: 'NAV_VIEW'; view: ListView }
  | { type: 'NAV_ROOM'; roomId: string }
  | { type: 'NAV_DEVICE'; deviceId: string }
  | { type: 'NAV_FAVORITE_DEVICE'; deviceId: string }
  | { type: 'NAV_ROOM_ALL' }
  | { type: 'SCENES_LOADED'; scenes: SceneEntry[] }
  | { type: 'SCENES_ERROR'; message: string }
  | { type: 'ROOMS_LOADING' }
  | { type: 'ROOMS_LOADED'; rooms: RoomEntry[] }
  | { type: 'ROOMS_ERROR'; message: string }
  | { type: 'DEVICES_LOADING' }
  | { type: 'DEVICES_LOADED'; devices: DeviceEntry[] }
  | { type: 'DEVICES_ERROR'; message: string }
  | { type: 'ALL_DEVICES_LOADED'; devices: DeviceEntry[] }
  | { type: 'EXECUTE_START' }
  | { type: 'EXECUTE_END'; success: boolean; errorMessage?: string }
  | { type: 'STATS_GLOBAL'; stats: GlobalStats }
  | { type: 'STATS_ROOM'; stats: GlobalStats | null }
  | { type: 'STATS_DEVICE'; stats: DeviceStats | null }
  | { type: 'PREFERENCES_LOADED'; preferences: Preferences }
  | { type: 'SET_LIST_ORDER'; list: keyof Preferences['listOrder']; preference: ListOrderPreference; customIds?: string[] | MainMenuItem[] }
  | { type: 'SET_FAVORITES'; favoritesIds: Preferences['favoritesIds'] }
  | { type: 'SET_STATS_VISIBILITY'; statsVisibility: Partial<StatsVisibility> }
  | { type: 'SET_RENAMES'; renames: Record<string, string> };

export type StoreListener = (state: AppState, prevState: AppState) => void;
