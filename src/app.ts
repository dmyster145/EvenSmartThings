/**
 * SmartThings Controls — Application entry point.
 *
 * Flow: Bridge init → backend session lookup → SmartThings access token →
 * SmartThings client → fetch scenes → setup G2 list → rebuild list with scene names →
 * subscribe events. Tap on list runs scene.
 */

import { APP_VERSION } from './version';

// Deep imports avoid the package barrel, which pulls server-only signature deps (http-signature/sshpk → crypto).
import { SmartThingsClient } from '@smartthings/core-sdk/dist/st-client';
import { BearerTokenAuthenticator } from '@smartthings/core-sdk/dist/authenticator';
import { DeviceHealthState } from '@smartthings/core-sdk/dist/endpoint/devices';
import type { SceneSummary } from '@smartthings/core-sdk/dist/endpoint/scenes';
import type { Device } from '@smartthings/core-sdk/dist/endpoint/devices';
import { createStore } from './state/store';
import { buildInitialState } from './state/reducer';
import type { AppState, SceneEntry, DeviceEntry, GlassesMenuDefault, ListOrderPreference } from './state/contracts';
import { mapEvenHubEvent } from './input/actions';
import {
  composeStartupPage,
  composeMenuRebuildPage,
  composePageForState,
  composeListOnlyPage,
  composeTextFallbackPage,
  composeTextModeListContent,
  composeTextModeStatsContent,
  getTotalPages,
  getFirstPageContentSlots,
  getLastListIndex,
  getSelectableListIndexes,
  getNormalizedFocusedListIndex,
  getStatsContent,
  CONTAINER_ID_STATS,
  CONTAINER_NAME_STATS,
  CONTAINER_ID_BOOT_LIST,
  CONTAINER_NAME_BOOT_LIST,
} from './render/composer';
import {
  loadIconCache,
  getConfirmationImageData,
  getConfirmationImageDataRaw,
  getBlankImageData,
  type ConfirmationResult,
} from './render/icon-data';
import {
  getSceneByIndex,
  getRoomByIndex,
  getDeviceByIndex,
  getFavoriteByIndex,
  getSelectedDevice,
  getDimLevelByStateAndIndex,
  getDeviceIndexFromDevicesList,
  roomHasDimmable,
  roomHasSwitchable,
  getOrderedScenes,
  getOrderedRooms,
  getOrderedFavorites,
  getDisplayName,
  getMainMenuOrderedViews,
  parseFavoriteCompositeId,
} from './state/selectors';
import { EvenHubBridge } from './evenhub/bridge';
import {
  checkPendingAuth,
  clearPendingAuth,
  clearCachedSessionStatus,
  consumeSessionTokenFromUrl,
  disconnectSmartThings,
  executeBatchDeviceCommandsViaServer,
  executeDeviceCommandViaServer,
  executeSceneViaServer,
  listScenesViaServer,
  getSessionStatus,
  getSmartThingsAccessToken,
  buildCrossDeviceConnectUrl,
  preparePendingAuth,
  readCachedSessionStatus,
  readStoredSessionToken,
  writeCachedSessionStatus,
  writeStoredSessionToken,
  SMARTTHINGS_DEBUG_EVENT,
  startSmartThingsConnect,
  type SmartThingsBatchRelayResult,
  type SessionStatus,
} from './auth/api';
import {
  SCENE_NAME_MAX_LEN,
  CONTAINER_ID_CONFIRMATION,
  CONTAINER_NAME_CONFIRMATION,
  CONFIRMATION_WIDTH,
  CONFIRMATION_HEIGHT,
  SCENES_PER_PAGE,
  ROOMS_PER_PAGE,
} from './state/constants';
import {
  deriveLaunchResumeState,
  getStoredLaunchResume,
  launchResumeStateKey,
  setStoredLaunchResume,
  type LaunchResumeState,
} from './state/launch-resume-storage';
import { getStoredPreferences, setStoredPreferences } from './state/preferences-storage';
import { createResumeScheduler } from './lifecycle/resume-scheduler';
import { installResumeLifecycle } from './lifecycle/install-resume-lifecycle';
import { hasCredentialSignal } from './auth/credential-signal';
import { classifyTap } from './input/tap-dedup';
import { classifySceneResult } from './render/scene-result';
import { LIST_CACHE_KEY, serializeListSnapshot, parseListSnapshot } from './state/list-cache';
import { ImageRawDataUpdate, OsEventTypeList, StartUpPageCreateResult, type EvenHubEvent } from '@evenrealities/even_hub_sdk';

const CONFIG_PANEL_ID = 'config';
const DEMO_ROOM_ID = '__demo__';
const DEMO_DEVICES_ENABLED = false;
const AUTH_RECONNECT_MESSAGE = 'SmartThings session expired or is unauthorized. Reconnect to continue.';
const AUTH_CONFIG_MISSING_MESSAGE = 'SmartThings OAuth is not configured on the backend.';
const AUTH_DISCONNECTED_MESSAGE = 'SmartThings is not connected for this device.';
const AUTH_SESSION_EXPIRED_MESSAGE = 'Your SmartThings session expired after a period of inactivity. Please reconnect.';

const DEMO_DEVICES: DeviceEntry[] = [
  { deviceId: 'demo-switch', deviceName: 'Demo: Switch', deviceType: 'Switch', deviceProtocol: 'Demo', supportsSwitch: true },
  { deviceId: 'demo-dimmer', deviceName: 'Demo: Dimmer', deviceType: 'Dimmer Switch', deviceProtocol: 'Demo', supportsSwitch: true, supportsDimmer: true },
  { deviceId: 'demo-color-bulb', deviceName: 'Demo: Color Temp Bulb', deviceType: 'Color Bulb', deviceProtocol: 'Demo', supportsSwitch: true, supportsDimmer: true, supportsColorTemperature: true },
  { deviceId: 'demo-color-rgb', deviceName: 'Demo: RGB Bulb', deviceType: 'Color Bulb', deviceProtocol: 'Demo', supportsSwitch: true, supportsDimmer: true, supportsColorTemperature: true, supportsColorControl: true },
  { deviceId: 'demo-garage', deviceName: 'Demo: Garage Door', deviceType: 'Garage Door', deviceProtocol: 'Demo', supportsGarageDoor: true },
  { deviceId: 'demo-lock', deviceName: 'Demo: Lock', deviceType: 'Lock', deviceProtocol: 'Demo', supportsLock: true },
  { deviceId: 'demo-sonos', deviceName: 'Demo: Sonos Speaker', deviceType: 'Speaker', deviceProtocol: 'Demo', supportsMediaPlayback: true, supportsAudioVolume: true, supportsAudioMute: true, supportsMediaTrackControl: true },
  { deviceId: 'demo-tv', deviceName: 'Demo: Samsung TV', deviceType: 'Television', deviceProtocol: 'Demo', supportsSwitch: true, supportsTvChannel: true, supportsMediaInputSource: true, supportsAudioVolume: true, supportsAudioMute: true },
  { deviceId: 'demo-shade', deviceName: 'Demo: Window Shade', deviceType: 'Window Treatment', deviceProtocol: 'Demo', supportsWindowShade: true },
  { deviceId: 'demo-shade-level', deviceName: 'Demo: Shade w/ Level', deviceType: 'Window Treatment', deviceProtocol: 'Demo', supportsWindowShade: true, supportsWindowShadeLevel: true },
  { deviceId: 'demo-valve', deviceName: 'Demo: Valve', deviceType: 'Valve', deviceProtocol: 'Demo', supportsValve: true },
  { deviceId: 'demo-alarm', deviceName: 'Demo: Alarm Siren', deviceType: 'Alarm', deviceProtocol: 'Demo', supportsAlarm: true },
  { deviceId: 'demo-thermostat', deviceName: 'Demo: Thermostat', deviceType: 'Thermostat', deviceProtocol: 'Demo', supportsThermostatMode: true, supportsThermostatHeatingSetpoint: true, supportsThermostatCoolingSetpoint: true, supportsThermostatFanMode: true },
  { deviceId: 'demo-fan', deviceName: 'Demo: Fan', deviceType: 'Fan', deviceProtocol: 'Demo', supportsSwitch: true, supportsFanSpeed: true },
  { deviceId: 'demo-doorbell', deviceName: 'Demo: Doorbell', deviceType: 'Button', deviceProtocol: 'Demo', supportsMomentary: true },
];

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isSmartThingsAuthError(err: unknown): boolean {
  if (!err) return false;
  const maybeError = err as { response?: { status?: number }; status?: number };
  const status = maybeError.response?.status ?? maybeError.status;
  if (status === 401 || status === 403) return true;
  const message = getErrorMessage(err).toLowerCase();
  return (
    message.includes('401') ||
    message.includes('403') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('access denied') ||
    message.includes('invalid token') ||
    message.includes('token expired') ||
    message.includes('expired token')
  );
}

function formatSessionExpiry(_expiresAt?: string): string {
  return 'Connected. SmartThings session is active.';
}

function describeStartUpPageResult(code: StartUpPageCreateResult | null): string {
  switch (code) {
    case StartUpPageCreateResult.success:
      return 'success';
    case StartUpPageCreateResult.invalid:
      return 'invalid';
    case StartUpPageCreateResult.oversize:
      return 'oversize';
    case StartUpPageCreateResult.outOfMemory:
      return 'outOfMemory';
    default:
      return 'unknown';
  }
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('Clipboard API unavailable');
  }
}

type AuthUI = {
  showConnectPanel: (message: string, canConnect?: boolean) => void;
  showConnectedState: (sessionStatus?: SessionStatus) => void;
  setConnectionStatus: (message: string) => void;
  showOAuthPending: () => void;
};

function setupAuthUI(onBeforeDisconnect?: () => Promise<void>): AuthUI {
  const connectBtn = document.getElementById('connect-smartthings-btn') as HTMLButtonElement | null;
  const statusEl = document.getElementById('config-status');
  const reconnectBtn = document.getElementById('reconnect-smartthings-btn') as HTMLButtonElement | null;
  const disconnectBtn = document.getElementById('disconnect-smartthings-btn') as HTMLButtonElement | null;
  const connectionStatusEl = document.getElementById('smartthings-connection-status');
  const disconnectConfirmEl = document.getElementById('disconnect-smartthings-confirm');
  const disconnectConfirmCancel = document.getElementById('disconnect-smartthings-confirm-cancel') as HTMLButtonElement | null;
  const disconnectConfirmDo = document.getElementById('disconnect-smartthings-confirm-do') as HTMLButtonElement | null;
  const connectBtnGroup = document.getElementById('connect-btn-group');
  const refreshBtnGroup = document.getElementById('refresh-btn-group');
  const oauthPendingNotice = document.getElementById('oauth-pending-notice');

  function setConfigStatus(msg: string): void {
    if (statusEl) statusEl.textContent = msg;
  }

  function setConnectionStatus(msg: string): void {
    if (connectionStatusEl) connectionStatusEl.textContent = msg;
  }

  function setConnectEnabled(enabled: boolean): void {
    if (connectBtn) connectBtn.disabled = !enabled;
    if (reconnectBtn) reconnectBtn.disabled = !enabled;
  }

  function showOAuthPending(): void {
    if (connectBtnGroup) connectBtnGroup.style.display = 'none';
    if (refreshBtnGroup) refreshBtnGroup.style.display = 'flex';
    if (oauthPendingNotice) oauthPendingNotice.style.display = 'block';
    setConfigStatus('');
  }

  function hideOAuthPending(): void {
    if (connectBtnGroup) connectBtnGroup.style.display = '';
    if (refreshBtnGroup) refreshBtnGroup.style.display = 'none';
    if (oauthPendingNotice) oauthPendingNotice.style.display = 'none';
  }

  // reconnectBtn.onclick is wired in initApp() so it has access to hub and appendDebugLog.

  // connectBtn.onclick and refreshBtn.onclick are wired in initApp() after authUI is created,
  // because those handlers need appendDebugLog which is defined in initApp() scope.
  if (disconnectBtn && disconnectConfirmEl) {
    disconnectBtn.onclick = () => {
      disconnectConfirmEl.style.display = 'block';
    };
  }
  if (disconnectConfirmCancel && disconnectConfirmEl) {
    disconnectConfirmCancel.onclick = () => {
      disconnectConfirmEl.style.display = 'none';
    };
  }
  if (disconnectConfirmDo && disconnectConfirmEl) {
    disconnectConfirmDo.onclick = async () => {
      disconnectConfirmDo.disabled = true;
      try {
        await onBeforeDisconnect?.();
        await disconnectSmartThings();
        location.reload();
      } catch (err) {
        setConnectionStatus('Disconnect failed: ' + getErrorMessage(err));
        disconnectConfirmDo.disabled = false;
      }
    };
  }

  return {
    showConnectPanel(message, canConnect = true): void {
      hideOAuthPending();
      setConnectEnabled(canConnect);
      setConfigStatus(message);
      showPanel(CONFIG_PANEL_ID);
    },
    showConnectedState(sessionStatus): void {
      setConfigStatus('');
      setConnectEnabled(true);
      setConnectionStatus(formatSessionExpiry(sessionStatus?.session?.expiresAt));
      showGlassesActive();
    },
    setConnectionStatus,
    showOAuthPending,
  };
}
const OPEN_IN_EVEN_ID = 'open-in-even';
const GLASSES_ACTIVE_ID = 'glasses-active';

type ListListKey = 'scenes' | 'rooms' | 'devices' | 'favorites' | 'main';
const LIST_ORDER_LISTS: ListListKey[] = ['main', 'scenes', 'rooms', 'devices', 'favorites'];
const STAT_KEYS = [
  'totalDevices',
  'online',
  'offline',
  'deviceType',
  'protocol',
  'onlineStatus',
  'switchStatus',
  'brightness',
  'capabilityReadings',
] as const;

