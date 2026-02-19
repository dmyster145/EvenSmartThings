/**
 * Even SmartThings — Application entry point.
 *
 * Flow: Bridge init → PAT from storage → SmartThings client → fetch scenes →
 * setup G2 list → rebuild list with scene names → subscribe events. Tap on list runs scene.
 */

import { SmartThingsClient, BearerTokenAuthenticator, DeviceHealthState } from '@smartthings/core-sdk';
import type { SceneSummary, Device } from '@smartthings/core-sdk';
import { createStore } from './state/store';
import { buildInitialState } from './state/reducer';
import type { SceneEntry, DeviceEntry, ListOrderPreference } from './state/contracts';
import { mapEvenHubEvent } from './input/actions';
import {
  composeStartupPage,
  composePageForState,
  getTotalPages,
  getFirstPageContentSlots,
  getLastListIndex,
  getStatsContent,
  CONTAINER_ID_STATS,
  CONTAINER_NAME_STATS,
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
} from './state/selectors';
import { EvenHubBridge } from './evenhub/bridge';
import { encryptPatOrPlaintext, decryptPat } from './crypto/pat-storage';
import {
  PAT_STORAGE_KEY,
  SCENE_NAME_MAX_LEN,
  CONTAINER_ID_CONFIRMATION,
  CONTAINER_NAME_CONFIRMATION,
  CONFIRMATION_WIDTH,
  CONFIRMATION_HEIGHT,
  SCENES_PER_PAGE,
  ROOMS_PER_PAGE,
} from './state/constants';
import { getStoredPreferences, setStoredPreferences } from './state/preferences-storage';
import { ImageRawDataUpdate } from '@evenrealities/even_hub_sdk';

const CONFIG_PANEL_ID = 'config';

/** Persist PAT in bridge and localStorage so it survives app restarts (bridge storage may not). */
async function getStoredPat(hub: EvenHubBridge): Promise<string> {
  const fromBridge = await hub.getLocalStorage(PAT_STORAGE_KEY);
  if (fromBridge && fromBridge.trim()) return fromBridge;
  try {
    const fromLocal = typeof localStorage !== 'undefined' ? localStorage.getItem(PAT_STORAGE_KEY) : null;
    return fromLocal ?? '';
  } catch {
    return '';
  }
}

async function setStoredPat(hub: EvenHubBridge, value: string): Promise<void> {
  await hub.setLocalStorage(PAT_STORAGE_KEY, value);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(PAT_STORAGE_KEY, value);
  } catch {
    // ignore
  }
}

async function clearStoredPat(hub: EvenHubBridge): Promise<void> {
  await hub.setLocalStorage(PAT_STORAGE_KEY, '');
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(PAT_STORAGE_KEY);
  } catch {
    // ignore
  }
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
    return getOrderedFavorites(state).map((f) => ({ id: f.id, displayName: f.displayName }));
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
          // Don't set container.hidden = false here; expansion only via dropdown click/focus/change (avoids re-expanding on glasses taps)
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
          else if (list === 'favorites') customIds = prefs.favoritesIds.map((f) => f.id);
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
      saveAndRefresh();
    }
    if (upBtn) upBtn.onclick = () => move(true);
    if (downBtn) downBtn.onclick = () => move(false);
    if (doneBtn && container) doneBtn.onclick = () => { container.hidden = true; };
  });
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

function confirmationResultFromCounts(successCount: number, total: number): ConfirmationResult {
  if (total === 0 || successCount === 0) return 'failure';
  if (successCount === total) return 'success';
  return 'partial';
}

