/**
 * Launch resume persistence for glasses-menu startup.
 */

import type { AppState, ListView } from './contracts';
import { LAUNCH_RESUME_STORAGE_KEY } from './constants';
import type { EvenHubBridge } from '../evenhub/bridge';

type TopLevelLaunchResumeView = 'scenes' | 'favorites';
export type LaunchResumeView = Exclude<ListView, 'main'>;

export interface LaunchResumeState {
  version: 1;
  view: LaunchResumeView;
  roomId: string | null;
  deviceId: string | null;
}

const LAUNCH_RESUME_VERSION = 1;
const RESUMABLE_VIEWS = new Set<LaunchResumeView>([
  'scenes',
  'rooms',
  'devices',
  'device-detail',
  'device-dim',
  'room-all-detail',
  'room-all-dim',
  'favorites',
]);

function fallbackTopLevelView(state: AppState): TopLevelLaunchResumeView {
  return state.preferences.favoritesIds.length > 0 ? 'favorites' : 'scenes';
}

function migrate(parsed: unknown): LaunchResumeState | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const launchResume = parsed as Record<string, unknown>;
  const view = typeof launchResume.view === 'string' ? launchResume.view as LaunchResumeView : null;
  if (!view || !RESUMABLE_VIEWS.has(view)) return null;
  const roomId =
    typeof launchResume.roomId === 'string' && launchResume.roomId.trim()
      ? launchResume.roomId
      : null;
  const deviceId =
    typeof launchResume.deviceId === 'string' && launchResume.deviceId.trim()
      ? launchResume.deviceId
      : null;
  return {
    version: LAUNCH_RESUME_VERSION,
    view,
    roomId,
    deviceId,
  };
}

export function deriveLaunchResumeState(state: AppState): LaunchResumeState | null {
  switch (state.listView) {
    case 'main':
      return null;
    case 'scenes':
      return { version: LAUNCH_RESUME_VERSION, view: 'scenes', roomId: null, deviceId: null };
    case 'favorites':
      return {
        version: LAUNCH_RESUME_VERSION,
        view: fallbackTopLevelView(state),
        roomId: null,
        deviceId: null,
      };
    case 'rooms':
      return { version: LAUNCH_RESUME_VERSION, view: 'rooms', roomId: null, deviceId: null };
    case 'devices':
      return state.selectedRoomId
        ? {
            version: LAUNCH_RESUME_VERSION,
            view: 'devices',
            roomId: state.selectedRoomId,
            deviceId: null,
          }
        : { version: LAUNCH_RESUME_VERSION, view: 'rooms', roomId: null, deviceId: null };
    case 'room-all-detail':
    case 'room-all-dim':
      return state.selectedRoomId
        ? {
            version: LAUNCH_RESUME_VERSION,
            view: state.listView,
            roomId: state.selectedRoomId,
            deviceId: null,
          }
        : { version: LAUNCH_RESUME_VERSION, view: 'rooms', roomId: null, deviceId: null };
    case 'device-detail':
    case 'device-dim':
      if (!state.selectedDeviceId) {
        if (state.selectedRoomId) {
          return {
            version: LAUNCH_RESUME_VERSION,
            view: 'devices',
            roomId: state.selectedRoomId,
            deviceId: null,
          };
        }
        const fallbackView = fallbackTopLevelView(state);
        return {
          version: LAUNCH_RESUME_VERSION,
          view: fallbackView,
          roomId: null,
          deviceId: null,
        };
      }
      return {
        version: LAUNCH_RESUME_VERSION,
        view: state.listView,
        roomId: state.selectedRoomId,
        deviceId: state.selectedDeviceId,
      };
    default:
      return null;
  }
}

export function launchResumeStateKey(launchResume: LaunchResumeState | null): string {
  return launchResume ? JSON.stringify(launchResume) : '';
}

export async function getStoredLaunchResume(hub: EvenHubBridge): Promise<LaunchResumeState | null> {
  let raw: string | null = null;
  try {
    raw = await hub.getLocalStorage(LAUNCH_RESUME_STORAGE_KEY);
  } catch {
    // ignore
  }
  if (raw && raw.trim()) {
    try {
      return migrate(JSON.parse(raw) as unknown);
    } catch {
      // fall through to localStorage
    }
  }
  try {
    if (typeof localStorage !== 'undefined') {
      raw = localStorage.getItem(LAUNCH_RESUME_STORAGE_KEY);
      if (raw && raw.trim()) {
        return migrate(JSON.parse(raw) as unknown);
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export async function setStoredLaunchResume(
  hub: EvenHubBridge,
  launchResume: LaunchResumeState | null
): Promise<void> {
  const raw = launchResume ? JSON.stringify(launchResume) : '';
  await hub.setLocalStorage(LAUNCH_RESUME_STORAGE_KEY, raw);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LAUNCH_RESUME_STORAGE_KEY, raw);
  } catch {
    // ignore
  }
}