function setupConfigUI(
  store: ReturnType<typeof createStore>,
  hub: EvenHubBridge,
  refreshPage: () => void
): void {
  function saveAndRefresh(): void {
    void setStoredPreferences(hub, store.getState().preferences).then(() => refreshPage());
  }
  function showToast(msg: string, isError = false): void {
    const el = document.getElementById('config-toast');
    if (el) {
      el.textContent = msg;
      el.className = isError ? 'toast error' : 'toast';
      el.style.display = 'block';
      setTimeout(() => {
        el.style.display = 'none';
      }, 3000);
    }
  }
  const selectedCustomId: Partial<Record<ListListKey, string>> = {};

  function getOrderedIdsForCustomList(list: ListListKey): Array<{ id: string; displayName: string }> {
    const state = store.getState();
    const prefs = state.preferences;
    if (list === 'main') {
      const order =
        prefs.listOrder.main === 'custom' && prefs.listOrderCustomIds.main.length > 0
          ? prefs.listOrderCustomIds.main
          : (['scenes', 'devices', 'favorites'] as const);
      return order.map((id) => ({
        id,
        displayName: id === 'scenes' ? 'Scenes' : id === 'devices' ? 'Devices' : 'Favorites',
      }));
    }
    if (list === 'scenes') {
      return getOrderedScenes(state).map((s) => ({
        id: s.sceneId,
        displayName: getDisplayName(state, 'scene', s.sceneId, s.sceneName),
      }));
    }
    if (list === 'rooms') {
      return getOrderedRooms(state).map((r) => ({
        id: r.roomId,
        displayName: getDisplayName(state, 'room', r.roomId, r.roomName),
      }));
    }
    if (list === 'devices') {
      const customIds = prefs.listOrderCustomIds.devices;
      const byId = new Map(state.allDevices.map((d) => [d.deviceId, d]));
      const ordered: Array<{ id: string; displayName: string }> = [];
      for (const id of customIds) {
        const d = byId.get(id);
        if (d) {
          ordered.push({ id, displayName: getDisplayName(state, 'device', id, d.deviceName) });
          byId.delete(id);
        }
      }
      const rest = [...byId.values()].sort((a, b) =>
        (a.deviceName ?? '').localeCompare(b.deviceName ?? '', undefined, { sensitivity: 'base' })
      );
      rest.forEach((d) =>
        ordered.push({ id: d.deviceId, displayName: getDisplayName(state, 'device', d.deviceId, d.deviceName) })
      );
      return ordered;
    }
    return getOrderedFavorites(state).map((f) => ({
      id: `${f.type}:${f.id}`,
      displayName: f.displayName,
    }));
  }

  function syncFormFromState(): void {
    const state = store.getState();
    const prefs = state.preferences;
    LIST_ORDER_LISTS.forEach((list) => {
      const sel = document.getElementById(`list-order-${list}`) as HTMLSelectElement | null;
      if (sel) sel.value = prefs.listOrder[list];
      const container = document.getElementById(`custom-order-${list}`);
      const ul = document.getElementById(`custom-order-${list}-ul`);
      if (container && ul) {
        if (prefs.listOrder[list] === 'custom') {
          // Keep expansion user-driven so list taps do not reopen collapsed sections.
          const items = getOrderedIdsForCustomList(list);
          ul.innerHTML = '';
          items.forEach(({ id, displayName }) => {
            const li = document.createElement('li');
            li.dataset.id = id;
            li.textContent = String(displayName).slice(0, 50);
            if (id === selectedCustomId[list]) li.classList.add('selected');
            li.onclick = () => {
              selectedCustomId[list] = selectedCustomId[list] === id ? undefined : id;
              ul.querySelectorAll('li').forEach((el) => el.classList.remove('selected'));
              if (selectedCustomId[list]) {
                const sel = ul.querySelector(`li[data-id="${CSS.escape(selectedCustomId[list] ?? '')}"]`);
                if (sel) sel.classList.add('selected');
              }
            };
            ul.appendChild(li);
          });
        } else {
          container.hidden = true;
          selectedCustomId[list] = undefined;
        }
      }
    });
    const glassesMenuDefaultEl = document.getElementById('glasses-menu-default') as HTMLSelectElement | null;
    if (glassesMenuDefaultEl) glassesMenuDefaultEl.value = prefs.glassesMenuDefault;
    const statEnabledCb = document.getElementById('stat-enabled') as HTMLInputElement | null;
    if (statEnabledCb) statEnabledCb.checked = prefs.statsVisibility.enabled;
    STAT_KEYS.forEach((key) => {
      const cb = document.getElementById(`stat-${key}`) as HTMLInputElement | null;
      if (cb) cb.checked = prefs.statsVisibility[key];
    });
    const favList = document.getElementById('favorites-list');
    if (favList) {
      const state = store.getState();
      const scenesById = new Map(state.scenes.map((s) => [s.sceneId, s]));
      const devicesById = new Map(state.allDevices.map((d) => [d.deviceId, d]));
      favList.innerHTML = '';
      if (prefs.favoritesIds.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'empty-state';
        empty.textContent = 'No favorites yet. Add to Favorites to see them on your glasses.';
        favList.appendChild(empty);
      } else {
        prefs.favoritesIds.forEach((fav, i) => {
          const li = document.createElement('li');
          const name =
            fav.type === 'scene'
              ? state.preferences.renames[fav.id] ?? scenesById.get(fav.id)?.sceneName ?? fav.id
              : state.preferences.renames[fav.id] ?? devicesById.get(fav.id)?.deviceName ?? fav.id;
          li.textContent = `${fav.type}: ${String(name).slice(0, 40)}`;
          const btn = document.createElement('button');
          btn.textContent = 'Remove';
          btn.className = 'secondary';
          btn.type = 'button';
          btn.onclick = () => {
            const next = prefs.favoritesIds.filter((_, j) => j !== i);
            store.dispatch({ type: 'SET_FAVORITES', favoritesIds: next });
            saveAndRefresh();
          };
          li.appendChild(btn);
          favList.appendChild(li);
        });
      }
    }
    const renamesList = document.getElementById('renames-list');
    if (renamesList) {
      renamesList.innerHTML = '';
      const entries = Object.entries(prefs.renames);
      if (entries.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'empty-state';
        empty.textContent = 'No custom names yet. Add one to show a friendlier name on the glasses.';
        renamesList.appendChild(empty);
      } else {
        const state = store.getState();
        entries.forEach(([id, name]) => {
          const orig =
            state.scenes.find((s) => s.sceneId === id)?.sceneName ??
            state.rooms.find((r) => r.roomId === id)?.roomName ??
            state.allDevices.find((d) => d.deviceId === id)?.deviceName;
          const li = document.createElement('li');
          li.textContent = orig ? `${orig} > ${name}` : `${id.slice(0, 14)}… > ${name}`;
          const btn = document.createElement('button');
          btn.textContent = 'Clear';
          btn.className = 'secondary';
          btn.type = 'button';
          btn.onclick = () => {
            const next = { ...prefs.renames };
            delete next[id];
            store.dispatch({ type: 'SET_RENAMES', renames: next });
            saveAndRefresh();
          };
          li.appendChild(btn);
          renamesList.appendChild(li);
        });
      }
    }
  }

  store.subscribe(syncFormFromState);
  syncFormFromState();

  LIST_ORDER_LISTS.forEach((list) => {
    const sel = document.getElementById(`list-order-${list}`);
    const container = document.getElementById(`custom-order-${list}`);
    if (sel) {
      sel.addEventListener('change', () => {
        const value = (sel as HTMLSelectElement).value as ListOrderPreference;
        const prefs = store.getState().preferences;
        let customIds: string[] | undefined;
        if (value === 'custom' && prefs.listOrderCustomIds[list].length === 0) {
          const state = store.getState();
          if (list === 'main') customIds = ['scenes', 'devices', 'favorites'];
          else if (list === 'scenes') customIds = getOrderedScenes(state).map((s) => s.sceneId);
          else if (list === 'rooms') customIds = getOrderedRooms(state).map((r) => r.roomId);
          else if (list === 'devices')
            customIds = [...state.allDevices]
              .sort((a, b) =>
                (a.deviceName ?? '').localeCompare(b.deviceName ?? '', undefined, { sensitivity: 'base' })
              )
              .map((d) => d.deviceId);
          else if (list === 'favorites') customIds = prefs.favoritesIds.map((f) => `${f.type}:${f.id}`);
        }
        store.dispatch({
          type: 'SET_LIST_ORDER',
          list,
          preference: value,
          ...(customIds !== undefined ? { customIds } : {}),
        });
        saveAndRefresh();
        if (value === 'custom' && container) container.hidden = false;
      });
      const expandIfCustom = (): void => {
        if ((sel as HTMLSelectElement).value === 'custom' && container) {
          container.hidden = false;
          syncFormFromState();
        }
      };
      sel.addEventListener('click', expandIfCustom);
      sel.addEventListener('focus', expandIfCustom);
    }
  });

  LIST_ORDER_LISTS.forEach((list) => {
    const upBtn = document.getElementById(`custom-order-${list}-up`);
    const downBtn = document.getElementById(`custom-order-${list}-down`);
    const doneBtn = document.getElementById(`custom-order-${list}-done`);
    const container = document.getElementById(`custom-order-${list}`);
    function move(up: boolean): void {
      const id = selectedCustomId[list];
      if (!id) return;
      const items = getOrderedIdsForCustomList(list);
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1) return;
      const newIdx = up ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= items.length) return;
      const ids = items.map((i) => i.id);
      ids[idx] = ids[newIdx]!;
      ids[newIdx] = id;
      store.dispatch({ type: 'SET_LIST_ORDER', list, preference: 'custom', customIds: ids });
      if (list === 'favorites') {
        const newFavoritesIds = ids
          .map((composite) => parseFavoriteCompositeId(composite))
          .filter((f): f is { type: 'scene' | 'device'; id: string } => f !== null);
        store.dispatch({ type: 'SET_FAVORITES', favoritesIds: newFavoritesIds });
      }
      saveAndRefresh();
    }
    if (upBtn) upBtn.onclick = () => move(true);
    if (downBtn) downBtn.onclick = () => move(false);
    if (doneBtn && container) doneBtn.onclick = () => { container.hidden = true; };
  });

  const glassesMenuDefaultEl = document.getElementById('glasses-menu-default') as HTMLSelectElement | null;
  if (glassesMenuDefaultEl) {
    glassesMenuDefaultEl.addEventListener('change', () => {
      store.dispatch({
        type: 'SET_GLASSES_MENU_DEFAULT',
        glassesMenuDefault: glassesMenuDefaultEl.value as GlassesMenuDefault,
      });
      saveAndRefresh();
    });
  }

  const statEnabledEl = document.getElementById('stat-enabled');
  if (statEnabledEl) {
    statEnabledEl.addEventListener('change', () => {
      store.dispatch({
        type: 'SET_STATS_VISIBILITY',
        statsVisibility: { enabled: (statEnabledEl as HTMLInputElement).checked },
      });
      saveAndRefresh();
    });
  }
  STAT_KEYS.forEach((key) => {
    const cb = document.getElementById(`stat-${key}`);
    if (cb)
      cb.addEventListener('change', () => {
        store.dispatch({
          type: 'SET_STATS_VISIBILITY',
          statsVisibility: { [key]: (cb as HTMLInputElement).checked },
        });
        saveAndRefresh();
      });
  });

  const addFavoriteBtn = document.getElementById('add-favorite-btn');
  const addFavoritePicker = document.getElementById('add-favorite-picker');
  const pickerScenes = document.getElementById('picker-scenes') as HTMLSelectElement | null;
  const pickerDevices = document.getElementById('picker-devices') as HTMLSelectElement | null;
  const pickerAddBtn = document.getElementById('picker-add-btn');
  const pickerCancelBtn = document.getElementById('picker-cancel-btn');
  if (addFavoriteBtn && addFavoritePicker && pickerScenes && pickerDevices) {
    addFavoriteBtn.onclick = () => {
      const state = store.getState();
      pickerScenes.innerHTML = '';
      state.scenes.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.sceneId;
        opt.textContent = state.preferences.renames[s.sceneId] ?? s.sceneName;
        pickerScenes.appendChild(opt);
      });
      pickerDevices.innerHTML = '';
      state.allDevices.forEach((d) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = state.preferences.renames[d.deviceId] ?? d.deviceName;
        pickerDevices.appendChild(opt);
      });
      addFavoritePicker.style.display = 'block';
    };
    if (pickerAddBtn) {
      pickerAddBtn.onclick = () => {
        const sceneId = pickerScenes.value;
        const deviceId = pickerDevices.value;
        const prefs = store.getState().preferences;
        const next = [...prefs.favoritesIds];
        if (sceneId) {
          if (!next.some((f) => f.type === 'scene' && f.id === sceneId)) next.push({ type: 'scene', id: sceneId });
        }
        if (deviceId) {
          if (!next.some((f) => f.type === 'device' && f.id === deviceId)) next.push({ type: 'device', id: deviceId });
        }
        store.dispatch({ type: 'SET_FAVORITES', favoritesIds: next });
        saveAndRefresh();
        showToast('Saved.');
      };
    }
    if (pickerCancelBtn) pickerCancelBtn.onclick = () => { addFavoritePicker.style.display = 'none'; };
  }

  const addRenameBtn = document.getElementById('add-rename-btn');
  const addRenameForm = document.getElementById('add-rename-form');
  const renameTypeEl = document.getElementById('rename-type') as HTMLSelectElement | null;
  const renameItemEl = document.getElementById('rename-item') as HTMLSelectElement | null;
  const renameName = document.getElementById('rename-name') as HTMLInputElement | null;
  const renameSaveBtn = document.getElementById('rename-save-btn');
  const renameCancelBtn = document.getElementById('rename-cancel-btn');
  if (addRenameBtn && addRenameForm && renameTypeEl && renameItemEl && renameName) {
    const renameType = renameTypeEl;
    const renameItem = renameItemEl;
    function populateRenameItems(): void {
      const state = store.getState();
      const type = renameType.value as 'scene' | 'room' | 'device';
      renameItem.innerHTML = '';
      if (type === 'scene') {
        state.scenes.forEach((s) => {
          const opt = document.createElement('option');
          opt.value = s.sceneId;
          opt.textContent = state.preferences.renames[s.sceneId] ?? s.sceneName;
          renameItem.appendChild(opt);
        });
      } else if (type === 'room') {
        state.rooms.forEach((r) => {
          const opt = document.createElement('option');
          opt.value = r.roomId;
          opt.textContent = state.preferences.renames[r.roomId] ?? r.roomName;
          renameItem.appendChild(opt);
        });
      } else {
        state.allDevices.forEach((d) => {
          const opt = document.createElement('option');
          opt.value = d.deviceId;
          opt.textContent = state.preferences.renames[d.deviceId] ?? d.deviceName;
          renameItem.appendChild(opt);
        });
      }
    }
    addRenameBtn.onclick = () => {
      populateRenameItems();
      renameName.value = '';
      addRenameForm.style.display = 'block';
    };
    renameType.onchange = populateRenameItems;
    if (renameSaveBtn) {
      renameSaveBtn.onclick = () => {
        const id = renameItem.value;
        const name = renameName.value.trim();
        if (!id || !name) return;
        const prefs = store.getState().preferences;
        const next = { ...prefs.renames, [id]: name.slice(0, 64) };
        store.dispatch({ type: 'SET_RENAMES', renames: next });
        saveAndRefresh();
        showToast('Saved.');
      };
    }
    if (renameCancelBtn) renameCancelBtn.onclick = () => { addRenameForm.style.display = 'none'; };
  }
}

const AUTH_RETURN_ID = 'auth-return';

function showPanel(id: string): void {
  const config = document.getElementById(CONFIG_PANEL_ID);
  const openInEven = document.getElementById(OPEN_IN_EVEN_ID);
  const glassesActive = document.getElementById(GLASSES_ACTIVE_ID);
  const authReturn = document.getElementById(AUTH_RETURN_ID);
  if (config) config.style.display = id === CONFIG_PANEL_ID ? 'block' : 'none';
  if (openInEven) openInEven.style.display = id === OPEN_IN_EVEN_ID ? 'block' : 'none';
  if (glassesActive) glassesActive.style.display = id === GLASSES_ACTIVE_ID ? 'block' : 'none';
  if (authReturn) authReturn.style.display = id === AUTH_RETURN_ID ? 'block' : 'none';
}

function showGlassesActive(): void {
  showPanel(GLASSES_ACTIVE_ID);
}

function normalizeScenes(summaries: SceneSummary[]): SceneEntry[] {
  return summaries.map((s) => ({
    sceneId: s.sceneId ?? '',
    sceneName: (s.sceneName ?? 'Scene').slice(0, SCENE_NAME_MAX_LEN),
  }));
}

// Detection and normalization extracted to src/devices/normalize.ts for testability.
import { normalizeDevices } from './devices/normalize';

type ShowConfirmationFn = (result: ConfirmationResult) => Promise<void>;
type WithSmartThingsClient = <T>(operation: (client: SmartThingsClient) => Promise<T>) => Promise<T>;
type GlassesLayoutMode = 'none' | 'rich' | 'list' | 'text';

function confirmationResultFromCounts(successCount: number, total: number): ConfirmationResult {
  if (total === 0 || successCount === 0) return 'failure';
  if (successCount === total) return 'success';
  return 'partial';
}

async function runExecuteScene(
  store: ReturnType<typeof createStore>,
  selectedIndex: number,
  showConfirmation: ShowConfirmationFn
): Promise<void> {
  const state = store.getState();
  const scene = getSceneByIndex(state, selectedIndex);
  if (!scene || state.status === 'executing') return;

  console.log(
    `[SmartThingsControls] Scene command requested. sceneId=${scene.sceneId} visibility=${typeof document !== 'undefined' ? document.visibilityState : 'unknown'}`
  );
  store.dispatch({ type: 'EXECUTE_START' });
  // Show the "…" in-flight indicator immediately, in parallel with the relay.
  // showConfirmation() keeps it visible for MIN_PENDING_VISIBLE_MS before the
  // success/failure result replaces it, so the wearer always sees feedback.
  void showConfirmation('pending');
  try {
    const result = await executeSceneViaServer(scene.sceneId);
    const status = result?.status;
    // ✓ all succeed · ! some succeed & some error · ✗ all error / single error.
    const verdict = classifySceneResult(result);
    const success = verdict === 'success';
    await showConfirmation(verdict);

    console.log(`[SmartThingsControls] Scene command result. sceneId=${scene.sceneId} status=${status ?? 'unknown'} verdict=${verdict}`);
    store.dispatch({ type: 'EXECUTE_END', success, errorMessage: success ? undefined : (status ?? verdict) });
  } catch (err) {
    const message = getErrorMessage(err);
    console.warn(`[SmartThingsControls] Scene command failed. sceneId=${scene.sceneId} error=${message}`);
    store.dispatch({ type: 'EXECUTE_END', success: false, errorMessage: message });
    await showConfirmation('failure');
  }
}

