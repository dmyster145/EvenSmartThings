/**
 * State reducer — pure (state, action) => state.
 */

import type { AppState, Action } from './contracts';
import { DEFAULT_PREFERENCES } from './contracts';

export function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'TAP':
      return { ...state, focusedListIndex: action.selectedIndex };

    case 'LIST_PAGE':
      return { ...state, listPageIndex: action.pageIndex };

    case 'NAV_VIEW':
      return {
        ...state,
        listView: action.view,
        listPageIndex: 0,
        focusedListIndex: 0,
        ...(action.view === 'rooms' ? { roomsStatus: 'loading' as const } : {}),
        ...(action.view === 'devices' ? { selectedDeviceId: null, deviceStats: null } : {}),
        ...(action.view === 'device-detail' || action.view === 'device-dim'
          ? {}
          : { selectedDeviceId: null, deviceStats: null }),
        ...(action.view === 'main' || action.view === 'scenes' || action.view === 'rooms' || action.view === 'favorites'
          ? { roomStats: null }
          : {}),
      };

    case 'NAV_ROOM':
      return {
        ...state,
        listView: 'devices',
        listPageIndex: 0,
        focusedListIndex: 0,
        selectedRoomId: action.roomId,
        devicesStatus: 'loading',
        roomStats: null,
      };

    case 'NAV_DEVICE':
      return {
        ...state,
        listView: 'device-detail',
        listPageIndex: 0,
        focusedListIndex: 0,
        selectedDeviceId: action.deviceId,
      };

    case 'NAV_FAVORITE_DEVICE':
      return {
        ...state,
        listView: 'device-detail',
        listPageIndex: 0,
        focusedListIndex: 0,
        selectedDeviceId: action.deviceId,
        selectedRoomId: null,
        devices: state.allDevices,
      };

    case 'NAV_ROOM_ALL':
      return {
        ...state,
        listView: 'room-all-detail',
        listPageIndex: 0,
        focusedListIndex: 0,
        selectedDeviceId: null,
      };

    case 'SCENES_LOADED': {
      const sorted = [...action.scenes].sort((a, b) =>
        (a.sceneName ?? '').localeCompare(b.sceneName ?? '', undefined, { sensitivity: 'base' })
      );
      return {
        ...state,
        scenes: sorted,
        listPageIndex: 0,
        status: 'ready',
        errorMessage: undefined,
      };
    }

    case 'SCENES_ERROR':
      return {
        ...state,
        status: 'error',
        errorMessage: action.message,
      };

    case 'ROOMS_LOADING':
      return { ...state, roomsStatus: 'loading' };

    case 'ROOMS_LOADED': {
      const sorted = [...action.rooms].sort((a, b) =>
        (a.roomName ?? '').localeCompare(b.roomName ?? '', undefined, { sensitivity: 'base' })
      );
      return {
        ...state,
        rooms: sorted,
        roomsStatus: 'ready',
        listPageIndex: 0,
      };
    }

    case 'ROOMS_ERROR':
      return { ...state, roomsStatus: 'error' };

    case 'DEVICES_LOADING':
      return { ...state, devicesStatus: 'loading' };

    case 'DEVICES_LOADED': {
      const sorted = [...action.devices].sort((a, b) =>
        (a.deviceName ?? '').localeCompare(b.deviceName ?? '', undefined, { sensitivity: 'base' })
      );
      return {
        ...state,
        devices: sorted,
        devicesStatus: 'ready',
        listPageIndex: 0,
      };
    }

    case 'DEVICES_ERROR':
      return { ...state, devicesStatus: 'error' };

    case 'ALL_DEVICES_LOADED': {
      const sorted = [...action.devices].sort((a, b) =>
        (a.deviceName ?? '').localeCompare(b.deviceName ?? '', undefined, { sensitivity: 'base' })
      );
      return { ...state, allDevices: sorted };
    }

    case 'EXECUTE_START':
      return { ...state, status: 'executing' };

    case 'EXECUTE_END':
      return {
        ...state,
        status: action.success ? 'done' : 'error',
        errorMessage: action.errorMessage,
      };

    case 'STATS_GLOBAL':
      return { ...state, globalStats: action.stats };

    case 'STATS_ROOM':
      return { ...state, roomStats: action.stats };

    case 'STATS_DEVICE':
      return { ...state, deviceStats: action.stats };

    case 'PREFERENCES_LOADED':
      return { ...state, preferences: action.preferences };

    case 'SET_LIST_ORDER': {
      const list = action.list;
      const next = {
        ...state.preferences,
        listOrder: { ...state.preferences.listOrder, [list]: action.preference },
      };
      if (action.customIds !== undefined) {
        next.listOrderCustomIds = {
          ...state.preferences.listOrderCustomIds,
          [list]: action.customIds as string[] & (typeof next.listOrderCustomIds)[typeof list],
        };
      }
      return { ...state, preferences: next };
    }

    case 'SET_FAVORITES':
      return { ...state, preferences: { ...state.preferences, favoritesIds: action.favoritesIds } };

    case 'SET_STATS_VISIBILITY':
      return {
        ...state,
        preferences: {
          ...state.preferences,
          statsVisibility: { ...state.preferences.statsVisibility, ...action.statsVisibility },
        },
      };

    case 'SET_RENAMES':
      return { ...state, preferences: { ...state.preferences, renames: action.renames } };

    default:
      return state;
  }
}

export function buildInitialState(): AppState {
  return {
    listView: 'main',
    scenes: [],
    listPageIndex: 0,
    status: 'loading',
    rooms: [],
    roomsStatus: 'idle',
    selectedRoomId: null,
    devices: [],
    devicesStatus: 'idle',
    selectedDeviceId: null,
    globalStats: null,
    roomStats: null,
    deviceStats: null,
    focusedListIndex: 0,
    preferences: { ...DEFAULT_PREFERENCES },
    allDevices: [],
  };
}
