/**
 * SmartThings Controls — Application entry point.
 *
 * Flow: Bridge init → backend session lookup → SmartThings access token →
 * SmartThings client → fetch scenes → setup G2 list → rebuild list with scene names →
 * subscribe events. Tap on list runs scene.
 */

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
  composePageForState,
  composeListOnlyPage,
  composeTextFallbackPage,
  composeTextModeListContent,
  composeTextModeStatsContent,
  getTotalPages,
  getFirstPageContentSlots,
  getLastListIndex,
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
  disconnectSmartThings,
  getSessionStatus,
  getSmartThingsAccessToken,
  startSmartThingsConnect,
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
import { ImageRawDataUpdate, LAUNCH_SOURCE_GLASSES_MENU, OsEventTypeList, StartUpPageCreateResult, type EvenHubEvent } from '@evenrealities/even_hub_sdk';

const CONFIG_PANEL_ID = 'config';
const AUTH_RECONNECT_MESSAGE = 'SmartThings session expired or is unauthorized. Reconnect to continue.';
const AUTH_CONFIG_MISSING_MESSAGE = 'SmartThings OAuth is not configured on the backend.';
const AUTH_SERVICE_UNAVAILABLE_MESSAGE = 'SmartThings auth service is unavailable.';
const AUTH_DISCONNECTED_MESSAGE = 'SmartThings is not connected for this device.';

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
};