export async function initApp(): Promise<void> {
  // Consume any session token passed back via URL params after OAuth redirect.
  const urlSessionToken = consumeSessionTokenFromUrl();
  if (urlSessionToken) {
    console.log('[SmartThingsControls] Session token received from OAuth redirect URL.');
    clearPendingAuth();
  }

  const hub = new EvenHubBridge();
  const toggleDebugBtn = document.getElementById('toggle-debug-btn');
  // Live lookups (not cached) — React may mount/unmount the debug panel after
  // initApp runs (HMR, tab switch, conditional render). A captured reference
  // would point at a detached node and silently swallow log writes.
  const getDebugLogContainer = (): HTMLElement | null => document.getElementById('debug-log-container');
  const getDebugLogPre = (): HTMLElement | null => document.getElementById('debug-log');
  const debugLines: string[] = [];
  type WakeLockSentinelLike = {
    released?: boolean;
    release?: () => Promise<void>;
    addEventListener?: (type: 'release', listener: () => void) => void;
  };
  let wakeLockSentinel: WakeLockSentinelLike | null = null;
  let wakeLockUnsupportedLogged = false;
  let wakeLockFailureLogged = false;

  function setDebugVisible(visible: boolean): void {
    const container = getDebugLogContainer();
    if (!container) return;
    container.style.display = visible ? 'block' : 'none';
    if (toggleDebugBtn) {
      toggleDebugBtn.textContent = visible ? 'Disable debug console' : 'Enable debug console';
    }
  }

  function pushDebugLine(message: string): void {
    const line = `[${new Date().toLocaleTimeString('en-US', { hour12: false })}] ${message}`;
    debugLines.push(line);
    if (debugLines.length > 120) debugLines.shift();
    const pre = getDebugLogPre();
    if (pre) pre.textContent = debugLines.join('\n');
  }

  function appendDebugLog(message: string, reveal = false): void {
    pushDebugLine(message);
    console.log(`[SmartThingsControls] ${message}`);
    if (reveal) setDebugVisible(true);
  }

  const relayDebugHandler = (event: Event): void => {
    const customEvent = event as CustomEvent<{ message?: string; reveal?: boolean }>;
    const message = customEvent.detail?.message;
    if (typeof message !== 'string' || !message) return;
    pushDebugLine(message);
    if (customEvent.detail?.reveal) setDebugVisible(true);
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener(SMARTTHINGS_DEBUG_EVENT, relayDebugHandler as EventListener);
  }

  appendDebugLog(`SmartThings Controls v${APP_VERSION}`);

  async function requestWakeLock(reason: string): Promise<void> {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }
    const wakeLockApi = (navigator as Navigator & {
      wakeLock?: {
        request: (type: 'screen') => Promise<WakeLockSentinelLike>;
      };
    }).wakeLock;
    if (!wakeLockApi) {
      if (!wakeLockUnsupportedLogged) {
        wakeLockUnsupportedLogged = true;
        appendDebugLog('Wake lock is not supported in this webview. The phone may suspend commands when locked.');
      }
      return;
    }
    if (wakeLockSentinel && wakeLockSentinel.released === false) {
      return;
    }
    try {
      const sentinel = await wakeLockApi.request('screen');
      wakeLockSentinel = sentinel;
      wakeLockFailureLogged = false;
      sentinel.addEventListener?.('release', () => {
        wakeLockSentinel = null;
        appendDebugLog('Screen wake lock released.');
      });
      appendDebugLog(`Screen wake lock active (${reason}).`);
    } catch (err) {
      wakeLockSentinel = null;
      if (!wakeLockFailureLogged) {
        wakeLockFailureLogged = true;
        appendDebugLog(
          `Screen wake lock request failed (${reason}): ${getErrorMessage(err)}. The phone may suspend commands when locked.`,
          true
        );
      }
    }
  }

  async function releaseWakeLock(reason: string): Promise<void> {
    if (!wakeLockSentinel?.release) return;
    try {
      await wakeLockSentinel.release();
      appendDebugLog(`Screen wake lock released (${reason}).`);
    } catch (err) {
      appendDebugLog(`Screen wake lock release failed (${reason}): ${getErrorMessage(err)}`);
    } finally {
      wakeLockSentinel = null;
    }
  }

  if (toggleDebugBtn) {
    toggleDebugBtn.onclick = () => {
      const container = getDebugLogContainer();
      if (!container) return;
      const visible = container.style.display !== 'none';
      setDebugVisible(!visible);
    };
  }
  // Copy / Clear buttons live inside the React DebugLogPanel; they fire custom
  // events on window so the handlers can use debugLines (closure-scoped here).
  // Listeners are added once per page load — no risk of duplicates from HMR
  // because main.ts only calls initApp() on the initial module load.
  window.addEventListener('smartthings:debug-log-copy', async () => {
    const content = debugLines.join('\n');
    if (!content) return;
    try {
      await copyTextToClipboard(content);
      appendDebugLog('Debug log copied to clipboard.');
    } catch (err) {
      appendDebugLog(`Debug log copy failed: ${getErrorMessage(err)}`, true);
    }
  });
  window.addEventListener('smartthings:debug-log-clear', () => {
    debugLines.length = 0;
    const pre = getDebugLogPre();
    if (pre) pre.textContent = '';
  });
  // Panel is rendered inline by ConfigShell and visible by default; the
  // toggle buttons that used to hide/show it no longer exist in the UI.

  try {
    await hub.init();
    appendDebugLog(`Bridge initialization complete. bridge=${hub.hasBridge()}`);
  } catch (err) {
    console.warn('[SmartThingsControls] Init error:', err);
    appendDebugLog(`Bridge init threw: ${getErrorMessage(err)}`);
    showPanel(OPEN_IN_EVEN_ID);
    return;
  }

  if (!hub.hasBridge()) {
    // Detect whether the user just returned from an OAuth flow in an external browser.
    // Two signals work here, depending on which version of auth-complete.html Vercel is running:
    //   1. urlSessionToken — set when the server redirects with ?_st= directly to this page
    //      (happens when auth-complete.html is updated and no longer redirects back to /)
    //   2. Stored bearer token in localStorage — set by the old auth-complete.html which
    //      stored _st then did window.location.replace('/'), landing here without _st in URL.
    //      NOTE: Even app WebView and Safari have completely isolated localStorage, so this
    //      token in Safari localStorage can only have come from auth-complete.html.
    let storedBearerToken: string | null = null;
    try { storedBearerToken = localStorage.getItem('smartthings_controls_bearer_session'); } catch { /* ignore */ }
    if (urlSessionToken || storedBearerToken) {
      appendDebugLog(`No bridge — OAuth token found (urlToken=${!!urlSessionToken} storedToken=${!!storedBearerToken}). Showing auth-return panel.`);
      showPanel(AUTH_RETURN_ID);
    } else {
      appendDebugLog('No Even bridge available in this webview.');
      showPanel(OPEN_IN_EVEN_ID);
    }
    return;
  }

  // Subscribe to glasses events IMMEDIATELY after the bridge is up, before any
  // network/storage/page work. Events that arrive before handleHubEvent (and
  // its many closure dependencies) are defined later in initApp would
  // otherwise be silently dropped. The forwarder buffers them until
  // attachHubEventSubscription('startup') flips the active handler and drains.
  const earlyEventBuffer: EvenHubEvent[] = [];
  let activeEventHandler: ((event: EvenHubEvent) => void) | null = null;
  const eventForwarder = (event: EvenHubEvent): void => {
    if (activeEventHandler) {
      activeEventHandler(event);
    } else {
      earlyEventBuffer.push(event);
    }
  };
  hub.subscribeEvents(eventForwarder);
  appendDebugLog('Early event forwarder armed.');

  // Exit-only handler for states where the full app handler never gets
  // wired (not authenticated / server unreachable — those paths return
  // early from initApp). ER requires double-tap-to-exit to work on the
  // root page regardless of connection status. Double-tap (sysEvent
  // eventType 3) opens the native system exit dialog; everything else is
  // ignored on these dead-end screens.
  function installExitOnlyEventHandler(reason: string): void {
    if (activeEventHandler) return; // full handler already took over
    const exitHandler = (event: EvenHubEvent): void => {
      const t =
        event.listEvent?.eventType ??
        event.textEvent?.eventType ??
        event.sysEvent?.eventType ??
        null;
      const mapped = t != null ? OsEventTypeList.fromJson(t) ?? Number(t) : null;
      if (mapped === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        appendDebugLog(`Exit-only: double-tap → system exit dialog (${reason}).`);
        void hub.requestSystemExit();
      }
    };
    activeEventHandler = exitHandler;
    const drained = earlyEventBuffer.length;
    for (const event of earlyEventBuffer) exitHandler(event);
    earlyEventBuffer.length = 0;
    appendDebugLog(`Exit-only event handler installed (${reason}, drained=${drained}).`);
  }

  // Instant first paint — required by Even Realities review guidance:
  // "App needs instant OS rendering on launch for normal display."
  //
  // We can't synchronously tell whether the user is authenticated: the real
  // bearer token lives in Even *bridge* persistent storage and is only
  // restored asynchronously (a BLE read) after this point. WebView
  // localStorage is wiped between app launches on the device, so
  // readStoredSessionToken() is empty on cold start even for long-time
  // authenticated users — which made them see the "connect on phone"
  // message every launch.
  //
  // So: paint the MENU optimistically. The vast majority of launches are
  // returning, authenticated users. If the async session verify below comes
  // back unauthenticated, the existing not-authenticated handler repaints
  // the fallback. Worst case for a genuinely-unauthenticated user is a brief
  // menu flash before the "connect on phone" message — far better than every
  // authenticated user seeing the pre-OAuth message on every launch.
  let startupSuccess = false;
  {
    const cachedSession = readCachedSessionStatus();
    appendDebugLog(`Instant first paint: menu (optimistic) (urlToken=${!!urlSessionToken} storedToken=${!!readStoredSessionToken()} cachedAuth=${!!cachedSession?.authenticated})`);
    startupSuccess = await hub.updatePage(composeMenuRebuildPage(buildInitialState()));
    appendDebugLog(`Instant first paint result: ${startupSuccess ? 'success' : 'failed'}`, !startupSuccess);
  }

  // The Even bridge's setLocalStorage/getLocalStorage is backed by native app storage
  // that survives WebView restarts on iOS. The WebView's own localStorage is cleared
  // when the Even app is closed. Sync session token and pending auth ID on startup
  // so both survive a WebView restart without requiring re-authentication or losing
  // an in-progress OAuth flow.
  const SESSION_BRIDGE_KEY = 'smartthings_controls_bearer_session';
  const PENDING_AUTH_BRIDGE_KEY = 'smartthings_controls_pending_auth';

  const webSessionToken = readStoredSessionToken();
  if (!webSessionToken) {
    const bridgeToken = await hub.getLocalStorage(SESSION_BRIDGE_KEY);
    if (bridgeToken) {
      writeStoredSessionToken(bridgeToken);
      appendDebugLog('Session token restored from Even bridge persistent storage.');
    }
  } else {
    await hub.setLocalStorage(SESSION_BRIDGE_KEY, webSessionToken);
  }

  // Restore pending auth ID from bridge storage if localStorage was cleared.
  // This allows checkPendingAuth() on startup to recover a session even after
  // the WebView was killed mid-OAuth-flow (e.g. iOS closing the WebView while
  // the user was completing authorization in the SmartThings native app).
  let webPendingAuthId: string | null = null;
  try { webPendingAuthId = localStorage.getItem(PENDING_AUTH_BRIDGE_KEY); } catch { /* ignore */ }
  if (!webPendingAuthId) {
    const bridgePendingAuthId = await hub.getLocalStorage(PENDING_AUTH_BRIDGE_KEY);
    if (bridgePendingAuthId) {
      try { localStorage.setItem(PENDING_AUTH_BRIDGE_KEY, bridgePendingAuthId); } catch { /* ignore */ }
      appendDebugLog('Pending auth ID restored from Even bridge persistent storage.');
    }
  }

  const authUI = setupAuthUI(async () => {
    await hub.setLocalStorage(SESSION_BRIDGE_KEY, '');
    await hub.setLocalStorage(PENDING_AUTH_BRIDGE_KEY, '');
  });

  // Wire up connect button — shows OAuth pending UI then opens SmartThings auth.
  // Persist the pending auth ID to bridge storage BEFORE navigating away so that
  // if iOS kills the WebView while the user is in the SmartThings app, we can still
  // find the pending auth ID on the next startup and recover the session automatically.
  async function startOAuthConnect(): Promise<void> {
    authUI.showOAuthPending();
    const pendingAuthId = preparePendingAuth();
    appendDebugLog(`[Connect] Prepared pendingAuthId=${pendingAuthId.slice(0, 8)}… Writing to bridge storage.`);
    await hub.setLocalStorage(PENDING_AUTH_BRIDGE_KEY, pendingAuthId);
    appendDebugLog(`[Connect] Bridge storage written. Starting OAuth flow.`);
    startSmartThingsConnect(undefined, pendingAuthId);
  }

  const connectBtn = document.getElementById('connect-smartthings-btn') as HTMLButtonElement | null;
  if (connectBtn) {
    connectBtn.onclick = () => { void startOAuthConnect(); };
  }

  const reconnectBtn = document.getElementById('reconnect-smartthings-btn') as HTMLButtonElement | null;
  if (reconnectBtn) {
    reconnectBtn.onclick = () => { void startOAuthConnect(); };
  }

  // "Open on Mac / Tablet" — generates the OAuth start URL and shows it for the user
  // to open on another device. The pending auth mechanism delivers the session back
  // to this device once OAuth completes on the other device.
  const crossDeviceBtn = document.getElementById('connect-other-device-btn') as HTMLButtonElement | null;
  const crossDeviceSection = document.getElementById('cross-device-section');
  const crossDeviceUrlEl = document.getElementById('cross-device-url');
  const copyUrlBtn = document.getElementById('copy-cross-device-url-btn') as HTMLButtonElement | null;

  if (crossDeviceBtn) {
    crossDeviceBtn.onclick = async () => {
      const pendingAuthId = preparePendingAuth();
      appendDebugLog(`[CrossDevice] Prepared pendingAuthId=${pendingAuthId.slice(0, 8)}… Writing to bridge storage.`);
      await hub.setLocalStorage(PENDING_AUTH_BRIDGE_KEY, pendingAuthId);
      const url = buildCrossDeviceConnectUrl(pendingAuthId);
      if (crossDeviceUrlEl) crossDeviceUrlEl.textContent = url;
      if (crossDeviceSection) crossDeviceSection.style.display = '';
      // Show the Refresh button so the user can check session after completing OAuth on another device.
      authUI.showOAuthPending();
      appendDebugLog(`[CrossDevice] URL ready for another device.`);
    };
  }

  if (copyUrlBtn && crossDeviceUrlEl) {
    copyUrlBtn.onclick = () => {
      const url = crossDeviceUrlEl.textContent ?? '';
      if (url && navigator.clipboard) {
        void navigator.clipboard.writeText(url).then(() => {
          copyUrlBtn.textContent = 'Copied!';
          setTimeout(() => { copyUrlBtn.textContent = 'Copy link'; }, 2000);
        });
      }
    };
  }

  // Wire up refresh button — polls for pending auth and reloads if authenticated.
  const refreshBtn = document.getElementById('refresh-session-btn') as HTMLButtonElement | null;
  const configStatusEl = document.getElementById('config-status');
  function setConfigStatusFromInitApp(msg: string): void {
    if (configStatusEl) configStatusEl.textContent = msg;
  }
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      refreshBtn.disabled = true;
      setConfigStatusFromInitApp('Checking session…');
      appendDebugLog('[Refresh] Checking pending auth…');
      try {
        // Poll up to 5 times with 2s delay to handle the case where the OAuth
        // callback is still in-flight when the user taps Refresh.
        const MAX_POLLS = 5;
        const POLL_DELAY_MS = 2000;
        for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
          const pendingToken = await checkPendingAuth();
          if (pendingToken) {
            appendDebugLog(`[Refresh] Pending auth resolved on attempt ${attempt} — reloading.`);
            location.reload();
            return;
          }
          const sessionStatus = await getSessionStatus();
          if (sessionStatus.authenticated) {
            appendDebugLog(`[Refresh] Session authenticated on attempt ${attempt} — reloading.`);
            location.reload();
            return;
          }
          appendDebugLog(`[Refresh] Attempt ${attempt}/${MAX_POLLS}: not completed yet.`);
          if (attempt < MAX_POLLS) {
            setConfigStatusFromInitApp(`Waiting for SmartThings… (${attempt}/${MAX_POLLS})`);
            await new Promise(r => setTimeout(r, POLL_DELAY_MS));
          }
        }
        appendDebugLog('[Refresh] No session found after all attempts.', true);
        setConfigStatusFromInitApp('Not connected yet. Finish authorization in SmartThings, then tap Refresh.');
      } catch (err) {
        appendDebugLog(`[Refresh] Error: ${getErrorMessage(err)}`, true);
        setConfigStatusFromInitApp('Could not check session. Try again.');
      } finally {
        refreshBtn.disabled = false;
      }
    };
  }

  // Wire up secondary debug toggle button (shown alongside Refresh button).
  const toggleDebugBtn2 = document.getElementById('toggle-debug-btn-2');
  if (toggleDebugBtn2) {
    toggleDebugBtn2.onclick = () => {
      const container = getDebugLogContainer();
      if (!container) return;
      const visible = container.style.display !== 'none';
      setDebugVisible(!visible);
    };
  }

  function showConnectPanelWithDebug(message: string, canConnect?: boolean): void {
    authUI.showConnectPanel(message, canConnect);
  }

  let initialSessionStatus: SessionStatus;
  let usedCachedSession = false;
  try {
    appendDebugLog(`Startup: href=${window.location.href}`);
    appendDebugLog(`Startup: urlSessionToken=${!!urlSessionToken} appVersion=${APP_VERSION}`);
    let pendingId: string | null = null;
    try { pendingId = localStorage.getItem('smartthings_controls_pending_auth'); } catch { /* ignore */ }
    appendDebugLog(`Startup: pendingAuthId=${pendingId ?? 'none'}`);

    const cachedSession = readCachedSessionStatus();
    const restoredToken = readStoredSessionToken();
    // Any of these means "this user has authenticated before" — see
    // hasCredentialSignal() for the rationale (WebView localStorage is wiped
    // between launches; the persisted pending-auth id is the surviving signal).
    const credentialSignal = hasCredentialSignal({ restoredToken, urlSessionToken, pendingId });
    if (cachedSession) {
      // Use cached session to show UI immediately; verify in background.
      initialSessionStatus = cachedSession;
      usedCachedSession = true;
      appendDebugLog('Session check: using cached session status (background verify pending)');
    } else if (credentialSignal) {
      // Don't block the entire startup on the /api/session network verify.
      // When the phone is backgrounded (app opened from glasses, screen off)
      // that fetch stalls ~10s, and scenes/rooms only start AFTER it — so
      // scenes don't land for ~22s and favorites show "Scene/Scene" the
      // whole time. Proceed optimistically and verify in the background
      // (same pattern as the cached-session path). A 401 on any subsequent
      // SmartThings call still routes through handleTerminalAuthFailure →
      // connect panel.
      initialSessionStatus = { authenticated: true, configured: true };
      usedCachedSession = true;
      appendDebugLog(
        `Session check: optimistic (credential signal: token=${!!restoredToken} urlToken=${!!urlSessionToken} pendingId=${!!pendingId}; background verify pending)`
      );
    } else {
      initialSessionStatus = await getSessionStatus();
      appendDebugLog(`Session check: authenticated=${initialSessionStatus.authenticated} configured=${initialSessionStatus.configured}`);

      // If not authenticated, check if OAuth completed outside this WebView
      // (e.g. iOS Universal Links opened the SmartThings app → Safari).
      if (!initialSessionStatus.authenticated && !urlSessionToken) {
        appendDebugLog(`Pending auth check starting: id=${pendingId ?? 'none'}`);
        const pendingToken = await checkPendingAuth();
        appendDebugLog(`Pending auth result: token=${pendingToken ? 'recovered' : 'none'}`);
        if (pendingToken) {
          await hub.setLocalStorage(SESSION_BRIDGE_KEY, pendingToken);
          appendDebugLog('Pending auth recovered session from external OAuth flow.');
          initialSessionStatus = await getSessionStatus();
          appendDebugLog(`Post-recovery session: authenticated=${initialSessionStatus.authenticated}`);
        }
      }
      if (initialSessionStatus.authenticated) writeCachedSessionStatus(initialSessionStatus);
    }
    appendDebugLog(
      `Session status loaded. authenticated=${initialSessionStatus.authenticated} configured=${initialSessionStatus.configured} cached=${usedCachedSession}`
    );
    // Log granted OAuth scopes — most direct signal for "scenes don't load"
    // bug reports. r:scenes:* (read) is required for scenes.list().
    const grantedScope = initialSessionStatus.session?.scope;
    const requestedScopes = initialSessionStatus.scopes;
    appendDebugLog(`OAuth scope granted=${grantedScope ?? 'n/a'} requested=${requestedScopes ?? 'n/a'}`);
  } catch (err) {
    console.warn('[SmartThingsControls] getSessionStatus error:', err);
    appendDebugLog(`Session status failed: ${getErrorMessage(err)}`);
    // Network/timeout failure here is almost always the phone being
    // backgrounded when the app is opened from the glasses (the /api/session
    // fetch is throttled and times out), NOT an actually-broken session. If
    // we have ANY credential, don't dead-end to "could not reach server" —
    // proceed optimistically and let the data loaders + watchdog recover. A
    // genuine 401 on a later SmartThings call still routes through
    // handleTerminalAuthFailure → connect panel.
    let pendingIdOnFail: string | null = null;
    try { pendingIdOnFail = localStorage.getItem('smartthings_controls_pending_auth'); } catch { /* ignore */ }
    const hasCredential = hasCredentialSignal({
      restoredToken: readStoredSessionToken(),
      urlSessionToken,
      pendingId: pendingIdOnFail,
    });
    if (hasCredential) {
      appendDebugLog('Session check failed but credential present — proceeding optimistically.');
      initialSessionStatus = { authenticated: true, configured: true };
      usedCachedSession = true;
    } else {
      void hub.updatePage(composeTextFallbackPage('SmartThings\n\nCould not reach server.\nOpen the companion on your phone.\n\nDouble-tap to exit.'));
      showPanel(AUTH_RETURN_ID);
      installExitOnlyEventHandler('server-unreachable');
      return;
    }
  }

  if (!initialSessionStatus.authenticated) {
    const disconnectMessage = initialSessionStatus.sessionExpired
      ? AUTH_SESSION_EXPIRED_MESSAGE
      : initialSessionStatus.configured
        ? AUTH_DISCONNECTED_MESSAGE
        : AUTH_CONFIG_MISSING_MESSAGE;
    void hub.updatePage(composeTextFallbackPage('SmartThings\n\nNot connected.\nOpen the companion on\nyour phone to connect.\n\nDouble-tap to exit.'));
    showConnectPanelWithDebug(disconnectMessage, initialSessionStatus.configured);
    installExitOnlyEventHandler('not-authenticated');
    return;
  }

  authUI.showConnectedState(initialSessionStatus);
  appendDebugLog('SmartThings session is active.');
  void requestWakeLock('startup');

  if (usedCachedSession) {
    void getSessionStatus().then(fresh => {
      appendDebugLog(`Background session verify: authenticated=${fresh.authenticated}`);
      if (fresh.authenticated) {
        writeCachedSessionStatus(fresh);
        authUI.setConnectionStatus(formatSessionExpiry(fresh.session?.expiresAt));
      } else {
        clearCachedSessionStatus();
        // API calls will fail with 401 and handleTerminalAuthFailure will show the auth panel.
      }
    }).catch(() => {
      // Ignore background check errors; API call failures will surface auth issues.
    });
  }

  const store = createStore(buildInitialState());
  const storedLaunchResumePromise = getStoredLaunchResume(hub).catch(() => null);

  let refreshPage: () => void = () => {};
  let smartThingsClient: SmartThingsClient | null = null;
  let authExpiredHandled = false;

  function invalidateSmartThingsClient(reason: string): void {
    smartThingsClient = null;
    appendDebugLog(`SmartThings client invalidated (${reason}).`);
  }

  async function createSmartThingsClient(forceRefresh = false): Promise<SmartThingsClient> {
    if (forceRefresh) smartThingsClient = null;
    if (smartThingsClient) return smartThingsClient;
    const token = await getSmartThingsAccessToken();
    smartThingsClient = new SmartThingsClient(new BearerTokenAuthenticator(token.accessToken));
    authUI.setConnectionStatus(formatSessionExpiry(token.expiresAt ?? initialSessionStatus.session?.expiresAt));
    return smartThingsClient;
  }

  async function handleTerminalAuthFailure(err: unknown): Promise<boolean> {
    if (!isSmartThingsAuthError(err)) return false;
    if (authExpiredHandled) return true;
    authExpiredHandled = true;
    invalidateSmartThingsClient('auth failure');
    await hub.setLocalStorage(SESSION_BRIDGE_KEY, '');
    await disconnectSmartThings().catch(() => undefined);
    store.dispatch({ type: 'AUTH_EXPIRED', message: AUTH_RECONNECT_MESSAGE });
    refreshPage();
    showConnectPanelWithDebug(AUTH_RECONNECT_MESSAGE);
    return true;
  }

  const withSmartThingsClient: WithSmartThingsClient = async <T>(
    operation: (client: SmartThingsClient) => Promise<T>
  ): Promise<T> => {
    try {
      const activeClient = await createSmartThingsClient(false);
      return await operation(activeClient);
    } catch (err) {
      if (!isSmartThingsAuthError(err)) throw err;
      try {
        const refreshedClient = await createSmartThingsClient(true);
        return await operation(refreshedClient);
      } catch (retryErr) {
        await handleTerminalAuthFailure(retryErr);
        throw retryErr;
      }
    }
  };

  const preferencesLoadPromise = (async () => {
    try {
      const prefs = await getStoredPreferences(hub);
      store.dispatch({ type: 'PREFERENCES_LOADED', preferences: prefs });
      refreshPage();
    } catch {
      // Keep defaults when preferences are missing or unreadable.
    }
  })();

  let useRawImages = false;
  let useRealGlasses = false;
  let roomsLoadPromise: Promise<void> | null = null;
  let glassesLayoutMode: GlassesLayoutMode = 'none';
  // Declared here (not next to getLocationId) so it's initialized before the
  // scenes/rooms loaders below call getLocationId(). getLocationId is a
  // hoisted function, but it closes over this `let` — referencing it before
  // this line executes would hit the temporal dead zone.
  let locationIdPromise: Promise<string | undefined> | null = null;

  // Note: menu was already painted instantly right after hub.init() above
  // (via the cached-session optimistic path). startupSuccess from that
  // paint is what the post-startup branches below check. No second BLE
  // paint here — once data loads, refreshPage() drives in-place updates.

  // Load-completion flags consumed by the watchdog below. A load is only
  // "done" once its data is actually in the store — an error or a hung
  // (never-resolving) SDK call leaves the flag false so the watchdog retries.
  let scenesLoaded = false;
  let roomsLoaded = false;
  // "settled" = the live load finished (success OR error) — drives the
  // "Refreshing…" stats hint off once both are done. "loaded" = real live
  // data is in the store (success only) — gates the watchdog + cache write.
  let scenesSettled = false;
  let roomsSettled = false;
  let listCacheWritten = false;

  function maybeFinishRefresh(): void {
    if (scenesSettled && roomsSettled) {
      store.dispatch({ type: 'LISTS_REFRESH_END' });
    }
  }

  function maybePersistListCache(): void {
    if (listCacheWritten || !scenesLoaded || !roomsLoaded) return;
    listCacheWritten = true;
    const st = store.getState();
    void hub
      .setLocalStorage(
        LIST_CACHE_KEY,
        serializeListSnapshot({ scenes: st.scenes, rooms: st.rooms, allDevices: st.allDevices }),
      )
      .then(() => appendDebugLog(`List cache written (scenes=${st.scenes.length} rooms=${st.rooms.length} devices=${st.allDevices.length}).`))
      .catch(() => { listCacheWritten = false; });
  }

  // Hydrate the lists from the on-device cache so the wearer sees their REAL
  // items immediately while the slow live refresh runs. Does NOT set the
  // scenesLoaded/roomsLoaded "live" flags (watchdog must still fetch fresh
  // data); the live dispatch overwrites this when it arrives. Guarded so a
  // late cache read never clobbers already-loaded fresh data.
  void (async () => {
    try {
      const snap = parseListSnapshot(await hub.getLocalStorage(LIST_CACHE_KEY));
      if (!snap) { appendDebugLog('List cache: none.'); return; }
      let applied = false;
      if (!scenesLoaded) { store.dispatch({ type: 'SCENES_LOADED', scenes: snap.scenes }); applied = true; }
      if (!roomsLoaded) {
        store.dispatch({ type: 'ROOMS_LOADED', rooms: snap.rooms });
        store.dispatch({ type: 'ALL_DEVICES_LOADED', devices: snap.allDevices });
        applied = true;
      }
      if (applied) {
        appendDebugLog(`List cache hydrated: scenes=${snap.scenes.length} rooms=${snap.rooms.length} devices=${snap.allDevices.length}.`);
        refreshPage();
      }
    } catch {
      // Live load covers it.
    }
  })();

  async function loadScenes(): Promise<void> {
    appendDebugLog('Scenes load: starting (via server relay)');
    try {
      // Route scene listing through our server, not direct browser→
      // api.smartthings.com. The direct call fails with a network-layer
      // error for some accounts (no HTTP response — CORS/redirect/reset)
      // even though rooms/devices/locations succeed and command execution
      // through the server works. The server proxy has no browser network
      // constraints and follows pagination server-side.
      const locationId = await getLocationId();
      appendDebugLog(`Scenes load: locationId=${locationId ? locationId.slice(0, 8) + '…' : 'none (all locations)'}`);
      const res = await listScenesViaServer(locationId);
      const items = Array.isArray(res.items) ? res.items : [];
      const normalized = normalizeScenes(items as SceneSummary[]);
      appendDebugLog(`Scenes load: success raw=${items.length} normalized=${normalized.length}`);
      store.dispatch({ type: 'SCENES_LOADED', scenes: normalized });
      scenesLoaded = true;
      scenesSettled = true;
      refreshPage();
      maybePersistListCache();
      maybeFinishRefresh();
    } catch (err) {
      scenesSettled = true;
      const status = (err as { status?: unknown; statusCode?: unknown })?.status
        ?? (err as { status?: unknown; statusCode?: unknown })?.statusCode;
      const message = getErrorMessage(err);
      appendDebugLog(`Scenes load: failed status=${status ?? 'n/a'} message=${message}`, true);
      if (await handleTerminalAuthFailure(err)) { maybeFinishRefresh(); return; }
      store.dispatch({ type: 'SCENES_ERROR', message });
      maybeFinishRefresh();
    }
  }

  void loadScenes();

  roomsLoadPromise = loadRooms();
  void roomsLoadPromise;
  void loadGlobalStats();

  // Watchdog: the rooms/devices path uses the SmartThings SDK's direct
  // browser→api.smartthings.com calls, which have NO timeout — a flaky or
  // backgrounded-phone network can leave them hung forever, so the static
  // menu shows but nothing loads under it. If either loader hasn't completed
  // after a delay, retry it (bounded). getLocationId() is memoized so this
  // doesn't re-hammer locations.list().
  const DATA_WATCHDOG_FIRST_MS = 12000;
  const DATA_WATCHDOG_RETRY_MS = 15000;
  const DATA_WATCHDOG_MAX_ATTEMPTS = 3;
  function scheduleDataLoadWatchdog(): void {
    let attempts = 0;
    const tick = (): void => {
      if (scenesLoaded && roomsLoaded) return;
      attempts += 1;
      appendDebugLog(
        `Data watchdog (attempt ${attempts}/${DATA_WATCHDOG_MAX_ATTEMPTS}): scenesLoaded=${scenesLoaded} roomsLoaded=${roomsLoaded} — retrying missing`,
        true
      );
      // New refresh cycle — show the "Refreshing…" hint again until the
      // retried loader(s) settle.
      store.dispatch({ type: 'LISTS_REFRESH_START' });
      if (!scenesLoaded) { scenesSettled = false; void loadScenes(); }
      if (!roomsLoaded) {
        roomsSettled = false;
        roomsLoadPromise = loadRooms();
        void roomsLoadPromise;
      }
      if (attempts < DATA_WATCHDOG_MAX_ATTEMPTS) {
        setTimeout(tick, DATA_WATCHDOG_RETRY_MS);
      } else {
        appendDebugLog('Data watchdog: max attempts reached; giving up.', true);
      }
    };
    setTimeout(tick, DATA_WATCHDOG_FIRST_MS);
  }
  scheduleDataLoadWatchdog();

  try {
    await loadIconCache();
    const deviceInfo = await hub.getDeviceInfo();
    // isRealGlasses() checks DeviceModel (G1/G2) — reliable on both real hardware
    // and the simulator regardless of hostname. The ehpk is served from 127.0.0.1
    // on a real device, so hostname-based simulator detection was incorrect.
    useRawImages = hub.isRealGlasses(deviceInfo);
    useRealGlasses = hub.isRealGlasses(deviceInfo);
    appendDebugLog(
      `Device info loaded. model=${deviceInfo?.model ?? 'unknown'} connectType=${deviceInfo?.status?.connectType ?? 'unknown'} rawImages=${useRawImages}`
    );
  } catch {
    // Icon preloading is optional; fallback icons are generated at render time.
    appendDebugLog('Device info lookup failed; continuing with default image settings.');
  }

  // Real glasses report gesture timing less consistently than the simulator.
  const TAP_WINDOW_MS = useRealGlasses ? 800 : 400;
  const TAP_COMMIT_MS = useRealGlasses ? 800 : 450;
  const SCROLL_WINDOW_MS = 400;
  let lastTapTime = 0;
  let lastTapIndex = -1;
  let tapCount = 0;
  let commitTimeoutId: ReturnType<typeof setTimeout> | null = null;
  const recentListIndices: { index: number; time: number }[] = [];
  // Set as soon as any glasses event is processed. applyInitialLaunchPreference
  // checks this and skips overriding the user's navigation if they've already
  // interacted — prevents the "tap → menu opens → snaps back to main" bounce
  // when the launch-preference apply Promise resolves after a buffered tap.
  let userHasInteracted = false;

  async function loadRooms(): Promise<void> {
    appendDebugLog('Rooms load: starting');
    try {
      const locationId = await getLocationId();
      if (!locationId) {
        appendDebugLog('Rooms load: aborted — no locationId returned', true);
        store.dispatch({ type: 'ROOMS_ERROR', message: 'No location found for rooms' });
        roomsSettled = true;
        refreshPage();
        maybeFinishRefresh();
        return;
      }
      appendDebugLog(`Rooms load: locationId=${locationId.slice(0, 8)}…`);
      const [roomsRes, devicesRes] = await Promise.all([
        withSmartThingsClient((client) => client.rooms.list(locationId)),
        withSmartThingsClient((client) => client.devices.list({ locationId }).catch(() => [])),
      ]);
      appendDebugLog(`Rooms load: success rooms=${roomsRes.length} devices=${devicesRes.length}`);
      store.dispatch({
        type: 'ROOMS_LOADED',
        rooms: [
          ...roomsRes.map((r) => ({
            roomId: r.roomId ?? '',
            roomName: (r.name ?? 'Room').slice(0, SCENE_NAME_MAX_LEN),
          })),
          ...(DEMO_DEVICES_ENABLED ? [{ roomId: DEMO_ROOM_ID, roomName: 'Demo Devices' }] : []),
        ],
      });
      store.dispatch({ type: 'ALL_DEVICES_LOADED', devices: normalizeDevices(devicesRes) });
      roomsLoaded = true;
      roomsSettled = true;
      maybePersistListCache();
    } catch (err) {
      roomsSettled = true;
      const status = (err as { status?: unknown; statusCode?: unknown })?.status
        ?? (err as { status?: unknown; statusCode?: unknown })?.statusCode;
      const message = getErrorMessage(err);
      appendDebugLog(`Rooms load: failed status=${status ?? 'n/a'} message=${message}`, true);
      if (await handleTerminalAuthFailure(err)) {
        refreshPage();
        maybeFinishRefresh();
        return;
      }
      store.dispatch({ type: 'ROOMS_ERROR', message });
    }
    refreshPage();
    maybeFinishRefresh();
  }

  // Memoize the locationId lookup — scenes, rooms, and global-stats loaders
  // all need it and previously each triggered its own locations.list() call.
  // (locationIdPromise is declared near the top of initApp to avoid a TDZ
  // when the early scenes/rooms loaders call this hoisted function.)
  function getLocationId(): Promise<string | undefined> {
    if (!locationIdPromise) {
      locationIdPromise = (async () => {
        try {
          const locations = await withSmartThingsClient((client) => client.locations.list());
          appendDebugLog(`Locations load: success n=${locations.length}`);
          return locations[0]?.locationId;
        } catch (err) {
          const status = (err as { status?: unknown; statusCode?: unknown })?.status
            ?? (err as { status?: unknown; statusCode?: unknown })?.statusCode;
          appendDebugLog(`Locations load: failed status=${status ?? 'n/a'} message=${getErrorMessage(err)} (falling back to scenes.list)`, true);
          try {
            const scenes = await withSmartThingsClient((client) => client.scenes.list());
            return scenes[0]?.locationId;
          } catch (err2) {
            const status2 = (err2 as { status?: unknown; statusCode?: unknown })?.status
              ?? (err2 as { status?: unknown; statusCode?: unknown })?.statusCode;
            appendDebugLog(`Locations fallback (scenes.list): failed status=${status2 ?? 'n/a'} message=${getErrorMessage(err2)}`, true);
            locationIdPromise = null; // allow a later retry
            return undefined;
          }
        }
      })();
    }
    return locationIdPromise;
  }

  function canUseRichGlassesLayout(): boolean {
    return glassesLayoutMode === 'rich';
  }

  function canUseTextGlassesLayout(): boolean {
    return glassesLayoutMode === 'text';
  }

  function canUseConfirmationImage(): boolean {
    return canUseRichGlassesLayout() || canUseTextGlassesLayout();
  }

  function getTextModeListContent(): string {
    return composeTextModeListContent(store.getState());
  }

  function getTextModeStatsContent(): string {
    return composeTextModeStatsContent(store.getState());
  }

  function updateTextModePage(_reason: string): boolean {
    hub.updateText(CONTAINER_ID_BOOT_LIST, CONTAINER_NAME_BOOT_LIST, getTextModeListContent());
    hub.updateText(CONTAINER_ID_STATS, CONTAINER_NAME_STATS, getTextModeStatsContent());
    return true;
  }

  function updateStatsPanel(): void {
    if (canUseTextGlassesLayout()) {
      void updateTextModePage('stats update');
      return;
    }
    if (!canUseRichGlassesLayout()) return;
    if (!store.getState().preferences.statsVisibility.enabled) return;
    void hub.updateText(CONTAINER_ID_STATS, CONTAINER_NAME_STATS, getStatsContent(store.getState()));
  }

  async function pushInitialImages(): Promise<void> {
    if (!canUseConfirmationImage()) return;
    const blankConfirmation = getBlankImageData(CONFIRMATION_WIDTH, CONFIRMATION_HEIGHT, useRawImages);
    await hub.updateBoardImage(
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_CONFIRMATION,
        containerName: CONTAINER_NAME_CONFIRMATION,
        imageData: blankConfirmation,
      })
    );
  }

  /** Rebuild and send the current page, preserving the list focus so it doesn't jump to top. */
  async function rebuildFullPage(reason: string): Promise<boolean> {
    const state = store.getState();
    const lastListIndex = getLastListIndex(state);
    const focusIndex = Math.min(state.focusedListIndex, lastListIndex);
    const richSuccess = await hub.updatePage(composePageForState(state, focusIndex));
    if (richSuccess) {
      if (glassesLayoutMode !== 'rich') {
        appendDebugLog(`Glasses page rebuild succeeded with rich layout (${reason}).`);
      }
      glassesLayoutMode = 'rich';
      hub.resetImageDirtyTracking();
      return true;
    }

    appendDebugLog(`Rich glasses rebuild failed (${reason}). Trying list-only fallback.`, true);
    const listSuccess = await hub.updatePage(composeListOnlyPage(state, focusIndex));
    if (listSuccess) {
      if (glassesLayoutMode !== 'list') {
        appendDebugLog('Recovered with list-only glasses layout.');
      }
      glassesLayoutMode = 'list';
      hub.resetImageDirtyTracking();
      return true;
    }

    appendDebugLog(`List-only glasses rebuild failed (${reason}). Trying text fallback.`, true);
    const textFallback = await hub.updatePage(
      composeTextFallbackPage('SmartThings connected\n\nGlasses UI fallback active\n\nOpen the phone runtime console for details.')
    );
    if (textFallback) {
      if (glassesLayoutMode !== 'text') {
        appendDebugLog('Recovered with text-only glasses fallback layout.');
      }
      glassesLayoutMode = 'text';
      hub.resetImageDirtyTracking();
      return true;
    }

    glassesLayoutMode = 'none';
    appendDebugLog(`Text fallback rebuild failed (${reason}).`, true);
    return false;
  }

  refreshPage = (): void => {
    if (canUseTextGlassesLayout()) {
      void updateTextModePage('state refresh');
      return;
    }
    void rebuildFullPage('state refresh');
  };

  if (startupSuccess && useRealGlasses) {
    glassesLayoutMode = 'text';
    appendDebugLog('Using fixed text glasses layout for real-device compatibility.');
    updateTextModePage('post-startup text layout');
  } else if (startupSuccess) {
    const rebuilt = await rebuildFullPage('post-startup full layout');
    if (!rebuilt) {
      authUI.setConnectionStatus('Connected, but the glasses UI failed to initialize. Open the runtime console on your phone.');
    }
  } else {
    const rebuilt = await rebuildFullPage('startup fallback');
    if (!rebuilt) {
      authUI.setConnectionStatus('Connected, but the glasses UI failed to initialize. Open the runtime console on your phone.');
    }
  }

  if (canUseConfirmationImage()) {
    await new Promise((r) => setTimeout(r, 200));
    await pushInitialImages();
    setTimeout(() => void pushInitialImages(), 800);
  }

  async function loadGlobalStats(): Promise<void> {
    try {
      const locationId = await getLocationId();
      if (!locationId) return;
      const devices = await withSmartThingsClient((client) =>
        client.devices.list({ locationId, includeHealth: true })
      );
      let online = 0;
      let offline = 0;
      for (const d of devices) {
        const health = (d as Device & { healthState?: { state?: string } }).healthState?.state;
        if (health === 'ONLINE') online++;
        else if (health === 'OFFLINE') offline++;
        else {
          try {
            const h = await withSmartThingsClient((client) => client.devices.getHealth(d.deviceId));
            if (h.state === DeviceHealthState.ONLINE) online++;
            else if (h.state === DeviceHealthState.OFFLINE) offline++;
          } catch {
            offline++;
          }
        }
      }
      store.dispatch({
        type: 'STATS_GLOBAL',
        stats: { total: devices.length, online, offline },
      });
    } catch (err) {
      await handleTerminalAuthFailure(err);
      // Leave global stats unset if fetching fails.
    }
    // Update only the stats panel so list selection doesn't jump to top
    updateStatsPanel();
  }

  async function loadRoomStats(): Promise<void> {
    const devices = store.getState().devices;
    if (devices.length === 0) {
      store.dispatch({ type: 'STATS_ROOM', stats: null });
      updateStatsPanel();
      return;
    }
    try {
      let online = 0;
      let offline = 0;
      for (const d of devices) {
        try {
          const h = await withSmartThingsClient((client) => client.devices.getHealth(d.deviceId));
          if (h.state === DeviceHealthState.ONLINE) online++;
          else if (h.state === DeviceHealthState.OFFLINE) offline++;
        } catch {
          offline++;
        }
      }
      store.dispatch({
        type: 'STATS_ROOM',
        stats: { total: devices.length, online, offline },
      });
    } catch (err) {
      await handleTerminalAuthFailure(err);
      store.dispatch({ type: 'STATS_ROOM', stats: null });
    }
    updateStatsPanel();
  }

  type DeviceStatusShape = {
    components?: Record<
      string,
      Record<string, Record<string, { value?: unknown; unit?: string }>>
    >;
  };

  /** Humanize camelCase or lowercase attribute name for display (e.g. coolingSetpoint -> "Cooling Setpoint"). */
  function humanizeAttributeName(name: string): string {
    if (!name.trim()) return name;
    const withSpaces = name.replace(/([A-Z])/g, ' $1').trim();
    return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1).toLowerCase();
  }

  /** Format a single attribute value for display; returns null if value should be skipped. */
  function formatAttributeValue(value: unknown, unit?: string): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value === 'object' && !Array.isArray(value)) return null;
    if (Array.isArray(value)) return null;
    if (typeof value === 'number') {
      const rounded = Number.isInteger(value) ? String(value) : value.toFixed(2);
      return unit ? `${rounded} ${unit}` : rounded;
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  }

  /**
   * Whitelist from device presentation: (component|capability|attribute) exact keys and
   * (component|capability) keys that allow any attribute for that pair.
   */
  type PresentationWhitelist = {
    exact: Set<string>;
    capabilityOnly: Set<string>;
  };

  /** Extract attribute name from a path like "temperature.value" or "switch.unit". */
  function attributeNameFromPath(path: string): string | null {
    if (typeof path !== 'string' || !path.includes('.')) return null;
    const attr = path.split('.')[0]?.trim();
    return attr || null;
  }

  /** Recursively find any state.value or state.unit string in an object. */
  function findStatePaths(obj: unknown, out: string[]): void {
    if (obj === null || typeof obj !== 'object') return;
    const o = obj as Record<string, unknown>;
    if (typeof o.state === 'object' && o.state !== null) {
      const s = o.state as Record<string, unknown>;
      if (typeof s.value === 'string') out.push(s.value);
      if (typeof s.unit === 'string') out.push(s.unit);
    }
    for (const v of Object.values(o)) {
      findStatePaths(v, out);
    }
  }

  /** Build whitelist from device presentation (dashboard.states + detailView). Returns null if presentation is missing or empty. */
  function presentationWhitelistFromResponse(presentation: unknown): PresentationWhitelist | null {
    if (!presentation || typeof presentation !== 'object') return null;
    const p = presentation as Record<string, unknown>;
    const exact = new Set<string>();
    const capabilityOnly = new Set<string>();

    const add = (component: string, capability: string, attribute?: string) => {
      const comp = component || 'main';
      if (attribute) exact.add(`${comp}|${capability}|${attribute}`);
      else capabilityOnly.add(`${comp}|${capability}`);
    };

    const dash = p.dashboard as Record<string, unknown> | undefined;
    if (dash?.states && Array.isArray(dash.states)) {
      for (const s of dash.states) {
        const item = s as Record<string, unknown>;
        const component = (item.component as string) ?? 'main';
        const capability = (item.capability as string) ?? '';
        if (capability) add(component, capability);
      }
    }

    if (p.detailView && Array.isArray(p.detailView)) {
      for (const entry of p.detailView) {
        const item = entry as Record<string, unknown>;
        const component = (item.component as string) ?? 'main';
        const capability = (item.capability as string) ?? '';
        if (!capability) continue;
        const paths: string[] = [];
        findStatePaths(item, paths);
        if (paths.length > 0) {
          for (const path of paths) {
            const attr = attributeNameFromPath(path);
            if (attr) add(component, capability, attr);
          }
        } else {
          add(component, capability);
        }
      }
    }

    if (exact.size === 0 && capabilityOnly.size === 0) return null;
    return { exact, capabilityOnly };
  }

  function isInPresentationWhitelist(
    whitelist: PresentationWhitelist | null,
    componentId: string,
    capabilityId: string,
    attrName: string
  ): boolean {
    if (!whitelist) return true;
    const exactKey = `${componentId}|${capabilityId}|${attrName}`;
    if (whitelist.exact.has(exactKey)) return true;
    const pairKey = `${componentId}|${capabilityId}`;
    if (whitelist.capabilityOnly.has(pairKey)) return true;
    return false;
  }

  /** Build capability readings from status, optionally filtered by presentation whitelist. Skips switch/switchLevel (already shown). */
  function capabilityReadingsFromStatus(
    status: DeviceStatusShape,
    presentationWhitelist: PresentationWhitelist | null
  ): Array<{ label: string; value: string }> {
    const components = status?.components;
    if (!components || typeof components !== 'object') return [];
    const result: Array<{ label: string; value: string }> = [];
    const componentIds = Object.keys(components).sort();
    for (const componentId of componentIds) {
      const comp = components[componentId];
      if (!comp || typeof comp !== 'object') continue;
      const capabilityIds = Object.keys(comp).sort();
      for (const capabilityId of capabilityIds) {
        const cap = comp[capabilityId];
        if (!cap || typeof cap !== 'object') continue;
        if (capabilityId === 'switch' && 'switch' in cap) continue;
        if (capabilityId === 'switchLevel' && 'level' in cap) continue;
        const attrNames = Object.keys(cap).sort();
        for (const attrName of attrNames) {
          if (attrName.toLowerCase().endsWith('version')) continue;
          if (attrName.toLowerCase().includes('update')) continue;
          if (!isInPresentationWhitelist(presentationWhitelist, componentId, capabilityId, attrName)) continue;
          const attr = cap[attrName];
          if (!attr || typeof attr !== 'object') continue;
          const formatted = formatAttributeValue(attr.value, attr.unit);
          if (formatted === null) continue;
          const baseLabel = humanizeAttributeName(attrName);
          const label = componentId === 'main' ? baseLabel : `${componentId} ${baseLabel}`;
          result.push({ label, value: formatted });
        }
      }
    }
    return result;
  }

  function switchStatusFromDeviceStatus(status: DeviceStatusShape): string {
    const main = status?.components?.main;
    if (!main) return '-';
    const switchCap = main.switch;
    if (!switchCap) return '-';
    const switchAttr = switchCap.switch;
    const v = switchAttr?.value;
    if (v === 'on') return 'On';
    if (v === 'off') return 'Off';
    return '-';
  }

  function brightnessFromDeviceStatus(status: DeviceStatusShape): number | null {
    const main = status?.components?.main;
    if (!main) return null;
    const switchLevelCap = main.switchLevel;
    if (!switchLevelCap) return null;
    const levelAttr = switchLevelCap.level;
    const v = levelAttr?.value;
    if (typeof v === 'number' && v >= 0 && v <= 100) return Math.round(v);
    return null;
  }

  async function loadDeviceStats(deviceId: string): Promise<void> {
    try {
      const [health, status, presentation] = await Promise.all([
        withSmartThingsClient((client) => client.devices.getHealth(deviceId)),
        withSmartThingsClient((client) => client.devices.getStatus(deviceId)),
        withSmartThingsClient((client) => client.devices.getPresentation(deviceId).catch(() => null)),
      ]);
      const statusShape = status as DeviceStatusShape;
      const onlineStatus =
        health.state === DeviceHealthState.ONLINE
          ? 'Online'
          : health.state === DeviceHealthState.OFFLINE
            ? 'Offline'
            : 'Unknown';
      const isOffline = onlineStatus === 'Offline';
      const switchStatus = isOffline ? '-' : switchStatusFromDeviceStatus(statusShape);
      const brightness = isOffline ? null : brightnessFromDeviceStatus(statusShape);
      const whitelist = presentationWhitelistFromResponse(presentation);
      const capabilityReadings = isOffline ? [] : capabilityReadingsFromStatus(statusShape, whitelist);
      store.dispatch({
        type: 'STATS_DEVICE',
        stats: { onlineStatus, switchStatus, brightness, capabilityReadings },
      });
    } catch (err) {
      await handleTerminalAuthFailure(err);
      store.dispatch({ type: 'STATS_DEVICE', stats: null });
    }
    updateStatsPanel();
  }

  const CONFIRM_DISMISS_MS = 5000;
  const CONFIRM_FLASH_MS = 150;
  const TEXT_MODE_SCROLL_COOLDOWN_MS = 90;
  // Minimum time the "…" pending indicator must stay on screen before a
  // success/failure result is allowed to replace it. Without this, a fast
  // command renders the result almost immediately and the pending dots
  // either never show or flash by unseen — the user just sees the checkmark
  // appear "after a moment" with no in-flight feedback.
  const MIN_PENDING_VISIBLE_MS = 600;
  let confirmationDismissTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let confirmationShowing: ConfirmationResult | null = null;
  let pendingShownAt = 0;
  let lastTextModeScrollAt = 0;
  let lastTextModeScrollDirection: -1 | 0 | 1 = 0;

  const showConfirmation: ShowConfirmationFn = async (result: ConfirmationResult): Promise<void> => {
    if (!canUseConfirmationImage()) return;
    if (confirmationDismissTimeoutId !== null) {
      clearTimeout(confirmationDismissTimeoutId);
      confirmationDismissTimeoutId = null;
    }
    if (result === 'pending') {
      pendingShownAt = Date.now();
    } else if (confirmationShowing === 'pending' && pendingShownAt > 0) {
      // Replacing the in-flight indicator with a result — make sure the
      // wearer actually saw the "…" for a readable minimum first.
      const elapsed = Date.now() - pendingShownAt;
      if (elapsed < MIN_PENDING_VISIBLE_MS) {
        await new Promise((r) => setTimeout(r, MIN_PENDING_VISIBLE_MS - elapsed));
      }
      pendingShownAt = 0;
    }
    // Skip the blank-and-re-show flash for 'pending' (in-flight indicator —
    // flickering it on itself looks broken). Other results still flash so
    // back-to-back identical results read as distinct events.
    if (confirmationShowing === result && result !== 'pending') {
      const blank = getBlankImageData(CONFIRMATION_WIDTH, CONFIRMATION_HEIGHT, useRawImages);
      await hub.updateBoardImage(
        new ImageRawDataUpdate({
          containerID: CONTAINER_ID_CONFIRMATION,
          containerName: CONTAINER_NAME_CONFIRMATION,
          imageData: blank,
        })
      );
      await new Promise((r) => setTimeout(r, CONFIRM_FLASH_MS));
    }
    await hub.updateBoardImage(
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_CONFIRMATION,
        containerName: CONTAINER_NAME_CONFIRMATION,
        imageData: useRawImages ? getConfirmationImageDataRaw(result) : getConfirmationImageData(result),
      })
    );
    confirmationShowing = result;
    // 'pending' is replaced when the in-flight command resolves; never auto-dismiss it.
    if (result === 'pending') return;
    confirmationDismissTimeoutId = setTimeout(() => {
      confirmationDismissTimeoutId = null;
      confirmationShowing = null;
      const blank = getBlankImageData(CONFIRMATION_WIDTH, CONFIRMATION_HEIGHT, useRawImages);
      void hub.updateBoardImage(
        new ImageRawDataUpdate({
          containerID: CONTAINER_ID_CONFIRMATION,
          containerName: CONTAINER_NAME_CONFIRMATION,
          imageData: blank,
        })
      );
    }, CONFIRM_DISMISS_MS);
  };

  /** Show the "…" in-flight indicator immediately, then run the command. The
   *  indicator renders in parallel with the network relay; showConfirmation()
   *  guarantees it stays visible for MIN_PENDING_VISIBLE_MS before the
   *  success/failure result replaces it, so the wearer always gets in-flight
   *  feedback regardless of how fast the relay returns. */
  async function withPendingFeedback<T>(op: () => Promise<T>): Promise<T> {
    void showConfirmation('pending');
    return op();
  }

  /** True if command response has no FAILED result and device is not OFFLINE. */
  async function isDeviceCommandSuccess(
    deviceId: string,
    response: { results?: Array<{ status?: string }> }
  ): Promise<boolean> {
    const results = response?.results ?? [];
    if (results.some((r) => r.status === 'FAILED')) return false;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return true;
    }
    try {
      const health = await withSmartThingsClient((client) => client.devices.getHealth(deviceId));
      if (health.state === DeviceHealthState.OFFLINE) return false;
    } catch {
      // Command already accepted; do not fail solely because health lookup failed.
    }
    return true;
  }

  async function runDeviceSwitch(deviceId: string, on: boolean): Promise<void> {
    try {
      appendDebugLog(
        `Device switch requested. deviceId=${deviceId} command=${on ? 'on' : 'off'} visibility=${typeof document !== 'undefined' ? document.visibilityState : 'unknown'}`
      );
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, 'switch', on ? 'on' : 'off'));
      const success = await isDeviceCommandSuccess(deviceId, response);
      appendDebugLog(`Device switch result. deviceId=${deviceId} success=${success}`);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) void loadDeviceStats(deviceId);
    } catch (err) {
      appendDebugLog(`Device switch failed. deviceId=${deviceId} error=${getErrorMessage(err)}`, true);
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runDeviceSetLevel(deviceId: string, level: number): Promise<void> {
    try {
      appendDebugLog(
        `Device level requested. deviceId=${deviceId} level=${level} visibility=${typeof document !== 'undefined' ? document.visibilityState : 'unknown'}`
      );
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, 'switchLevel', 'setLevel', [level]));
      const success = await isDeviceCommandSuccess(deviceId, response);
      appendDebugLog(`Device level result. deviceId=${deviceId} level=${level} success=${success}`);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) {
        const state = store.getState();
        const current = state.deviceStats;
        store.dispatch({
          type: 'STATS_DEVICE',
          stats: current
            ? { ...current, brightness: level }
            : { onlineStatus: 'Unknown', switchStatus: '-', brightness: level },
        });
        updateStatsPanel();
        // Skip immediate refetch because SmartThings can return stale brightness right after setLevel.
      }
    } catch (err) {
      appendDebugLog(`Device level failed. deviceId=${deviceId} level=${level} error=${getErrorMessage(err)}`, true);
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runGarageDoor(deviceId: string, open: boolean, capability: 'garageDoorControl' | 'doorControl' = 'garageDoorControl'): Promise<void> {
    try {
      appendDebugLog(`Garage door requested. deviceId=${deviceId} capability=${capability} command=${open ? 'open' : 'close'}`);
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, capability, open ? 'open' : 'close'));
      const success = await isDeviceCommandSuccess(deviceId, response);
      appendDebugLog(`Garage door result. deviceId=${deviceId} success=${success}`);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) void loadDeviceStats(deviceId);
    } catch (err) {
      appendDebugLog(`Garage door failed. deviceId=${deviceId} error=${getErrorMessage(err)}`, true);
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runLock(deviceId: string, lock: boolean): Promise<void> {
    try {
      appendDebugLog(`Lock requested. deviceId=${deviceId} command=${lock ? 'lock' : 'unlock'}`);
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, 'lock', lock ? 'lock' : 'unlock'));
      const success = await isDeviceCommandSuccess(deviceId, response);
      appendDebugLog(`Lock result. deviceId=${deviceId} success=${success}`);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) void loadDeviceStats(deviceId);
    } catch (err) {
      appendDebugLog(`Lock failed. deviceId=${deviceId} error=${getErrorMessage(err)}`, true);
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runMediaPlayback(deviceId: string, command: 'play' | 'pause' | 'stop'): Promise<void> {
    try {
      appendDebugLog(`Media playback requested. deviceId=${deviceId} command=${command}`);
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, 'mediaPlayback', command));
      const success = await isDeviceCommandSuccess(deviceId, response);
      appendDebugLog(`Media playback result. deviceId=${deviceId} success=${success}`);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) void loadDeviceStats(deviceId);
    } catch (err) {
      appendDebugLog(`Media playback failed. deviceId=${deviceId} error=${getErrorMessage(err)}`, true);
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runAudioVolume(deviceId: string, direction: 'up' | 'down'): Promise<void> {
    try {
      appendDebugLog(`Audio volume requested. deviceId=${deviceId} command=volume${direction === 'up' ? 'Up' : 'Down'}`);
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(
        deviceId, 'audioVolume', direction === 'up' ? 'volumeUp' : 'volumeDown'
      ));
      const success = await isDeviceCommandSuccess(deviceId, response);
      appendDebugLog(`Audio volume result. deviceId=${deviceId} success=${success}`);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) void loadDeviceStats(deviceId);
    } catch (err) {
      appendDebugLog(`Audio volume failed. deviceId=${deviceId} error=${getErrorMessage(err)}`, true);
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runAudioMute(deviceId: string, mute: boolean): Promise<void> {
    try {
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, 'audioMute', mute ? 'mute' : 'unmute'));
      const success = await isDeviceCommandSuccess(deviceId, response);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) void loadDeviceStats(deviceId);
    } catch (err) {
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runMediaTrackControl(deviceId: string, direction: 'next' | 'prev'): Promise<void> {
    try {
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(
        deviceId, 'mediaTrackControl', direction === 'next' ? 'nextTrack' : 'previousTrack'
      ));
      const success = await isDeviceCommandSuccess(deviceId, response);
      await showConfirmation(success ? 'success' : 'failure');
    } catch (err) {
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runTvChannel(deviceId: string, direction: 'up' | 'down'): Promise<void> {
    try {
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(
        deviceId, 'tvChannel', direction === 'up' ? 'channelUp' : 'channelDown'
      ));
      const success = await isDeviceCommandSuccess(deviceId, response);
      await showConfirmation(success ? 'success' : 'failure');
    } catch (err) {
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runWindowShade(deviceId: string, command: 'open' | 'close' | 'pause'): Promise<void> {
    try {
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, 'windowShade', command));
      const success = await isDeviceCommandSuccess(deviceId, response);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) void loadDeviceStats(deviceId);
    } catch (err) {
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runWindowShadeLevel(deviceId: string, delta: 10 | -10): Promise<void> {
    try {
      const status = await withSmartThingsClient((client) =>
        client.devices.getStatus(deviceId)
      ) as DeviceStatusShape;
      const current = status?.components?.main?.windowShadeLevel?.shadeLevel?.value;
      if (typeof current !== 'number') { await showConfirmation('failure'); return; }
      const next = Math.max(0, Math.min(100, Math.round(current + delta)));
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, 'windowShadeLevel', 'setShadeLevel', [next]));
      const success = await isDeviceCommandSuccess(deviceId, response);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) void loadDeviceStats(deviceId);
    } catch (err) {
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runMediaInputSource(deviceId: string, source: string): Promise<void> {
    try {
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, 'mediaInputSource', 'setInputSource', [source]));
      const success = await isDeviceCommandSuccess(deviceId, response);
      await showConfirmation(success ? 'success' : 'failure');
    } catch (err) {
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runThermostatFanMode(deviceId: string, mode: 'auto' | 'on' | 'circulate' | 'followschedule'): Promise<void> {
    try {
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, 'thermostatFanMode', 'setThermostatFanMode', [mode]));
      const success = await isDeviceCommandSuccess(deviceId, response);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) void loadDeviceStats(deviceId);
    } catch (err) {
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runValve(deviceId: string, open: boolean): Promise<void> {
    try {
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, 'valve', open ? 'open' : 'close'));
      const success = await isDeviceCommandSuccess(deviceId, response);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) void loadDeviceStats(deviceId);
    } catch (err) {
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runAlarm(deviceId: string, command: 'siren' | 'strobe' | 'both' | 'off'): Promise<void> {
    try {
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, 'alarm', command));
      const success = await isDeviceCommandSuccess(deviceId, response);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) void loadDeviceStats(deviceId);
    } catch (err) {
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runThermostatMode(deviceId: string, mode: 'heat' | 'cool' | 'auto' | 'off' | 'emergencyHeat'): Promise<void> {
    try {
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, 'thermostatMode', mode));
      const success = await isDeviceCommandSuccess(deviceId, response);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) void loadDeviceStats(deviceId);
    } catch (err) {
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runThermostatSetpoint(
    deviceId: string,
    which: 'heating' | 'cooling',
    delta: 1 | -1
  ): Promise<void> {
    try {
      const status = await withSmartThingsClient((client) =>
        client.devices.getStatus(deviceId)
      ) as DeviceStatusShape;
      const main = status?.components?.main;
      const capId = which === 'heating' ? 'thermostatHeatingSetpoint' : 'thermostatCoolingSetpoint';
      const attrId = which === 'heating' ? 'heatingSetpoint' : 'coolingSetpoint';
      const command = which === 'heating' ? 'setHeatingSetpoint' : 'setCoolingSetpoint';
      const current = main?.[capId]?.[attrId]?.value;
      if (typeof current !== 'number') { await showConfirmation('failure'); return; }
      const next = Math.round(current + delta);
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, capId, command, [next]));
      const success = await isDeviceCommandSuccess(deviceId, response);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) void loadDeviceStats(deviceId);
    } catch (err) {
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runFanSpeed(deviceId: string, delta: 1 | -1): Promise<void> {
    try {
      const status = await withSmartThingsClient((client) =>
        client.devices.getStatus(deviceId)
      ) as DeviceStatusShape;
      const current = status?.components?.main?.fanSpeed?.fanSpeed?.value;
      if (typeof current !== 'number') { await showConfirmation('failure'); return; }
      const next = Math.max(0, Math.round(current + delta));
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, 'fanSpeed', 'setFanSpeed', [next]));
      const success = await isDeviceCommandSuccess(deviceId, response);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) void loadDeviceStats(deviceId);
    } catch (err) {
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runColorTemperature(deviceId: string, direction: 'warmer' | 'cooler'): Promise<void> {
    try {
      const status = await withSmartThingsClient((client) =>
        client.devices.getStatus(deviceId)
      ) as DeviceStatusShape;
      const current = status?.components?.main?.colorTemperature?.colorTemperature?.value;
      if (typeof current !== 'number') { await showConfirmation('failure'); return; }
      const step = 200;
      const next = Math.max(1000, Math.min(30000, Math.round(current + (direction === 'warmer' ? -step : step))));
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, 'colorTemperature', 'setColorTemperature', [next]));
      const success = await isDeviceCommandSuccess(deviceId, response);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) void loadDeviceStats(deviceId);
    } catch (err) {
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runColorControl(deviceId: string, hue: number): Promise<void> {
    try {
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, 'colorControl', 'setColor', [{ hue, saturation: 100 }]));
      const success = await isDeviceCommandSuccess(deviceId, response);
      await showConfirmation(success ? 'success' : 'failure');
    } catch (err) {
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runMomentary(deviceId: string): Promise<void> {
    try {
      const response = await withPendingFeedback(() => executeDeviceCommandViaServer(deviceId, 'momentary', 'push'));
      const success = await isDeviceCommandSuccess(deviceId, response);
      await showConfirmation(success ? 'success' : 'failure');
    } catch (err) {
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runAllDevicesInRoomSwitch(on: boolean): Promise<void> {
    const devices = store.getState().devices.filter((d) => d.supportsSwitch);
    if (devices.length === 0) {
      await showConfirmation('failure');
      return;
    }
    appendDebugLog(
      `Batch switch requested. count=${devices.length} command=${on ? 'on' : 'off'} visibility=${typeof document !== 'undefined' ? document.visibilityState : 'unknown'}`
    );
    let results: SmartThingsBatchRelayResult[] = [];
    try {
      const response = await withPendingFeedback(() => executeBatchDeviceCommandsViaServer(
        devices.map((device) => ({
          deviceId: device.deviceId,
          capability: 'switch',
          command: on ? 'on' : 'off',
        }))
      ));
      results = response.results ?? [];
    } catch (err) {
      if (await handleTerminalAuthFailure(err)) return;
    }
    const successCount = results.filter((entry) => entry.ok).length;
    appendDebugLog(`Batch switch result. success=${successCount}/${devices.length}`);
    await showConfirmation(confirmationResultFromCounts(successCount, devices.length));
  }

  async function runAllDimmableDevicesSetLevel(level: number): Promise<void> {
    const devices = store.getState().devices.filter((d) => d.supportsDimmer);
    if (devices.length === 0) {
      await showConfirmation('failure');
      return;
    }
    appendDebugLog(
      `Batch level requested. count=${devices.length} level=${level} visibility=${typeof document !== 'undefined' ? document.visibilityState : 'unknown'}`
    );
    let results: SmartThingsBatchRelayResult[] = [];
    try {
      const response = await withPendingFeedback(() => executeBatchDeviceCommandsViaServer(
        devices.map((device) => ({
          deviceId: device.deviceId,
          capability: 'switchLevel',
          command: 'setLevel',
          arguments: [level],
        }))
      ));
      results = response.results ?? [];
    } catch (err) {
      if (await handleTerminalAuthFailure(err)) return;
    }
    const successCount = results.filter((entry) => entry.ok).length;
    appendDebugLog(`Batch level result. success=${successCount}/${devices.length} level=${level}`);
    await showConfirmation(confirmationResultFromCounts(successCount, devices.length));
  }

  async function loadDevicesForRoom(roomId: string): Promise<void> {
    if (DEMO_DEVICES_ENABLED && roomId === DEMO_ROOM_ID) {
      store.dispatch({ type: 'DEVICES_LOADED', devices: DEMO_DEVICES });
      refreshPage();
      return;
    }
    try {
      const locationId = await getLocationId();
      const devices = await withSmartThingsClient((client) => client.rooms.listDevices(roomId, locationId));
      store.dispatch({ type: 'DEVICES_LOADED', devices: normalizeDevices(devices) });
      refreshPage();
      void loadRoomStats();
    } catch (err) {
      if (await handleTerminalAuthFailure(err)) {
        refreshPage();
        return;
      }
      const message = getErrorMessage(err);
      store.dispatch({ type: 'DEVICES_ERROR', message });
      refreshPage();
    }
  }

  async function ensureRoomsLoaded(): Promise<void> {
    if (!roomsLoadPromise) roomsLoadPromise = loadRooms();
    await roomsLoadPromise;
  }

  async function restoreRoomDevicesView(roomId: string): Promise<boolean> {
    await ensureRoomsLoaded();
    if (!store.getState().rooms.some((room) => room.roomId === roomId)) return false;
    store.dispatch({ type: 'NAV_ROOM', roomId });
    refreshPage();
    await loadDevicesForRoom(roomId);
    return true;
  }

  async function restoreFavoriteDeviceView(deviceId: string, openDimView: boolean): Promise<boolean> {
    await ensureRoomsLoaded();
    if (!store.getState().allDevices.some((device) => device.deviceId === deviceId)) return false;
    store.dispatch({ type: 'NAV_FAVORITE_DEVICE', deviceId });
    refreshPage();
    void loadDeviceStats(deviceId);
    if (openDimView) {
      store.dispatch({ type: 'NAV_VIEW', view: 'device-dim' });
      refreshPage();
    }
    return true;
  }

  async function restoreRoomDeviceView(
    roomId: string,
    deviceId: string,
    openDimView: boolean
  ): Promise<boolean> {
    const restoredRoom = await restoreRoomDevicesView(roomId);
    if (!restoredRoom) return false;
    if (!store.getState().devices.some((device) => device.deviceId === deviceId)) return false;
    store.dispatch({ type: 'NAV_DEVICE', deviceId });
    refreshPage();
    void loadDeviceStats(deviceId);
    if (openDimView) {
      store.dispatch({ type: 'NAV_VIEW', view: 'device-dim' });
      refreshPage();
    }
    return true;
  }

  async function restoreLaunchResume(launchResume: LaunchResumeState | null): Promise<boolean> {
    if (!launchResume) return false;

    switch (launchResume.view) {
      case 'scenes':
        store.dispatch({ type: 'NAV_VIEW', view: 'scenes' });
        refreshPage();
        return true;
      case 'favorites':
        if (store.getState().preferences.favoritesIds.length === 0) return false;
        store.dispatch({ type: 'NAV_VIEW', view: 'favorites' });
        refreshPage();
        return true;
      case 'rooms':
        store.dispatch({ type: 'NAV_VIEW', view: 'rooms' });
        refreshPage();
        void ensureRoomsLoaded();
        return true;
      case 'devices':
        return launchResume.roomId ? restoreRoomDevicesView(launchResume.roomId) : false;
      case 'room-all-detail': {
        if (!launchResume.roomId) return false;
        const restored = await restoreRoomDevicesView(launchResume.roomId);
        if (!restored) return false;
        store.dispatch({ type: 'NAV_ROOM_ALL' });
        refreshPage();
        return true;
      }
      case 'room-all-dim': {
        if (!launchResume.roomId) return false;
        const restored = await restoreRoomDevicesView(launchResume.roomId);
        if (!restored) return false;
        store.dispatch({ type: 'NAV_ROOM_ALL' });
        store.dispatch({ type: 'NAV_VIEW', view: 'room-all-dim' });
        refreshPage();
        return true;
      }
      case 'device-detail':
      case 'device-dim': {
        if (!launchResume.deviceId) return false;
        const openDimView = launchResume.view === 'device-dim';
        return launchResume.roomId
          ? restoreRoomDeviceView(launchResume.roomId, launchResume.deviceId, openDimView)
          : restoreFavoriteDeviceView(launchResume.deviceId, openDimView);
      }
      default:
        return false;
    }
  }

  function getConfiguredGlassesMenuLaunchView(): 'main' | 'scenes' | 'rooms' | 'favorites' {
    const state = store.getState();
    switch (state.preferences.glassesMenuDefault) {
      case 'main':
        return 'main';
      case 'devices':
        return 'rooms';
      case 'favorites':
        return state.preferences.favoritesIds.length > 0 ? 'favorites' : 'scenes';
      case 'scenes':
        return 'scenes';
      case 'resume':
      default:
        return state.preferences.favoritesIds.length > 0 ? 'favorites' : 'scenes';
    }
  }

  function openConfiguredGlassesMenuView(): void {
    const view = getConfiguredGlassesMenuLaunchView();
    store.dispatch({ type: 'NAV_VIEW', view });
    refreshPage();
    if (view === 'rooms') void ensureRoomsLoaded();
  }

  let launchResumePersistenceEnabled = false;
  let lastLaunchResumeKey = '';

  function enableLaunchResumePersistence(storedLaunchResume: LaunchResumeState | null): void {
    if (launchResumePersistenceEnabled) return;
    launchResumePersistenceEnabled = true;
    lastLaunchResumeKey = launchResumeStateKey(storedLaunchResume);
  }

  function persistLaunchResume(state: AppState): void {
    if (!launchResumePersistenceEnabled) return;
    const launchResume = deriveLaunchResumeState(state);
    if (!launchResume) return;
    const nextKey = launchResumeStateKey(launchResume);
    if (nextKey === lastLaunchResumeKey) return;
    lastLaunchResumeKey = nextKey;
    void setStoredLaunchResume(hub, launchResume).catch((err) => {
      console.warn('[SmartThingsControls] Failed to save launch resume:', err);
    });
  }

  function commitTap(): void {
    commitTimeoutId = null;
    const state = store.getState();
    const { listView, listPageIndex: page } = state;
    const totalPages = getTotalPages(state);
    const isFirst = page === 0;
    const isLast = page === totalPages - 1;
    const listIndex = lastTapIndex;
    const lastListIndex = getLastListIndex(state);

    if (listView === 'main') {
      if (tapCount === 1) {
        const views = getMainMenuOrderedViews(state);
        const view = views[listIndex];
        if (view) {
          store.dispatch({ type: 'NAV_VIEW', view });
          refreshPage();
          if (view === 'rooms') void loadRooms();
        }
      } else if (tapCount === 2) {
        // ER guidance: from the top-level menu, double-tap should surface the
        // native system exit confirmation dialog. shutDownPageContainer(1)
        // shows the dialog; if the user cancels, the app stays running. We
        // do NOT clean up resources here — that happens in the SYSTEM_EXIT
        // event handler if the user actually confirms.
        appendDebugLog('Main double-tap: requesting system exit dialog.');
        void hub.requestSystemExit();
      }
      lastTapIndex = -1;
      tapCount = 0;
      return;
    }

    const isPaginatedList =
      listView === 'scenes' ||
      listView === 'rooms' ||
      listView === 'devices' ||
      listView === 'favorites' ||
      listView === 'device-dim' ||
      listView === 'room-all-detail' ||
      listView === 'room-all-dim';

    if (isPaginatedList) {
      if (tapCount === 2 && !isFirst) {
        store.dispatch({ type: 'LIST_PAGE', pageIndex: page - 1 });
        refreshPage();
        lastTapIndex = -1;
        tapCount = 0;
        return;
      }
      const canDoubleTapGoBack =
        listIndex === 0 ||
        listView === 'scenes' ||
        listView === 'devices' ||
        listView === 'rooms' ||
        listView === 'favorites' ||
        listView === 'device-dim' ||
        listView === 'room-all-detail' ||
        listView === 'room-all-dim';
      if (tapCount === 2 && isFirst && canDoubleTapGoBack) {
        if (listView === 'devices') {
          // Devices can be reached two ways: top-level from main (no room
          // selected → all-devices view) or via main → Rooms → [room]. Back
          // navigation should mirror that path.
          const cameFromRooms = !!state.selectedRoomId;
          store.dispatch({ type: 'NAV_VIEW', view: cameFromRooms ? 'rooms' : 'main' });
        } else if (listView === 'room-all-detail') {
          store.dispatch({ type: 'NAV_VIEW', view: 'devices' });
        } else if (listView === 'room-all-dim') {
          store.dispatch({ type: 'NAV_VIEW', view: 'room-all-detail' });
        } else if (listView === 'rooms') {
          store.dispatch({ type: 'NAV_VIEW', view: 'main' });
        } else if (listView === 'scenes') {
          store.dispatch({ type: 'NAV_VIEW', view: 'main' });
        } else if (listView === 'favorites') {
          store.dispatch({ type: 'NAV_VIEW', view: 'main' });
        } else if (listView === 'device-dim') {
          store.dispatch({ type: 'NAV_VIEW', view: 'device-detail' });
        }
        refreshPage();
        lastTapIndex = -1;
        tapCount = 0;
        return;
      }
      if (tapCount >= 3 && !isLast) {
        store.dispatch({ type: 'LIST_PAGE', pageIndex: totalPages - 1 });
        refreshPage();
        lastTapIndex = -1;
        tapCount = 0;
        return;
      }
      if (tapCount === 1) {
        if (listView === 'device-dim') {
          const deviceId = state.selectedDeviceId;
          if (listIndex === 0) {
            if (page === 0) {
              store.dispatch({ type: 'NAV_VIEW', view: 'device-detail' });
            } else {
              store.dispatch({ type: 'LIST_PAGE', pageIndex: page - 1 });
            }
            refreshPage();
          } else if (deviceId) {
            const level = getDimLevelByStateAndIndex(state, listIndex);
            if (level !== null) {
              void runDeviceSetLevel(deviceId, level);
            }
          }
        } else if (listView === 'room-all-dim') {
          if (listIndex === 0) {
            if (page === 0) {
              store.dispatch({ type: 'NAV_VIEW', view: 'room-all-detail' });
            } else {
              store.dispatch({ type: 'LIST_PAGE', pageIndex: page - 1 });
            }
            refreshPage();
          } else {
            const level = getDimLevelByStateAndIndex(state, listIndex);
            if (level !== null) {
              void runAllDimmableDevicesSetLevel(level);
            }
          }
        } else if (listView === 'room-all-detail') {
          const hasSwitch = roomHasSwitchable(store.getState());
          const hasDim = roomHasDimmable(store.getState());
          if (listIndex === 0) {
            store.dispatch({ type: 'NAV_VIEW', view: 'devices' });
            refreshPage();
          } else if (hasSwitch && listIndex === 1) {
            void runAllDevicesInRoomSwitch(true);
          } else if (hasSwitch && listIndex === 2) {
            void runAllDevicesInRoomSwitch(false);
          } else if (hasDim && (hasSwitch ? listIndex === 3 : listIndex === 1)) {
            store.dispatch({ type: 'NAV_VIEW', view: 'room-all-dim' });
            refreshPage();
          }
        } else if (listView === 'scenes') {
          if (listIndex === 0) {
            if (isFirst) {
              store.dispatch({ type: 'NAV_VIEW', view: 'main' });
            } else {
              store.dispatch({ type: 'LIST_PAGE', pageIndex: page - 1 });
            }
            refreshPage();
            lastTapIndex = -1;
            tapCount = 0;
            return;
          }
          if (!isLast && listIndex === lastListIndex) {
            store.dispatch({ type: 'LIST_PAGE', pageIndex: page + 1 });
            refreshPage();
            lastTapIndex = -1;
            tapCount = 0;
            return;
          }
          const firstSlots = getFirstPageContentSlots(state);
          const actualSceneIndex =
            page === 0 ? listIndex - 1 : firstSlots + (page - 1) * SCENES_PER_PAGE + (listIndex - 1);
          if (actualSceneIndex >= 0 && actualSceneIndex < getOrderedScenes(state).length) {
            store.dispatch({ type: 'TAP', selectedIndex: listIndex });
            void runExecuteScene(store, actualSceneIndex, showConfirmation);
          }
        } else if (listView === 'favorites') {
          if (listIndex === 0) {
            if (isFirst) {
              store.dispatch({ type: 'NAV_VIEW', view: 'main' });
            } else {
              store.dispatch({ type: 'LIST_PAGE', pageIndex: page - 1 });
            }
            refreshPage();
            lastTapIndex = -1;
            tapCount = 0;
            return;
          }
          if (!isLast && listIndex === lastListIndex) {
            store.dispatch({ type: 'LIST_PAGE', pageIndex: page + 1 });
            refreshPage();
            lastTapIndex = -1;
            tapCount = 0;
            return;
          }
          const firstSlots = getFirstPageContentSlots(state);
          const actualFavoriteIndex =
            page === 0 ? listIndex - 1 : firstSlots + (page - 1) * SCENES_PER_PAGE + (listIndex - 1);
          const favorite = getFavoriteByIndex(state, actualFavoriteIndex);
          if (favorite) {
            if (favorite.type === 'scene') {
              const sceneIndex = getOrderedScenes(state).findIndex((s) => s.sceneId === favorite.id);
              if (sceneIndex >= 0) {
                store.dispatch({ type: 'TAP', selectedIndex: listIndex });
                void runExecuteScene(store, sceneIndex, showConfirmation);
              }
            } else {
              store.dispatch({ type: 'NAV_FAVORITE_DEVICE', deviceId: favorite.id });
              refreshPage();
              void loadDeviceStats(favorite.id);
            }
          }
        } else if (listView === 'rooms') {
          if (listIndex === 0) {
            if (isFirst) {
              store.dispatch({ type: 'NAV_VIEW', view: 'main' });
            } else {
              store.dispatch({ type: 'LIST_PAGE', pageIndex: page - 1 });
            }
            refreshPage();
            lastTapIndex = -1;
            tapCount = 0;
            return;
          }
          if (!isLast && listIndex === lastListIndex) {
            store.dispatch({ type: 'LIST_PAGE', pageIndex: page + 1 });
            refreshPage();
            lastTapIndex = -1;
            tapCount = 0;
            return;
          }
          const firstSlots = getFirstPageContentSlots(state);
          const actualRoomIndex =
            page === 0 ? listIndex - 1 : firstSlots + (page - 1) * ROOMS_PER_PAGE + (listIndex - 1);
          const room = getRoomByIndex(state, actualRoomIndex);
          if (room) {
            store.dispatch({ type: 'NAV_ROOM', roomId: room.roomId });
            refreshPage();
            void loadDevicesForRoom(room.roomId);
          }
        } else if (listView === 'devices') {
          if (listIndex === 0) {
            if (isFirst) {
              store.dispatch({ type: 'NAV_VIEW', view: 'rooms' });
            } else {
              store.dispatch({ type: 'LIST_PAGE', pageIndex: page - 1 });
            }
            refreshPage();
            lastTapIndex = -1;
            tapCount = 0;
            return;
          }
          if (!isLast && listIndex === lastListIndex) {
            store.dispatch({ type: 'LIST_PAGE', pageIndex: page + 1 });
            refreshPage();
            lastTapIndex = -1;
            tapCount = 0;
            return;
          }
          const deviceIndex = getDeviceIndexFromDevicesList(state, page, listIndex);
          if (deviceIndex === -1) {
            store.dispatch({ type: 'NAV_ROOM_ALL' });
            refreshPage();
          } else if (deviceIndex >= 0) {
            const device = getDeviceByIndex(state, deviceIndex);
            if (device) {
              store.dispatch({ type: 'NAV_DEVICE', deviceId: device.deviceId });
              refreshPage();
              void loadDeviceStats(device.deviceId);
            }
          }
        }
      }
      lastTapIndex = -1;
      tapCount = 0;
      return;
    }

    if (listView === 'device-detail') {
      if (tapCount === 2) {
        store.dispatch({
          type: 'NAV_VIEW',
          view: state.selectedRoomId == null ? 'favorites' : 'devices',
        });
        refreshPage();
      } else if (tapCount === 1) {
        const deviceId = state.selectedDeviceId;
        const device = getSelectedDevice(state);
        if (listIndex === 0) {
          store.dispatch({
            type: 'NAV_VIEW',
            view: state.selectedRoomId == null ? 'favorites' : 'devices',
          });
          refreshPage();
        } else if (deviceId && device) {
          // Walk through actions in the same order as deviceDetailItemNames() in composer.ts.
          let idx = 1;
          if (device.supportsSwitch) {
            if (listIndex === idx) { void runDeviceSwitch(deviceId, true); }          // On
            else if (listIndex === idx + 1) { void runDeviceSwitch(deviceId, false); } // Off
            idx += 2;
          }
          if (device.supportsGarageDoor) {
            const garageCap = device.garageDoorCapability ?? 'garageDoorControl';
            if (listIndex === idx) { void runGarageDoor(deviceId, true, garageCap); }            // Open
            else if (listIndex === idx + 1) { void runGarageDoor(deviceId, false, garageCap); }  // Close
            idx += 2;
          }
          if (device.supportsLock) {
            if (listIndex === idx) { void runLock(deviceId, true); }                  // Lock
            else if (listIndex === idx + 1) { void runLock(deviceId, false); }        // Unlock
            idx += 2;
          }
          if (device.supportsMediaPlayback) {
            if (listIndex === idx) { void runMediaPlayback(deviceId, 'play'); }           // Play
            else if (listIndex === idx + 1) { void runMediaPlayback(deviceId, 'pause'); } // Pause
            else if (listIndex === idx + 2) { void runMediaPlayback(deviceId, 'stop'); }  // Stop
            idx += 3;
          }
          if (device.supportsAudioVolume) {
            if (listIndex === idx) { void runAudioVolume(deviceId, 'up'); }           // Vol +
            else if (listIndex === idx + 1) { void runAudioVolume(deviceId, 'down'); } // Vol -
            idx += 2;
          }
          if (device.supportsAudioMute) {
            if (listIndex === idx) { void runAudioMute(deviceId, true); }             // Mute
            else if (listIndex === idx + 1) { void runAudioMute(deviceId, false); }   // Unmute
            idx += 2;
          }
          if (device.supportsMediaTrackControl) {
            if (listIndex === idx) { void runMediaTrackControl(deviceId, 'prev'); }   // Prev
            else if (listIndex === idx + 1) { void runMediaTrackControl(deviceId, 'next'); } // Next
            idx += 2;
          }
          if (device.supportsTvChannel) {
            if (listIndex === idx) { void runTvChannel(deviceId, 'up'); }             // Ch+
            else if (listIndex === idx + 1) { void runTvChannel(deviceId, 'down'); }  // Ch-
            idx += 2;
          }
          if (device.supportsMediaInputSource) {
            if (listIndex === idx)     { void runMediaInputSource(deviceId, 'HDMI1'); }            // HDMI 1
            else if (listIndex === idx + 1)  { void runMediaInputSource(deviceId, 'HDMI2'); }      // HDMI 2
            else if (listIndex === idx + 2)  { void runMediaInputSource(deviceId, 'HDMI3'); }      // HDMI 3
            else if (listIndex === idx + 3)  { void runMediaInputSource(deviceId, 'HDMI4'); }      // HDMI 4
            else if (listIndex === idx + 4)  { void runMediaInputSource(deviceId, 'HDMI5'); }      // HDMI 5
            else if (listIndex === idx + 5)  { void runMediaInputSource(deviceId, 'HDMI6'); }      // HDMI 6
            else if (listIndex === idx + 6)  { void runMediaInputSource(deviceId, 'digitalTv'); }  // TV
            else if (listIndex === idx + 7)  { void runMediaInputSource(deviceId, 'optical'); }    // Optical
            else if (listIndex === idx + 8)  { void runMediaInputSource(deviceId, 'bluetooth'); }  // BT
            else if (listIndex === idx + 9)  { void runMediaInputSource(deviceId, 'aux'); }        // Aux
            else if (listIndex === idx + 10) { void runMediaInputSource(deviceId, 'USB'); }        // USB
            idx += 11;
          }
          if (device.supportsWindowShade) {
            if (listIndex === idx) { void runWindowShade(deviceId, 'open'); }           // Open
            else if (listIndex === idx + 1) { void runWindowShade(deviceId, 'close'); } // Close
            else if (listIndex === idx + 2) { void runWindowShade(deviceId, 'pause'); } // Pause
            idx += 3;
          }
          if (device.supportsWindowShadeLevel) {
            if (listIndex === idx) { void runWindowShadeLevel(deviceId, 10); }          // Shade +
            else if (listIndex === idx + 1) { void runWindowShadeLevel(deviceId, -10); } // Shade -
            idx += 2;
          }
          if (device.supportsValve) {
            if (listIndex === idx) { void runValve(deviceId, true); }                 // Open
            else if (listIndex === idx + 1) { void runValve(deviceId, false); }       // Close
            idx += 2;
          }
          if (device.supportsAlarm) {
            if (listIndex === idx) { void runAlarm(deviceId, 'siren'); }              // Siren
            else if (listIndex === idx + 1) { void runAlarm(deviceId, 'strobe'); }    // Strobe
            else if (listIndex === idx + 2) { void runAlarm(deviceId, 'both'); }      // Both
            else if (listIndex === idx + 3) { void runAlarm(deviceId, 'off'); }       // Off
            idx += 4;
          }
          if (device.supportsThermostatMode) {
            if (listIndex === idx) { void runThermostatMode(deviceId, 'heat'); }
            else if (listIndex === idx + 1) { void runThermostatMode(deviceId, 'cool'); }
            else if (listIndex === idx + 2) { void runThermostatMode(deviceId, 'auto'); }
            else if (listIndex === idx + 3) { void runThermostatMode(deviceId, 'off'); }
            else if (listIndex === idx + 4) { void runThermostatMode(deviceId, 'emergencyHeat'); }
            idx += 5;
          }
          if (device.supportsThermostatHeatingSetpoint) {
            if (listIndex === idx) { void runThermostatSetpoint(deviceId, 'heating', 1); }   // Heat +
            else if (listIndex === idx + 1) { void runThermostatSetpoint(deviceId, 'heating', -1); } // Heat -
            idx += 2;
          }
          if (device.supportsThermostatCoolingSetpoint) {
            if (listIndex === idx) { void runThermostatSetpoint(deviceId, 'cooling', 1); }   // Cool +
            else if (listIndex === idx + 1) { void runThermostatSetpoint(deviceId, 'cooling', -1); } // Cool -
            idx += 2;
          }
          if (device.supportsThermostatFanMode) {
            if (listIndex === idx)     { void runThermostatFanMode(deviceId, 'auto'); }           // Fan Auto
            else if (listIndex === idx + 1) { void runThermostatFanMode(deviceId, 'on'); }        // Fan On
            else if (listIndex === idx + 2) { void runThermostatFanMode(deviceId, 'circulate'); } // Fan Circ
            else if (listIndex === idx + 3) { void runThermostatFanMode(deviceId, 'followschedule'); } // Fan Sched
            idx += 4;
          }
          if (device.supportsFanSpeed) {
            if (listIndex === idx) { void runFanSpeed(deviceId, 1); }                 // Speed +
            else if (listIndex === idx + 1) { void runFanSpeed(deviceId, -1); }       // Speed -
            idx += 2;
          }
          if (device.supportsColorTemperature) {
            if (listIndex === idx) { void runColorTemperature(deviceId, 'cooler'); }  // Cooler
            else if (listIndex === idx + 1) { void runColorTemperature(deviceId, 'warmer'); } // Warmer
            idx += 2;
          }
          if (device.supportsColorControl) {
            if (listIndex === idx)     { void runColorControl(deviceId, 0); }   // Red
            else if (listIndex === idx + 1) { void runColorControl(deviceId, 10); }  // Orange
            else if (listIndex === idx + 2) { void runColorControl(deviceId, 17); }  // Yellow
            else if (listIndex === idx + 3) { void runColorControl(deviceId, 33); }  // Green
            else if (listIndex === idx + 4) { void runColorControl(deviceId, 50); }  // Cyan
            else if (listIndex === idx + 5) { void runColorControl(deviceId, 66); }  // Blue
            else if (listIndex === idx + 6) { void runColorControl(deviceId, 75); }  // Purple
            else if (listIndex === idx + 7) { void runColorControl(deviceId, 90); }  // Pink
            idx += 8;
          }
          if (device.supportsMomentary) {
            if (listIndex === idx) { void runMomentary(deviceId); }                   // Push
            idx += 1;
          }
          if (device.supportsDimmer && listIndex === idx) {
            store.dispatch({ type: 'NAV_VIEW', view: 'device-dim' });
            refreshPage();
            void loadDeviceStats(deviceId);
          }
        }
      }
      lastTapIndex = -1;
      tapCount = 0;
      return;
    }

    lastTapIndex = -1;
    tapCount = 0;
  }

  function moveTextModeFocus(delta: number): void {
    const state = store.getState();
    const selectableIndexes = getSelectableListIndexes(state);
    if (selectableIndexes.length === 0) return;

    const currentIndex = getNormalizedFocusedListIndex(state);
    const currentPosition = Math.max(0, selectableIndexes.indexOf(currentIndex));
    const nextPosition = Math.max(0, Math.min(currentPosition + delta, selectableIndexes.length - 1));
    const nextIndex = selectableIndexes[nextPosition] ?? currentIndex;
    if (nextIndex === currentIndex && nextIndex === state.focusedListIndex) return;
    store.dispatch({ type: 'TAP', selectedIndex: nextIndex });
    refreshPage();
  }

  function triggerTextModeTap(gestureTaps: 1 | 2): void {
    if (commitTimeoutId !== null) {
      clearTimeout(commitTimeoutId);
      commitTimeoutId = null;
    }
    const state = store.getState();
    lastTapIndex = Math.min(getNormalizedFocusedListIndex(state), getLastListIndex(state));
    tapCount = gestureTaps;
    lastTapTime = Date.now();
    commitTap();
  }

  function shouldProcessTextModeScroll(direction: -1 | 1): boolean {
    const now = Date.now();
    const withinCooldown = now - lastTextModeScrollAt < TEXT_MODE_SCROLL_COOLDOWN_MS;
    if (withinCooldown && lastTextModeScrollDirection === direction) {
      return false;
    }
    lastTextModeScrollAt = now;
    lastTextModeScrollDirection = direction;
    return true;
  }

  // Acceleration model — discrete firmware scroll events only, so we accelerate
  // by stepping more items per swipe when the user swipes rapidly in the same
  // direction. Burst grows on consecutive same-direction events within
  // ACCEL_WINDOW_MS; resets on a direction change or a pause >ACCEL_WINDOW_MS.
  const ACCEL_WINDOW_MS = 400;
  const ACCEL_STEPS = [1, 1, 3, 8, 15] as const;
  let accelBurstIndex = 0;
  let accelLastDirection: -1 | 0 | 1 = 0;
  let accelLastAt = 0;

  function getAcceleratedStep(direction: -1 | 1): number {
    const now = Date.now();
    const sameDirection = accelLastDirection === direction;
    const withinWindow = now - accelLastAt <= ACCEL_WINDOW_MS;
    if (sameDirection && withinWindow) {
      accelBurstIndex = Math.min(accelBurstIndex + 1, ACCEL_STEPS.length - 1);
    } else {
      accelBurstIndex = 0;
    }
    accelLastDirection = direction;
    accelLastAt = now;
    return ACCEL_STEPS[accelBurstIndex] ?? 1;
  }

  // Click dedup — the firmware emits CLICK twice for a single physical tap
  // (confirmed via debug log: two `field=sys eventType=null` events ~50 ms
  // apart). Without this, the first click navigates into a sub-menu and the
  // second hits the new view's index-0 ("← Back") slot, bouncing back to
  // main. Real double-taps come through as a separate DOUBLE_CLICK_EVENT
  // (eventType=3), so dedup'ing CLICK doesn't break double-tap.
  const CLICK_DEDUP_WINDOW_MS = 250;
  let lastClickAt = 0;
  let lastDoubleClickAt = 0;

  function handleTextModeEvent(event: EvenHubEvent): boolean {
    const rawType =
      event.listEvent?.eventType ??
      event.textEvent?.eventType ??
      event.sysEvent?.eventType ??
      null;
    const eventType = rawType != null ? OsEventTypeList.fromJson(rawType) ?? Number(rawType) : null;

    if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
      if (!shouldProcessTextModeScroll(-1)) return true;
      const step = getAcceleratedStep(-1);
      moveTextModeFocus(-step);
      return true;
    }
    if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      if (!shouldProcessTextModeScroll(1)) return true;
      const step = getAcceleratedStep(1);
      moveTextModeFocus(step);
      return true;
    }
    if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      const now = Date.now();
      if (now - lastDoubleClickAt < CLICK_DEDUP_WINDOW_MS) return true;
      lastDoubleClickAt = now;
      // Suppress the click that the firmware fired alongside the double-click
      // (their bookkeeping is unfortunately overlapping).
      lastClickAt = now;
      triggerTextModeTap(2);
      return true;
    }
    if (eventType === OsEventTypeList.CLICK_EVENT || eventType == null) {
      const now = Date.now();
      if (now - lastClickAt < CLICK_DEDUP_WINDOW_MS) return true;
      lastClickAt = now;
      triggerTextModeTap(1);
      return true;
    }
    return false;
  }

  setupConfigUI(store, hub, refreshPage);
  store.subscribe((state) => {
    persistLaunchResume(state);
  });

  let initialLaunchPreferenceApplied = false;

  async function applyInitialLaunchPreference(): Promise<void> {
    if (initialLaunchPreferenceApplied) return;
    initialLaunchPreferenceApplied = true;

    const storedLaunchResume = await storedLaunchResumePromise;
    try {
      await preferencesLoadPromise;
      const pref = store.getState().preferences.glassesMenuDefault;
      // If the user has already navigated (a buffered tap fired after init,
      // or they tapped during the storage/preferences await), respect their
      // intent — don't reset to the configured default view.
      if (userHasInteracted) {
        appendDebugLog(`Launch preference (${pref}): skipping (user already interacted).`);
        return;
      }
      appendDebugLog(`Launch preference (${pref}): applying — currentView=${store.getState().listView}`);
      if (pref === 'resume') {
        const restored = await restoreLaunchResume(storedLaunchResume);
        if (!restored) openConfiguredGlassesMenuView();
      } else {
        openConfiguredGlassesMenuView();
      }
    } finally {
      enableLaunchResumePersistence(storedLaunchResume);
      persistLaunchResume(store.getState());
    }
  }

  void applyInitialLaunchPreference();

  hub.subscribeLaunchSource((source) => {
    appendDebugLog(`Launch source received: ${source}`);
  });

  function handleHubEvent(event: EvenHubEvent): void {
    // Any glasses event = the user has interacted. Cancel the pending
    // launch-preference override so we don't snap them back to the default
    // view after they've already navigated.
    userHasInteracted = true;
    if (canUseTextGlassesLayout()) {
      handleTextModeEvent(event);
      return;
    }
    const action = mapEvenHubEvent(event, store.getState());
    if (action && action.type === 'TAP') {
      const listIndex = action.selectedIndex;
      store.dispatch(action);
      const gestureTaps = action.gestureTaps ?? 1;
      const now = Date.now();
      // Pure tap classification (extracted to src/input/tap-dedup.ts so the
      // real algorithm is unit-testable). Snapshot the closure tap-state in,
      // write the result back so commitTap()/triggerTextModeTap() — which
      // read/mutate these same vars — keep working unchanged.
      const { next, skipCommitForScroll } = classifyTap(
        { recentListIndices, lastTapIndex, lastTapTime, tapCount },
        { listIndex, gestureTaps, now },
        { scrollWindowMs: SCROLL_WINDOW_MS, tapWindowMs: TAP_WINDOW_MS },
      );
      recentListIndices.length = 0;
      recentListIndices.push(...next.recentListIndices);
      lastTapIndex = next.lastTapIndex;
      lastTapTime = next.lastTapTime;
      tapCount = next.tapCount;

      if (commitTimeoutId !== null) clearTimeout(commitTimeoutId);
      if (!skipCommitForScroll) {
        commitTimeoutId = setTimeout(commitTap, TAP_COMMIT_MS);
      } else {
        commitTimeoutId = null;
      }
    }
  }

  function attachHubEventSubscription(reason: string): void {
    if (reason === 'startup') {
      // Forwarder was already subscribed right after hub.init(). Just flip
      // the active handler to the real one and drain anything buffered
      // during init/network/storage/setup work.
      activeEventHandler = handleHubEvent;
      const drained = earlyEventBuffer.length;
      for (const event of earlyEventBuffer) handleHubEvent(event);
      earlyEventBuffer.length = 0;
      appendDebugLog(`EvenHub event subscription ready (drained=${drained}).`);
      return;
    }
    // Resume: bridge instance was replaced inside hub.init(); the previous
    // unsubscribe is stale. Re-subscribe the forwarder; activeEventHandler
    // is already set so events route directly to handleHubEvent.
    hub.subscribeEvents(eventForwarder);
    appendDebugLog(`EvenHub event subscription refreshed (${reason}).`);
  }

  async function syncGlassesAfterResume(reason: string): Promise<boolean> {
    if (!hub.hasBridge()) return false;

    if (useRealGlasses) {
      glassesLayoutMode = 'text';
      updateTextModePage(`${reason} text refresh`);
      await pushInitialImages();
      return true;
    } else {
      const rebuilt = await rebuildFullPage(`${reason} rebuild`);
      if (rebuilt) {
        if (canUseConfirmationImage()) {
          await pushInitialImages();
        }
        return true;
      }
    }

    const startupPage = composeStartupPage(store.getState());
    appendDebugLog(
      `Recreating glasses startup page (${reason}). containers=${startupPage.containerTotalNum ?? 0}`
    );
    const startupResult = await hub.setupPage(startupPage);
    appendDebugLog(
      `Resume startup page result: ${describeStartUpPageResult(startupResult.code)}`
        + (startupResult.success ? '' : ' (resume sync may still be incomplete)'),
      !startupResult.success
    );
    if (!startupResult.success) {
      return false;
    }

    if (useRealGlasses) {
      glassesLayoutMode = 'text';
      updateTextModePage(`${reason} post-startup text refresh`);
      await pushInitialImages();
      return true;
    }

    const rebuilt = await rebuildFullPage(`${reason} post-startup rebuild`);
    if (rebuilt && canUseConfirmationImage()) {
      await pushInitialImages();
    }
    return rebuilt;
  }

  // The heavy resume work, injected into the scheduler. `lightweight` ⇒ a
  // full resume completed very recently (a brief foreground/background flap),
  // so skip bridge re-init / session re-verify / glasses redraw — those are
  // exactly what caused the flicker + sluggish-first-command churn. Every
  // resume *outcome* (auth recovery, connect-panel-on-expiry, glasses resync)
  // is preserved verbatim in the non-lightweight path.
  async function runResume(
    reasons: string[],
    { lightweight }: { lightweight: boolean },
  ): Promise<void> {
    const reason = reasons.join(',');
    appendDebugLog(`Resume sync triggered (${reason})${lightweight ? ' [lightweight]' : ''}.`);
    // Wake lock is idempotent + visibility-gated; cheap to re-assert always.
    await requestWakeLock(`resume:${reason}`);
    if (lightweight) {
      appendDebugLog(`Resume lightweight — recent full resume; skip re-init/verify/redraw (${reason}).`);
      return;
    }

    await hub.init(3000);
    appendDebugLog(`Resume bridge refresh complete (${reason}). bridge=${hub.hasBridge()}`);
    if (!hub.hasBridge()) {
      appendDebugLog(`Resume bridge refresh failed (${reason}).`, true);
      return;
    }

    attachHubEventSubscription(`resume:${reason}`);

    try {
      let resumePendingId: string | null = null;
      try { resumePendingId = localStorage.getItem('smartthings_controls_pending_auth'); } catch { /* ignore */ }
      appendDebugLog(`Resume check (${reason}): pendingId=${resumePendingId ?? 'none'}`);
      let sessionStatus = await getSessionStatus();
      appendDebugLog(`Resume session (${reason}): authenticated=${sessionStatus.authenticated}`);
      // If not authenticated, check if OAuth completed outside this WebView
      // (e.g. iOS Universal Links opened the SmartThings app → Safari).
      if (!sessionStatus.authenticated) {
        appendDebugLog(`Resume: not authenticated, checking pending auth (${reason}).`);
        const pendingToken = await checkPendingAuth();
        appendDebugLog(`Resume pending auth result (${reason}): token=${pendingToken ? 'recovered' : 'none'}`);
        if (pendingToken) {
          appendDebugLog(`Pending auth recovered session on resume (${reason}).`);
          sessionStatus = await getSessionStatus();
          appendDebugLog(`Post-recovery session (${reason}): authenticated=${sessionStatus.authenticated}`);
        }
      }
      appendDebugLog(
        `Resume session status (${reason}). authenticated=${sessionStatus.authenticated} configured=${sessionStatus.configured}`
      );
      if (!sessionStatus.authenticated) {
        const disconnectMessage = sessionStatus.sessionExpired
          ? AUTH_SESSION_EXPIRED_MESSAGE
          : sessionStatus.configured
            ? AUTH_DISCONNECTED_MESSAGE
            : AUTH_CONFIG_MISSING_MESSAGE;
        showConnectPanelWithDebug(disconnectMessage, sessionStatus.configured);
        return;
      }
      initialSessionStatus = sessionStatus;
      authExpiredHandled = false;
      authUI.showConnectedState(sessionStatus);
      try {
        await createSmartThingsClient(true);
        appendDebugLog(`SmartThings client refreshed (${reason}).`);
      } catch (err) {
        appendDebugLog(`SmartThings client refresh failed (${reason}): ${getErrorMessage(err)}`, true);
      }
    } catch (err) {
      appendDebugLog(`Resume session status failed (${reason}): ${getErrorMessage(err)}`, true);
    }

    const synced = await syncGlassesAfterResume(reason);
    appendDebugLog(
      synced ? `Glasses sync complete (${reason}).` : `Glasses sync failed (${reason}).`,
      !synced
    );
  }

  // Coalesce the four foreground/background triggers through a single
  // trailing-debounced scheduler. Client invalidation is now deferred behind
  // a grace period (a brief flap no longer throws away the SmartThings
  // client → no extra token round trip / sluggish first command).
  const resumeScheduler = createResumeScheduler({
    now: Date.now,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    runResume,
    invalidateClient: invalidateSmartThingsClient,
    log: (m) => appendDebugLog(m),
  });
  const disposeResumeLifecycle = installResumeLifecycle(resumeScheduler, {
    onVisibleWake: (r) => {
      appendDebugLog(`[Visibility] App visible — ${r}.`);
      void requestWakeLock(r);
    },
    onHiddenWake: (r) => {
      appendDebugLog('[Visibility] App hidden.');
      void releaseWakeLock(r);
    },
  });

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('beforeunload', () => {
      window.removeEventListener(SMARTTHINGS_DEBUG_EVENT, relayDebugHandler as EventListener);
      void releaseWakeLock('beforeunload');
      disposeResumeLifecycle();
    });
  }

  attachHubEventSubscription('startup');
  console.log('[SmartThingsControls] Initialized.');
}