async function runExecuteScene(
  store: ReturnType<typeof createStore>,
  client: SmartThingsClient,
  _hub: EvenHubBridge,
  selectedIndex: number,
  _useRawImagesForIcons: boolean,
  showConfirmation: ShowConfirmationFn
): Promise<void> {
  const state = store.getState();
  const scene = getSceneByIndex(state, selectedIndex);
  if (!scene || state.status === 'executing') return;

  store.dispatch({ type: 'EXECUTE_START' });
  try {
    const result = await client.scenes.execute(scene.sceneId) as { status?: string; results?: Array<{ status?: string }> } | undefined;
    const status = result?.status;
    const success = status === 'success';

    // If API returns per-action results, use same partial logic as "all devices in room"
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
    const message = err instanceof Error ? err.message : String(err);
    store.dispatch({ type: 'EXECUTE_END', success: false, errorMessage: message });
    await showConfirmation('failure');
  }
}

export async function initApp(): Promise<void> {
  const hub = new EvenHubBridge();

  try {
    await hub.init();
  } catch (err) {
    console.warn('[EvenSmartThings] Init error:', err);
    showPanel(OPEN_IN_EVEN_ID);
    return;
  }

  if (!hub.hasBridge()) {
    showPanel(OPEN_IN_EVEN_ID);
    return;
  }

  let pat: string;
  try {
    const raw = await getStoredPat(hub);
    pat = await decryptPat(raw);
  } catch (err) {
    console.warn('[EvenSmartThings] getStoredPat/decrypt error:', err);
    showPanel(OPEN_IN_EVEN_ID);
    return;
  }

  if (!pat.trim()) {
    showPanel(CONFIG_PANEL_ID);
    const form = document.getElementById('config-form') as HTMLFormElement | null;
    const statusEl = document.getElementById('config-status');
    const saveBtn = document.getElementById('config-save-btn');

    function setStatus(msg: string): void {
      if (statusEl) statusEl.textContent = msg;
    }

    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        const input = document.getElementById('pat') as HTMLInputElement | null;
        const value = input?.value?.trim() ?? '';
        if (!value) {
          setStatus('Enter a token.');
          return;
        }
        if (saveBtn) (saveBtn as HTMLButtonElement).disabled = true;
        setStatus('Saving...');
        (async () => {
          try {
            const toStore = await encryptPatOrPlaintext(value);
            await setStoredPat(hub, toStore);
            setStatus('Saved. Reloading…');
            location.reload();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setStatus('Error: ' + message);
            if (saveBtn) (saveBtn as HTMLButtonElement).disabled = false;
          }
        })();
      };
    }
    return;
  }

  showGlassesActive();

  const deleteTokenBtn = document.getElementById('delete-token-btn');
  const deleteConfirmEl = document.getElementById('delete-token-confirm');
  const deleteConfirmCancel = document.getElementById('delete-token-confirm-cancel');
  const deleteConfirmDo = document.getElementById('delete-token-confirm-do');

  if (deleteTokenBtn && deleteConfirmEl) {
    deleteTokenBtn.onclick = () => {
      deleteConfirmEl.style.display = 'block';
    };
  }
  if (deleteConfirmCancel && deleteConfirmEl) {
    deleteConfirmCancel.onclick = () => {
      deleteConfirmEl.style.display = 'none';
    };
  }
  if (deleteConfirmDo && deleteConfirmEl) {
    deleteConfirmDo.onclick = async () => {
      await clearStoredPat(hub);
      location.reload();
    };
  }
  const toggleDebugBtn = document.getElementById('toggle-debug-btn');
  const debugLogContainer = document.getElementById('debug-log-container');
  if (toggleDebugBtn && debugLogContainer) {
    toggleDebugBtn.onclick = () => {
      const visible = debugLogContainer.style.display !== 'none';
      debugLogContainer.style.display = visible ? 'none' : 'block';
      toggleDebugBtn.textContent = visible ? 'Show debug log' : 'Hide debug log';
    };
  }

  const client = new SmartThingsClient(new BearerTokenAuthenticator(pat));
  const store = createStore(buildInitialState());

  let refreshPage: () => void = () => {};
  (async () => {
    try {
      const prefs = await getStoredPreferences(hub);
      store.dispatch({ type: 'PREFERENCES_LOADED', preferences: prefs });
      refreshPage();
    } catch {
      // keep default preferences
    }
  })();

  let useRawImages = false;
  let useRealGlasses = false;

  const startupPage = composeStartupPage(store.getState());
  const setupOk = await hub.setupPage(startupPage);
  if (!setupOk) {
    const state = store.getState();
    const focusIndex = Math.min(state.focusedListIndex, getLastListIndex(state));
    void hub.updatePage(composePageForState(state, focusIndex));
  }

  (async () => {
    try {
      const scenes = await client.scenes.list();
      store.dispatch({ type: 'SCENES_LOADED', scenes: normalizeScenes(scenes) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.dispatch({ type: 'SCENES_ERROR', message });
    }
  })();

  void loadRooms();
  void loadGlobalStats();

  try {
    await loadIconCache();
    const deviceInfo = await hub.getDeviceInfo();
    const isLikelySimulator =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    useRawImages = !isLikelySimulator && hub.isRealGlasses(deviceInfo);
    useRealGlasses = hub.isRealGlasses(deviceInfo);
  } catch {
    // non-fatal
  }

  const blankConfirmation = getBlankImageData(CONFIRMATION_WIDTH, CONFIRMATION_HEIGHT, useRawImages);
  const pushInitialImages = (): Promise<void> =>
    hub.updateBoardImage(
      new ImageRawDataUpdate({
        containerID: CONTAINER_ID_CONFIRMATION,
        containerName: CONTAINER_NAME_CONFIRMATION,
        imageData: blankConfirmation,
      })
    ).then(() => {});
  await new Promise((r) => setTimeout(r, 200));
  await pushInitialImages();
  setTimeout(() => void pushInitialImages(), 800);

  // Glasses: double-tap comes as sysEvent(3); triple-tap needs listEvent + sysEvent(3) or two sysEvent(3) within the window. Longer window gives more time to complete triple-tap without rushing.
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
        client.rooms.list(locationId),
        client.devices.list({ locationId }).catch(() => []),
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
      const message = err instanceof Error ? err.message : String(err);
      store.dispatch({ type: 'ROOMS_ERROR', message });
    }
    refreshPage();
  }

  async function getLocationId(): Promise<string | undefined> {
    try {
      const locations = await client.locations.list();
      return locations[0]?.locationId;
    } catch {
      const scenes = await client.scenes.list();
      return scenes[0]?.locationId;
    }
  }

  /** Rebuild and send the current page, preserving the list focus so it doesn't jump to top. */
  refreshPage = (): void => {
    const state = store.getState();
    const lastListIndex = getLastListIndex(state);
    const focusIndex = Math.min(state.focusedListIndex, lastListIndex);
    void hub.updatePage(composePageForState(state, focusIndex));
  };

  async function loadGlobalStats(): Promise<void> {
    try {
      const locationId = await getLocationId();
      if (!locationId) return;
      const devices = await client.devices.list({ locationId, includeHealth: true });
      let online = 0;
      let offline = 0;
      for (const d of devices) {
        const health = (d as Device & { healthState?: { state?: string } }).healthState?.state;
        if (health === 'ONLINE') online++;
        else if (health === 'OFFLINE') offline++;
        else {
          try {
            const h = await client.devices.getHealth(d.deviceId);
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
    } catch {
      // leave globalStats null
    }
    // Update only the stats panel so list selection doesn't jump to top
    void hub.updateText(CONTAINER_ID_STATS, CONTAINER_NAME_STATS, getStatsContent(store.getState()));
  }

  async function loadRoomStats(): Promise<void> {
    const devices = store.getState().devices;
    if (devices.length === 0) {
      store.dispatch({ type: 'STATS_ROOM', stats: null });
      // Update only the stats panel so list selection doesn't jump to top
      void hub.updateText(CONTAINER_ID_STATS, CONTAINER_NAME_STATS, getStatsContent(store.getState()));
      return;
    }
    try {
      let online = 0;
      let offline = 0;
      for (const d of devices) {
        try {
          const h = await client.devices.getHealth(d.deviceId);
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
    } catch {
      store.dispatch({ type: 'STATS_ROOM', stats: null });
    }
    // Update only the stats panel so list selection doesn't jump to top
    void hub.updateText(CONTAINER_ID_STATS, CONTAINER_NAME_STATS, getStatsContent(store.getState()));
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
        client.devices.getHealth(deviceId),
        client.devices.getStatus(deviceId),
        client.devices.getPresentation(deviceId).catch(() => null),
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
    } catch {
      store.dispatch({ type: 'STATS_DEVICE', stats: null });
    }
    // Update only the stats panel so list selection doesn't jump to top
    void hub.updateText(CONTAINER_ID_STATS, CONTAINER_NAME_STATS, getStatsContent(store.getState()));
  }

  const CONFIRM_DISMISS_MS = 5000;
  const CONFIRM_FLASH_MS = 150;
  let confirmationDismissTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let confirmationShowing: ConfirmationResult | null = null;

  const showConfirmation: ShowConfirmationFn = async (result: ConfirmationResult): Promise<void> => {
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
      const health = await client.devices.getHealth(deviceId);
      if (health.state === DeviceHealthState.OFFLINE) return false;
    } catch {
      // Health check failed; treat as success (command was accepted)
    }
    return true;
  }

  async function runDeviceSwitch(deviceId: string, on: boolean): Promise<void> {
    try {
      const response = await client.devices.executeCommand(deviceId, {
        capability: 'switch',
        command: on ? 'on' : 'off',
      });
      const success = await isDeviceCommandSuccess(deviceId, response);
      await showConfirmation(success ? 'success' : 'failure');
      if (success) void loadDeviceStats(deviceId);
    } catch {
      await showConfirmation('failure');
    }
  }

  async function runDeviceSetLevel(deviceId: string, level: number): Promise<void> {
    try {
      const response = await client.devices.executeCommand(deviceId, {
        capability: 'switchLevel',
        command: 'setLevel',
        arguments: [level],
      });
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
        // Update only the stats panel so list selection doesn't jump to top
        void hub.updateText(CONTAINER_ID_STATS, CONTAINER_NAME_STATS, getStatsContent(store.getState()));
        // Skip refetch after setLevel — API often returns previous brightness and would overwrite the value we just set.
      }
    } catch {
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
        const response = await client.devices.executeCommand(d.deviceId, {
          capability: 'switch',
          command: on ? 'on' : 'off',
        });
        const ok = await isDeviceCommandSuccess(d.deviceId, response);
        if (ok) successCount++;
      } catch {
        // count stays
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
        const response = await client.devices.executeCommand(d.deviceId, {
          capability: 'switchLevel',
          command: 'setLevel',
          arguments: [level],
        });
        const ok = await isDeviceCommandSuccess(d.deviceId, response);
        if (ok) successCount++;
      } catch {
        // count stays
      }
    }
    await showConfirmation(confirmationResultFromCounts(successCount, devices.length));
  }

  async function loadDevicesForRoom(roomId: string): Promise<void> {
    try {
      const locationId = await getLocationId();
      const devices = await client.rooms.listDevices(roomId, locationId);
      store.dispatch({ type: 'DEVICES_LOADED', devices: normalizeDevices(devices) });
      refreshPage();
      void loadRoomStats();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.dispatch({ type: 'DEVICES_ERROR', message });
      refreshPage();
    }
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
      if (tapCount === 2 && isFirst && (listIndex === 0 || listView === 'scenes' || listView === 'devices' || listView === 'favorites' || listView === 'device-dim' || listView === 'room-all-detail' || listView === 'room-all-dim')) {
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
            void runExecuteScene(store, client, hub, actualSceneIndex, useRawImages, showConfirmation);
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
                void runExecuteScene(store, client, hub, sceneIndex, useRawImages, showConfirmation);
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

  setupConfigUI(store, hub, refreshPage);

  hub.subscribeEvents((event) => {
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
  });

  console.log('[EvenSmartThings] Initialized.');
}