function setupAuthUI(): AuthUI {
  const connectBtn = document.getElementById('connect-smartthings-btn') as HTMLButtonElement | null;
  const statusEl = document.getElementById('config-status');
  const reconnectBtn = document.getElementById('reconnect-smartthings-btn') as HTMLButtonElement | null;
  const disconnectBtn = document.getElementById('disconnect-smartthings-btn') as HTMLButtonElement | null;
  const connectionStatusEl = document.getElementById('smartthings-connection-status');
  const disconnectConfirmEl = document.getElementById('disconnect-smartthings-confirm');
  const disconnectConfirmCancel = document.getElementById('disconnect-smartthings-confirm-cancel') as HTMLButtonElement | null;
  const disconnectConfirmDo = document.getElementById('disconnect-smartthings-confirm-do') as HTMLButtonElement | null;

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

  if (connectBtn) {
    connectBtn.onclick = () => startSmartThingsConnect();
  }
  if (reconnectBtn) {
    reconnectBtn.onclick = () => startSmartThingsConnect();
  }
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

function showPanel(id: string): void {
  const config = document.getElementById(CONFIG_PANEL_ID);
  const openInEven = document.getElementById(OPEN_IN_EVEN_ID);
  const glassesActive = document.getElementById(GLASSES_ACTIVE_ID);
  if (config) config.style.display = id === CONFIG_PANEL_ID ? 'block' : 'none';
  if (openInEven) openInEven.style.display = id === OPEN_IN_EVEN_ID ? 'block' : 'none';
  if (glassesActive) glassesActive.style.display = id === GLASSES_ACTIVE_ID ? 'block' : 'none';
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

function deviceSupportsSwitch(d: Device): boolean {
  return (d.components ?? []).some((c) =>
    (c.capabilities ?? []).some((cap) => cap.id === 'switch')
  );
}

function deviceSupportsDimmer(d: Device): boolean {
  return (d.components ?? []).some((c) =>
    (c.capabilities ?? []).some((cap) => cap.id === 'switchLevel')
  );
}

/**
 * Human-readable device type: prefer component category (e.g. Light, Outlet) over protocol (Zigbee, Z-Wave).
 * Uses: main component's manufacturer category → first category → DTH deviceTypeName → integration type.
 */
function deviceTypeDisplayName(d: Device): string {
  const components = d.components ?? [];
  const main = components.find((c) => c.id === 'main') ?? components[0];
  const categories = main?.categories ?? [];
  if (categories.length > 0) {
    const manufacturerCat = categories.find((c) => c.categoryType === 'manufacturer');
    const preferred = manufacturerCat ?? categories[0];
    const name = preferred?.name?.trim();
    if (name) return name;
  }
  const dthName = d.dth?.deviceTypeName?.trim();
  if (dthName) return dthName;
  const integrationType = d.type ?? '';
  const formatted = String(integrationType)
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return formatted || 'Unknown';
}

/** Human-readable protocol/integration type (e.g. Zigbee, Z-Wave, LAN). */
function deviceProtocolDisplayName(d: Device): string {
  const integrationType = d.type ?? '';
  const formatted = String(integrationType)
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return formatted || 'Unknown';
}

function normalizeDevices(devices: Device[]): DeviceEntry[] {
  return devices.map((d) => ({
    deviceId: d.deviceId ?? '',
    deviceName: (d.label ?? d.name ?? 'Device').slice(0, SCENE_NAME_MAX_LEN),
    deviceType: deviceTypeDisplayName(d),
    deviceProtocol: deviceProtocolDisplayName(d),
    supportsSwitch: deviceSupportsSwitch(d),
    supportsDimmer: deviceSupportsDimmer(d),
  }));
}

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
  withSmartThingsClient: WithSmartThingsClient,
  selectedIndex: number,
  showConfirmation: ShowConfirmationFn
): Promise<void> {
  const state = store.getState();
  const scene = getSceneByIndex(state, selectedIndex);
  if (!scene || state.status === 'executing') return;

  store.dispatch({ type: 'EXECUTE_START' });
  try {
    const result = await withSmartThingsClient((client) =>
      client.scenes.execute(scene.sceneId) as Promise<{ status?: string; results?: Array<{ status?: string }> } | undefined>
    );
    const status = result?.status;
    const success = status === 'success';

    // Prefer per-action statuses when present to distinguish full vs partial success.
    const results = result?.results;
    if (results && Array.isArray(results) && results.length > 0) {
      const successCount = results.filter((r) => r?.status === 'ACCEPTED' || r?.status === 'COMPLETED').length;
      await showConfirmation(confirmationResultFromCounts(successCount, results.length));
    } else if (success) {
      await showConfirmation('success');
    } else if (status === 'partial' || status === 'completed_with_errors') {
      await showConfirmation('partial');
    } else {
      await showConfirmation('failure');
    }

    store.dispatch({ type: 'EXECUTE_END', success, errorMessage: success ? undefined : (status ?? 'unknown') });
  } catch (err) {
    const message = getErrorMessage(err);
    store.dispatch({ type: 'EXECUTE_END', success: false, errorMessage: message });
    await showConfirmation('failure');
  }
}

export async function initApp(): Promise<void> {
  const hub = new EvenHubBridge();
  const toggleDebugBtn = document.getElementById('toggle-debug-btn');
  const copyDebugLogBtn = document.getElementById('copy-debug-log-btn') as HTMLButtonElement | null;
  const clearDebugLogBtn = document.getElementById('clear-debug-log-btn') as HTMLButtonElement | null;
  const debugLogContainer = document.getElementById('debug-log-container');
  const debugLog = document.getElementById('debug-log');
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
    if (!debugLogContainer) return;
    debugLogContainer.style.display = visible ? 'block' : 'none';
    if (toggleDebugBtn) {
      toggleDebugBtn.textContent = visible ? 'Hide debug log' : 'Show debug log';
    }
  }

  function appendDebugLog(message: string, reveal = false): void {
    const line = `[${new Date().toLocaleTimeString('en-US', { hour12: false })}] ${message}`;
    debugLines.push(line);
    if (debugLines.length > 120) debugLines.shift();
    if (debugLog) debugLog.textContent = debugLines.join('\n');
    console.log(`[SmartThingsControls] ${message}`);
    if (reveal) setDebugVisible(true);
  }

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

  if (toggleDebugBtn && debugLogContainer) {
    toggleDebugBtn.onclick = () => {
      const visible = debugLogContainer.style.display !== 'none';
      setDebugVisible(!visible);
    };
  }
  if (copyDebugLogBtn) {
    copyDebugLogBtn.onclick = async () => {
      const content = debugLines.join('\n');
      if (!content) return;
      try {
        await copyTextToClipboard(content);
        appendDebugLog('Debug log copied to clipboard.');
      } catch (err) {
        appendDebugLog(`Debug log copy failed: ${getErrorMessage(err)}`, true);
      }
    };
  }
  if (clearDebugLogBtn) {
    clearDebugLogBtn.onclick = () => {
      debugLines.length = 0;
      if (debugLog) debugLog.textContent = '';
    };
  }
  setDebugVisible(true);

  try {
    await hub.init();
    appendDebugLog(`Bridge initialization complete. bridge=${hub.hasBridge()}`);
  } catch (err) {
    console.warn('[SmartThingsControls] Init error:', err);
    appendDebugLog(`Bridge init threw: ${getErrorMessage(err)}`, true);
    showPanel(OPEN_IN_EVEN_ID);
    return;
  }

  if (!hub.hasBridge()) {
    appendDebugLog('No Even bridge available in this webview.');
    showPanel(OPEN_IN_EVEN_ID);
    return;
  }

  const authUI = setupAuthUI();
  let initialSessionStatus: SessionStatus;
  try {
    initialSessionStatus = await getSessionStatus();
    appendDebugLog(
      `Session status loaded. authenticated=${initialSessionStatus.authenticated} configured=${initialSessionStatus.configured}`
    );
  } catch (err) {
    console.warn('[SmartThingsControls] getSessionStatus error:', err);
    appendDebugLog(`Session status failed: ${getErrorMessage(err)}`, true);
    authUI.showConnectPanel(AUTH_SERVICE_UNAVAILABLE_MESSAGE, false);
    return;
  }

  if (!initialSessionStatus.authenticated) {
    authUI.showConnectPanel(
      initialSessionStatus.configured ? AUTH_DISCONNECTED_MESSAGE : AUTH_CONFIG_MISSING_MESSAGE,
      initialSessionStatus.configured
    );
    return;
  }

  authUI.showConnectedState(initialSessionStatus);
  appendDebugLog('SmartThings session is active.');
  void requestWakeLock('startup');

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
    await disconnectSmartThings().catch(() => undefined);
    store.dispatch({ type: 'AUTH_EXPIRED', message: AUTH_RECONNECT_MESSAGE });
    refreshPage();
    authUI.showConnectPanel(AUTH_RECONNECT_MESSAGE);
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

  const startupPage = composeStartupPage(store.getState());
  appendDebugLog(
    `Creating glasses startup page. view=${store.getState().listView} containers=${startupPage.containerTotalNum ?? 0}`
  );
  const startupResult = await hub.setupPage(startupPage);
  appendDebugLog(
    `Startup page result: ${describeStartUpPageResult(startupResult.code)}`
      + (startupResult.success ? '' : ' (the glasses may remain blank until this succeeds)'),
    !startupResult.success
  );

  (async () => {
    try {
      const scenes = await withSmartThingsClient((client) => client.scenes.list());
      store.dispatch({ type: 'SCENES_LOADED', scenes: normalizeScenes(scenes) });
    } catch (err) {
      if (await handleTerminalAuthFailure(err)) return;
      const message = getErrorMessage(err);
      store.dispatch({ type: 'SCENES_ERROR', message });
    }
  })();

  roomsLoadPromise = loadRooms();
  void roomsLoadPromise;
  void loadGlobalStats();

  try {
    await loadIconCache();
    const deviceInfo = await hub.getDeviceInfo();
    const isLikelySimulator =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    useRawImages = !isLikelySimulator && hub.isRealGlasses(deviceInfo);
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

  async function loadRooms(): Promise<void> {
    try {
      const locationId = await getLocationId();
      if (!locationId) {
        store.dispatch({ type: 'ROOMS_ERROR', message: 'No location found for rooms' });
        refreshPage();
        return;
      }
      const [roomsRes, devicesRes] = await Promise.all([
        withSmartThingsClient((client) => client.rooms.list(locationId)),
        withSmartThingsClient((client) => client.devices.list({ locationId }).catch(() => [])),
      ]);
      store.dispatch({
        type: 'ROOMS_LOADED',
        rooms: roomsRes.map((r) => ({
          roomId: r.roomId ?? '',
          roomName: (r.name ?? 'Room').slice(0, SCENE_NAME_MAX_LEN),
        })),
      });
      store.dispatch({ type: 'ALL_DEVICES_LOADED', devices: normalizeDevices(devicesRes) });
    } catch (err) {
      if (await handleTerminalAuthFailure(err)) {
        refreshPage();
        return;
      }
      const message = getErrorMessage(err);
      store.dispatch({ type: 'ROOMS_ERROR', message });
    }
    refreshPage();
  }

  async function getLocationId(): Promise<string | undefined> {
    try {
      const locations = await withSmartThingsClient((client) => client.locations.list());
      return locations[0]?.locationId;
    } catch {
      const scenes = await withSmartThingsClient((client) => client.scenes.list());
      return scenes[0]?.locationId;
    }
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

  async function updateTextModePage(reason: string): Promise<boolean> {
    const listOk = await hub.updateText(
      CONTAINER_ID_BOOT_LIST,
      CONTAINER_NAME_BOOT_LIST,
      getTextModeListContent()
    );
    const statsOk = await hub.updateText(
      CONTAINER_ID_STATS,
      CONTAINER_NAME_STATS,
      getTextModeStatsContent()
    );
    if (!listOk || !statsOk) {
      appendDebugLog(`Text-mode page update failed (${reason}).`, true);
      return false;
    }
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
      return true;
    }

    appendDebugLog(`Rich glasses rebuild failed (${reason}). Trying list-only fallback.`, true);
    const listSuccess = await hub.updatePage(composeListOnlyPage(state, focusIndex));
    if (listSuccess) {
      if (glassesLayoutMode !== 'list') {
        appendDebugLog('Recovered with list-only glasses layout.');
      }
      glassesLayoutMode = 'list';
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

  if (startupResult.success && useRealGlasses) {
    glassesLayoutMode = 'text';
    appendDebugLog('Using fixed text glasses layout for real-device compatibility.');
    const textReady = await updateTextModePage('post-startup text layout');
    if (!textReady) {
      authUI.setConnectionStatus('Connected, but the text-mode glasses UI failed to update. Open the runtime console on your phone.');
    }
  } else if (startupResult.success) {
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
  let confirmationDismissTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let confirmationShowing: ConfirmationResult | null = null;
  let lastTextModeScrollAt = 0;
  let lastTextModeScrollDirection: -1 | 0 | 1 = 0;

  const showConfirmation: ShowConfirmationFn = async (result: ConfirmationResult): Promise<void> => {
    if (!canUseConfirmationImage()) return;
    if (confirmationDismissTimeoutId !== null) {
      clearTimeout(confirmationDismissTimeoutId);
      confirmationDismissTimeoutId = null;
    }
    if (confirmationShowing === result) {
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

  /** True if command response has no FAILED result and device is not OFFLINE. */
  async function isDeviceCommandSuccess(
    deviceId: string,
    response: { results?: Array<{ status?: string }> }
  ): Promise<boolean> {
    const results = response?.results ?? [];
    if (results.some((r) => r.status === 'FAILED')) return false;
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
      const response = await withSmartThingsClient((client) =>
        client.devices.executeCommand(deviceId, {
          capability: 'switch',
          command: on ? 'on' : 'off',
        })
      );
      const success = await isDeviceCommandSuccess(deviceId, response);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) void loadDeviceStats(deviceId);
    } catch (err) {
      await handleTerminalAuthFailure(err);
      await showConfirmation('failure');
    }
  }

  async function runDeviceSetLevel(deviceId: string, level: number): Promise<void> {
    try {
      const response = await withSmartThingsClient((client) =>
        client.devices.executeCommand(deviceId, {
          capability: 'switchLevel',
          command: 'setLevel',
          arguments: [level],
        })
      );
      const success = await isDeviceCommandSuccess(deviceId, response);
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
    let successCount = 0;
    for (const d of devices) {
      try {
        const response = await withSmartThingsClient((client) =>
          client.devices.executeCommand(d.deviceId, {
            capability: 'switch',
            command: on ? 'on' : 'off',
          })
        );
        const ok = await isDeviceCommandSuccess(d.deviceId, response);
        if (ok) successCount++;
      } catch (err) {
        if (await handleTerminalAuthFailure(err)) break;
        // Individual failures are captured by successCount.
      }
    }
    await showConfirmation(confirmationResultFromCounts(successCount, devices.length));
  }

  async function runAllDimmableDevicesSetLevel(level: number): Promise<void> {
    const devices = store.getState().devices.filter((d) => d.supportsDimmer);
    if (devices.length === 0) {
      await showConfirmation('failure');
      return;
    }
    let successCount = 0;
    for (const d of devices) {
      try {
        const response = await withSmartThingsClient((client) =>
          client.devices.executeCommand(d.deviceId, {
            capability: 'switchLevel',
            command: 'setLevel',
            arguments: [level],
          })
        );
        const ok = await isDeviceCommandSuccess(d.deviceId, response);
        if (ok) successCount++;
      } catch (err) {
        if (await handleTerminalAuthFailure(err)) break;
        // Individual failures are captured by successCount.
      }
    }
    await showConfirmation(confirmationResultFromCounts(successCount, devices.length));
  }

  async function loadDevicesForRoom(roomId: string): Promise<void> {
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

  function getConfiguredGlassesMenuLaunchView(): 'scenes' | 'rooms' | 'favorites' {
    const state = store.getState();
    switch (state.preferences.glassesMenuDefault) {
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
        listView === 'favorites' ||
        listView === 'device-dim' ||
        listView === 'room-all-detail' ||
        listView === 'room-all-dim';
      if (tapCount === 2 && isFirst && canDoubleTapGoBack) {
        if (listView === 'devices') {
          store.dispatch({ type: 'NAV_VIEW', view: 'rooms' });
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
            void runExecuteScene(store, withSmartThingsClient, actualSceneIndex, showConfirmation);
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
                void runExecuteScene(store, withSmartThingsClient, sceneIndex, showConfirmation);
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
        const hasSwitch = device?.supportsSwitch ?? false;
        const hasDim = device?.supportsDimmer ?? false;
        if (listIndex === 0) {
          store.dispatch({
            type: 'NAV_VIEW',
            view: state.selectedRoomId == null ? 'favorites' : 'devices',
          });
          refreshPage();
        } else if (deviceId && hasSwitch && listIndex === 1) {
          void runDeviceSwitch(deviceId, true);
        } else if (deviceId && hasSwitch && listIndex === 2) {
          void runDeviceSwitch(deviceId, false);
        } else if (deviceId && hasDim && (hasSwitch ? listIndex === 3 : listIndex === 1)) {
          store.dispatch({ type: 'NAV_VIEW', view: 'device-dim' });
          refreshPage();
          if (state.selectedDeviceId) void loadDeviceStats(state.selectedDeviceId);
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
    const maxIndex = getLastListIndex(state);
    if (maxIndex <= 0 && state.focusedListIndex === 0) return;
    const nextIndex = Math.max(0, Math.min(state.focusedListIndex + delta, maxIndex));
    if (nextIndex === state.focusedListIndex) return;
    store.dispatch({ type: 'TAP', selectedIndex: nextIndex });
    refreshPage();
  }

  function triggerTextModeTap(gestureTaps: 1 | 2): void {
    if (commitTimeoutId !== null) {
      clearTimeout(commitTimeoutId);
      commitTimeoutId = null;
    }
    const state = store.getState();
    lastTapIndex = Math.min(state.focusedListIndex, getLastListIndex(state));
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

  function handleTextModeEvent(event: EvenHubEvent): boolean {
    const rawType =
      event.listEvent?.eventType ??
      event.textEvent?.eventType ??
      event.sysEvent?.eventType ??
      null;
    const eventType = rawType != null ? OsEventTypeList.fromJson(rawType) ?? Number(rawType) : null;

    if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
      if (!shouldProcessTextModeScroll(-1)) return true;
      moveTextModeFocus(-1);
      return true;
    }
    if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      if (!shouldProcessTextModeScroll(1)) return true;
      moveTextModeFocus(1);
      return true;
    }
    if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      triggerTextModeTap(2);
      return true;
    }
    if (eventType === OsEventTypeList.CLICK_EVENT || eventType == null) {
      triggerTextModeTap(1);
      return true;
    }
    return false;
  }

  setupConfigUI(store, hub, refreshPage);
  store.subscribe((state) => {
    persistLaunchResume(state);
  });

  let launchSourceResolved = false;
  let launchSourceTimeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    if (launchSourceResolved) return;
    launchSourceResolved = true;
    void storedLaunchResumePromise.then((storedLaunchResume) => {
      enableLaunchResumePersistence(storedLaunchResume);
    });
  }, 1500);

  hub.subscribeLaunchSource((source) => {
    appendDebugLog(`Launch source received: ${source}`);
    if (launchSourceResolved) return;
    launchSourceResolved = true;
    if (launchSourceTimeoutId !== null) {
      clearTimeout(launchSourceTimeoutId);
      launchSourceTimeoutId = null;
    }
    void (async () => {
      const storedLaunchResume = await storedLaunchResumePromise;
      try {
        if (source === LAUNCH_SOURCE_GLASSES_MENU) {
          await preferencesLoadPromise;
          if (store.getState().preferences.glassesMenuDefault === 'resume') {
            const restored = await restoreLaunchResume(storedLaunchResume);
            if (!restored) openConfiguredGlassesMenuView();
          } else {
            openConfiguredGlassesMenuView();
          }
        }
      } finally {
        enableLaunchResumePersistence(storedLaunchResume);
        if (source === LAUNCH_SOURCE_GLASSES_MENU) {
          persistLaunchResume(store.getState());
        }
      }
    })();
  });

  function handleHubEvent(event: EvenHubEvent): void {
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
      recentListIndices.push({ index: listIndex, time: now });
      const cutoff = now - SCROLL_WINDOW_MS;
      while (recentListIndices.length > 0) {
        const first = recentListIndices[0];
        if (first == null || first.time >= cutoff) break;
        recentListIndices.shift();
      }
      const uniqueIndicesInWindow = new Set(recentListIndices.map((e) => e.index)).size;
      const likelyScrolling = uniqueIndicesInWindow >= 2;

      const isSameItemAgain = listIndex === lastTapIndex && now - lastTapTime <= TAP_WINDOW_MS;
      const isNewItemSingleTap = !isSameItemAgain && gestureTaps === 1;
      if (isSameItemAgain) {
        tapCount = Math.min(tapCount + gestureTaps, 4);
      } else {
        tapCount = Math.min(gestureTaps, 4);
        lastTapIndex = listIndex;
      }
      lastTapTime = now;

      if (commitTimeoutId !== null) clearTimeout(commitTimeoutId);
      const skipCommitForScroll = isNewItemSingleTap && likelyScrolling;
      if (!skipCommitForScroll) {
        commitTimeoutId = setTimeout(commitTap, TAP_COMMIT_MS);
      } else {
        commitTimeoutId = null;
      }
    }
  }

  function attachHubEventSubscription(reason: string): void {
    hub.subscribeEvents(handleHubEvent);
    if (reason === 'startup') {
      appendDebugLog('EvenHub event subscription ready.');
      return;
    }
    appendDebugLog(`EvenHub event subscription refreshed (${reason}).`);
  }

  const RESUME_SYNC_DEBOUNCE_MS = 1500;
  let resumeSyncPromise: Promise<void> | null = null;
  let lastResumeSyncAt = 0;

  async function syncGlassesAfterResume(reason: string): Promise<boolean> {
    if (!hub.hasBridge()) return false;

    if (useRealGlasses) {
      glassesLayoutMode = 'text';
      const textSynced = await updateTextModePage(`${reason} text refresh`);
      if (textSynced) {
        await pushInitialImages();
        return true;
      }
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
      const textSynced = await updateTextModePage(`${reason} post-startup text refresh`);
      if (textSynced) {
        await pushInitialImages();
      }
      return textSynced;
    }

    const rebuilt = await rebuildFullPage(`${reason} post-startup rebuild`);
    if (rebuilt && canUseConfirmationImage()) {
      await pushInitialImages();
    }
    return rebuilt;
  }

  async function resumeBridgeSession(reason: string): Promise<void> {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }
    const now = Date.now();
    if (resumeSyncPromise) {
      return resumeSyncPromise;
    }
    if (now - lastResumeSyncAt < RESUME_SYNC_DEBOUNCE_MS) {
      return;
    }
    lastResumeSyncAt = now;

    const task = (async () => {
      appendDebugLog(`Resume sync triggered (${reason}).`);
      invalidateSmartThingsClient(`resume:${reason}`);
      await hub.init(3000);
      appendDebugLog(`Resume bridge refresh complete (${reason}). bridge=${hub.hasBridge()}`);
      if (!hub.hasBridge()) {
        appendDebugLog(`Resume bridge refresh failed (${reason}).`, true);
        return;
      }

      await requestWakeLock(`resume:${reason}`);

      attachHubEventSubscription(`resume:${reason}`);

      try {
        const sessionStatus = await getSessionStatus();
        appendDebugLog(
          `Resume session status (${reason}). authenticated=${sessionStatus.authenticated} configured=${sessionStatus.configured}`
        );
        if (!sessionStatus.authenticated) {
          authUI.showConnectPanel(
            sessionStatus.configured ? AUTH_DISCONNECTED_MESSAGE : AUTH_CONFIG_MISSING_MESSAGE,
            sessionStatus.configured
          );
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
    })().finally(() => {
      resumeSyncPromise = null;
    });

    resumeSyncPromise = task;
    return task;
  }

  const visibilityHandler = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      invalidateSmartThingsClient('hidden');
      void releaseWakeLock('hidden');
      return;
    }
    void requestWakeLock('visibilitychange');
    void resumeBridgeSession('visibilitychange');
  };
  const pageshowHandler = () => {
    void requestWakeLock('pageshow');
    void resumeBridgeSession('pageshow');
  };
  const focusHandler = () => {
    void requestWakeLock('focus');
    void resumeBridgeSession('focus');
  };
  const onlineHandler = () => {
    void requestWakeLock('online');
    void resumeBridgeSession('online');
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', visibilityHandler);
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pageshow', pageshowHandler);
    window.addEventListener('focus', focusHandler);
    window.addEventListener('online', onlineHandler);
    window.addEventListener('beforeunload', () => {
      void releaseWakeLock('beforeunload');
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', visibilityHandler);
      }
      window.removeEventListener('pageshow', pageshowHandler);
      window.removeEventListener('focus', focusHandler);
      window.removeEventListener('online', onlineHandler);
    });
  }

  attachHubEventSubscription('startup');
  console.log('[SmartThingsControls] Initialized.');
}
