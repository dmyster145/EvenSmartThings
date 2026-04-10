import { describe, it, expect, vi } from 'vitest';

// Mock the Even Hub SDK — composer.ts imports it for container builders that
// are not exercised by deviceDetailItemNames, but the module must resolve.
vi.mock('@evenrealities/even_hub_sdk', () => ({
  CreateStartUpPageContainer: vi.fn(),
  RebuildPageContainer: vi.fn(),
  ListContainerProperty: vi.fn(),
  ListItemContainerProperty: vi.fn(),
  ImageContainerProperty: vi.fn(),
  TextContainerProperty: vi.fn(),
}));

import { deviceDetailItemNames } from './composer';
import { buildInitialState } from '../state/reducer';
import type { AppState, DeviceEntry } from '../state/contracts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BACK = '← Back';

function makeState(flags: Partial<DeviceEntry> = {}): AppState {
  const device: DeviceEntry = { deviceId: 'd1', deviceName: 'Test Device', ...flags };
  return {
    ...buildInitialState(),
    listView: 'device-detail',
    selectedDeviceId: 'd1',
    devices: [device],
  };
}

/**
 * Simulate the TAP handler's sequential idx-walking for a given DeviceEntry,
 * returning the list of [listIndex, actionLabel] pairs.
 * This must stay in sync with the TAP handler in app.ts.
 */
function simulateTapActions(device: DeviceEntry): Array<{ index: number; action: string }> {
  const actions: Array<{ index: number; action: string }> = [];
  let idx = 1;

  if (device.supportsSwitch) {
    actions.push({ index: idx, action: 'switch_on' });
    actions.push({ index: idx + 1, action: 'switch_off' });
    idx += 2;
  }
  if (device.supportsGarageDoor) {
    actions.push({ index: idx, action: 'garage_open' });
    actions.push({ index: idx + 1, action: 'garage_close' });
    idx += 2;
  }
  if (device.supportsLock) {
    actions.push({ index: idx, action: 'lock_lock' });
    actions.push({ index: idx + 1, action: 'lock_unlock' });
    idx += 2;
  }
  if (device.supportsMediaPlayback) {
    actions.push({ index: idx, action: 'media_play' });
    actions.push({ index: idx + 1, action: 'media_pause' });
    actions.push({ index: idx + 2, action: 'media_stop' });
    idx += 3;
  }
  if (device.supportsAudioVolume) {
    actions.push({ index: idx, action: 'vol_up' });
    actions.push({ index: idx + 1, action: 'vol_down' });
    idx += 2;
  }
  if (device.supportsAudioMute) {
    actions.push({ index: idx, action: 'mute' });
    actions.push({ index: idx + 1, action: 'unmute' });
    idx += 2;
  }
  if (device.supportsMediaTrackControl) {
    actions.push({ index: idx, action: 'prev' });
    actions.push({ index: idx + 1, action: 'next' });
    idx += 2;
  }
  if (device.supportsTvChannel) {
    actions.push({ index: idx, action: 'ch_up' });
    actions.push({ index: idx + 1, action: 'ch_down' });
    idx += 2;
  }
  if (device.supportsWindowShade) {
    actions.push({ index: idx, action: 'shade_open' });
    actions.push({ index: idx + 1, action: 'shade_close' });
    actions.push({ index: idx + 2, action: 'shade_pause' });
    idx += 3;
  }
  if (device.supportsValve) {
    actions.push({ index: idx, action: 'valve_open' });
    actions.push({ index: idx + 1, action: 'valve_close' });
    idx += 2;
  }
  if (device.supportsAlarm) {
    actions.push({ index: idx, action: 'alarm_siren' });
    actions.push({ index: idx + 1, action: 'alarm_strobe' });
    actions.push({ index: idx + 2, action: 'alarm_both' });
    actions.push({ index: idx + 3, action: 'alarm_off' });
    idx += 4;
  }
  if (device.supportsThermostatMode) {
    actions.push({ index: idx, action: 'therm_heat' });
    actions.push({ index: idx + 1, action: 'therm_cool' });
    actions.push({ index: idx + 2, action: 'therm_auto' });
    actions.push({ index: idx + 3, action: 'therm_off' });
    actions.push({ index: idx + 4, action: 'therm_emergency_heat' });
    idx += 5;
  }
  if (device.supportsThermostatHeatingSetpoint) {
    actions.push({ index: idx, action: 'heat_plus' });
    actions.push({ index: idx + 1, action: 'heat_minus' });
    idx += 2;
  }
  if (device.supportsThermostatCoolingSetpoint) {
    actions.push({ index: idx, action: 'cool_plus' });
    actions.push({ index: idx + 1, action: 'cool_minus' });
    idx += 2;
  }
  if (device.supportsFanSpeed) {
    actions.push({ index: idx, action: 'fan_plus' });
    actions.push({ index: idx + 1, action: 'fan_minus' });
    idx += 2;
  }
  if (device.supportsColorTemperature) {
    actions.push({ index: idx, action: 'cooler' });
    actions.push({ index: idx + 1, action: 'warmer' });
    idx += 2;
  }
  if (device.supportsColorControl) {
    actions.push({ index: idx,     action: 'color_red' });
    actions.push({ index: idx + 1, action: 'color_orange' });
    actions.push({ index: idx + 2, action: 'color_yellow' });
    actions.push({ index: idx + 3, action: 'color_green' });
    actions.push({ index: idx + 4, action: 'color_cyan' });
    actions.push({ index: idx + 5, action: 'color_blue' });
    actions.push({ index: idx + 6, action: 'color_purple' });
    actions.push({ index: idx + 7, action: 'color_pink' });
    idx += 8;
  }
  if (device.supportsMomentary) {
    actions.push({ index: idx, action: 'push' });
    idx += 1;
  }
  if (device.supportsDimmer) {
    actions.push({ index: idx, action: 'dim' });
  }

  return actions;
}

// ---------------------------------------------------------------------------
// deviceDetailItemNames — no device selected
// ---------------------------------------------------------------------------

describe('deviceDetailItemNames — no device selected', () => {
  it('returns only Back when no device is selected', () => {
    const state = { ...buildInitialState(), listView: 'device-detail' as const, selectedDeviceId: null };
    expect(deviceDetailItemNames(state)).toEqual([BACK]);
  });

  it('returns only Back when selectedDeviceId does not match any device', () => {
    const state = makeState();
    const mismatched = { ...state, selectedDeviceId: 'nonexistent' };
    expect(deviceDetailItemNames(mismatched)).toEqual([BACK]);
  });
});

// ---------------------------------------------------------------------------
// deviceDetailItemNames — individual capabilities
// ---------------------------------------------------------------------------

describe('deviceDetailItemNames — individual capabilities', () => {
  it('switch: On / Off', () => {
    expect(deviceDetailItemNames(makeState({ supportsSwitch: true }))).toEqual([BACK, 'On', 'Off']);
  });

  it('dimmer only: Dim', () => {
    expect(deviceDetailItemNames(makeState({ supportsDimmer: true }))).toEqual([BACK, 'Dim']);
  });

  it('switch + dimmer: On / Off / Dim', () => {
    expect(deviceDetailItemNames(makeState({ supportsSwitch: true, supportsDimmer: true }))).toEqual([BACK, 'On', 'Off', 'Dim']);
  });

  it('garageDoor: Open / Close', () => {
    expect(deviceDetailItemNames(makeState({ supportsGarageDoor: true }))).toEqual([BACK, 'Open', 'Close']);
  });

  it('lock: Lock / Unlock', () => {
    expect(deviceDetailItemNames(makeState({ supportsLock: true }))).toEqual([BACK, 'Lock', 'Unlock']);
  });

  it('mediaPlayback: Play / Pause / Stop', () => {
    expect(deviceDetailItemNames(makeState({ supportsMediaPlayback: true }))).toEqual([BACK, 'Play', 'Pause', 'Stop']);
  });

  it('audioVolume: Vol + / Vol -', () => {
    expect(deviceDetailItemNames(makeState({ supportsAudioVolume: true }))).toEqual([BACK, 'Vol +', 'Vol -']);
  });

  it('audioMute: Mute / Unmute', () => {
    expect(deviceDetailItemNames(makeState({ supportsAudioMute: true }))).toEqual([BACK, 'Mute', 'Unmute']);
  });

  it('mediaTrackControl: Prev / Next', () => {
    expect(deviceDetailItemNames(makeState({ supportsMediaTrackControl: true }))).toEqual([BACK, 'Prev', 'Next']);
  });

  it('tvChannel: Ch+ / Ch-', () => {
    expect(deviceDetailItemNames(makeState({ supportsTvChannel: true }))).toEqual([BACK, 'Ch+', 'Ch-']);
  });

  it('windowShade: Open / Close / Pause (3 actions)', () => {
    expect(deviceDetailItemNames(makeState({ supportsWindowShade: true }))).toEqual([BACK, 'Open', 'Close', 'Pause']);
  });

  it('valve: Open / Close', () => {
    expect(deviceDetailItemNames(makeState({ supportsValve: true }))).toEqual([BACK, 'Open', 'Close']);
  });

  it('alarm: Siren / Strobe / Both / Off', () => {
    expect(deviceDetailItemNames(makeState({ supportsAlarm: true }))).toEqual([BACK, 'Siren', 'Strobe', 'Both', 'Off']);
  });

  it('thermostatMode: Heat / Cool / Auto / Off / Emrg Heat (5 actions)', () => {
    expect(deviceDetailItemNames(makeState({ supportsThermostatMode: true }))).toEqual([BACK, 'Heat', 'Cool', 'Auto', 'Off', 'Emrg Heat']);
  });

  it('thermostatHeatingSetpoint: Heat + / Heat -', () => {
    expect(deviceDetailItemNames(makeState({ supportsThermostatHeatingSetpoint: true }))).toEqual([BACK, 'Heat +', 'Heat -']);
  });

  it('thermostatCoolingSetpoint: Cool + / Cool -', () => {
    expect(deviceDetailItemNames(makeState({ supportsThermostatCoolingSetpoint: true }))).toEqual([BACK, 'Cool +', 'Cool -']);
  });

  it('fanSpeed: Speed + / Speed -', () => {
    expect(deviceDetailItemNames(makeState({ supportsFanSpeed: true }))).toEqual([BACK, 'Speed +', 'Speed -']);
  });

  it('colorTemperature: Cooler / Warmer', () => {
    expect(deviceDetailItemNames(makeState({ supportsColorTemperature: true }))).toEqual([BACK, 'Cooler', 'Warmer']);
  });

  it('colorControl: 8 named color presets', () => {
    expect(deviceDetailItemNames(makeState({ supportsColorControl: true }))).toEqual([
      BACK, 'Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Purple', 'Pink',
    ]);
  });

  it('momentary: Push', () => {
    expect(deviceDetailItemNames(makeState({ supportsMomentary: true }))).toEqual([BACK, 'Push']);
  });

  it('no capabilities: only Back', () => {
    expect(deviceDetailItemNames(makeState({}))).toEqual([BACK]);
  });
});

// ---------------------------------------------------------------------------
// deviceDetailItemNames — realistic multi-capability devices
// ---------------------------------------------------------------------------

describe('deviceDetailItemNames — realistic devices', () => {
  it('dimmable light (switch + dimmer + colorTemperature)', () => {
    const items = deviceDetailItemNames(makeState({
      supportsSwitch: true,
      supportsDimmer: true,
      supportsColorTemperature: true,
    }));
    expect(items).toEqual([BACK, 'On', 'Off', 'Cooler', 'Warmer', 'Dim']);
  });

  it('RGB color bulb (switch + dimmer + colorTemperature + colorControl)', () => {
    const items = deviceDetailItemNames(makeState({
      supportsSwitch: true,
      supportsDimmer: true,
      supportsColorTemperature: true,
      supportsColorControl: true,
    }));
    expect(items).toEqual([
      BACK, 'On', 'Off', 'Cooler', 'Warmer',
      'Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Purple', 'Pink',
      'Dim',
    ]);
  });

  it('Sonos speaker (switch + mediaPlayback + audioVolume + audioMute + mediaTrackControl)', () => {
    const items = deviceDetailItemNames(makeState({
      supportsSwitch: true,
      supportsMediaPlayback: true,
      supportsAudioVolume: true,
      supportsAudioMute: true,
      supportsMediaTrackControl: true,
    }));
    expect(items).toEqual([BACK, 'On', 'Off', 'Play', 'Pause', 'Stop', 'Vol +', 'Vol -', 'Mute', 'Unmute', 'Prev', 'Next']);
  });

  it('full thermostat (mode + heating + cooling setpoints)', () => {
    const items = deviceDetailItemNames(makeState({
      supportsThermostatMode: true,
      supportsThermostatHeatingSetpoint: true,
      supportsThermostatCoolingSetpoint: true,
    }));
    expect(items).toEqual([BACK, 'Heat', 'Cool', 'Auto', 'Off', 'Emrg Heat', 'Heat +', 'Heat -', 'Cool +', 'Cool -']);
  });

  it('Samsung TV (switch + tvChannel + audioVolume + audioMute)', () => {
    const items = deviceDetailItemNames(makeState({
      supportsSwitch: true,
      supportsTvChannel: true,
      supportsAudioVolume: true,
      supportsAudioMute: true,
    }));
    expect(items).toEqual([BACK, 'On', 'Off', 'Vol +', 'Vol -', 'Mute', 'Unmute', 'Ch+', 'Ch-']);
  });

  it('smart lock (switch + lock)', () => {
    const items = deviceDetailItemNames(makeState({ supportsSwitch: true, supportsLock: true }));
    expect(items).toEqual([BACK, 'On', 'Off', 'Lock', 'Unlock']);
  });

  it('motorized blind (windowShade)', () => {
    const items = deviceDetailItemNames(makeState({ supportsWindowShade: true }));
    expect(items).toEqual([BACK, 'Open', 'Close', 'Pause']);
  });

  it('irrigation valve (valve)', () => {
    const items = deviceDetailItemNames(makeState({ supportsValve: true }));
    expect(items).toEqual([BACK, 'Open', 'Close']);
  });

  it('siren alarm (switch + alarm)', () => {
    const items = deviceDetailItemNames(makeState({ supportsSwitch: true, supportsAlarm: true }));
    expect(items).toEqual([BACK, 'On', 'Off', 'Siren', 'Strobe', 'Both', 'Off']);
  });

  it('ceiling fan (switch + fanSpeed)', () => {
    const items = deviceDetailItemNames(makeState({ supportsSwitch: true, supportsFanSpeed: true }));
    expect(items).toEqual([BACK, 'On', 'Off', 'Speed +', 'Speed -']);
  });

  it('doorbell button (momentary)', () => {
    const items = deviceDetailItemNames(makeState({ supportsMomentary: true }));
    expect(items).toEqual([BACK, 'Push']);
  });
});

// ---------------------------------------------------------------------------
// TAP index consistency
// ---------------------------------------------------------------------------

describe('TAP index consistency', () => {
  /**
   * For every DeviceEntry configuration, the number of non-Back items in
   * deviceDetailItemNames must equal the number of actions the TAP handler
   * would handle (i.e., idx ends up at the same position as the label count).
   * This catches off-by-one errors between the label list and the TAP handler.
   */
  function checkConsistency(flags: Partial<DeviceEntry>, label: string): void {
    const device: DeviceEntry = { deviceId: 'd1', deviceName: 'Test', ...flags };
    const state = { ...buildInitialState(), listView: 'device-detail' as const, selectedDeviceId: 'd1', devices: [device] };
    const items = deviceDetailItemNames(state);
    const actions = simulateTapActions(device);

    it(`${label}: label count matches tap action count`, () => {
      // items[0] is Back; the rest are actions
      expect(items.length - 1).toBe(actions.length);
    });

    it(`${label}: each action index maps to a non-empty label`, () => {
      for (const { index } of actions) {
        expect(items[index]).toBeTruthy();
        expect(items[index]).not.toBe(BACK);
      }
    });
  }

  checkConsistency({ supportsSwitch: true }, 'switch');
  checkConsistency({ supportsDimmer: true }, 'dimmer');
  checkConsistency({ supportsSwitch: true, supportsDimmer: true }, 'switch+dimmer');
  checkConsistency({ supportsGarageDoor: true }, 'garageDoor');
  checkConsistency({ supportsLock: true }, 'lock');
  checkConsistency({ supportsMediaPlayback: true }, 'mediaPlayback');
  checkConsistency({ supportsAudioVolume: true }, 'audioVolume');
  checkConsistency({ supportsAudioMute: true }, 'audioMute');
  checkConsistency({ supportsMediaTrackControl: true }, 'mediaTrackControl');
  checkConsistency({ supportsTvChannel: true }, 'tvChannel');
  checkConsistency({ supportsWindowShade: true }, 'windowShade');
  checkConsistency({ supportsValve: true }, 'valve');
  checkConsistency({ supportsAlarm: true }, 'alarm');
  checkConsistency({ supportsThermostatMode: true }, 'thermostatMode');
  checkConsistency({ supportsThermostatHeatingSetpoint: true }, 'heatingSetpoint');
  checkConsistency({ supportsThermostatCoolingSetpoint: true }, 'coolingSetpoint');
  checkConsistency({ supportsFanSpeed: true }, 'fanSpeed');
  checkConsistency({ supportsColorTemperature: true }, 'colorTemperature');
  checkConsistency({ supportsColorControl: true }, 'colorControl');
  checkConsistency({ supportsSwitch: true, supportsDimmer: true, supportsColorTemperature: true, supportsColorControl: true }, 'rgb-bulb');
  checkConsistency({ supportsMomentary: true }, 'momentary');

  // Multi-capability consistency
  checkConsistency({
    supportsSwitch: true, supportsMediaPlayback: true, supportsAudioVolume: true,
    supportsAudioMute: true, supportsMediaTrackControl: true,
  }, 'Sonos');
  checkConsistency({
    supportsThermostatMode: true, supportsThermostatHeatingSetpoint: true,
    supportsThermostatCoolingSetpoint: true,
  }, 'thermostat-full');
  checkConsistency({
    supportsSwitch: true, supportsDimmer: true, supportsColorTemperature: true,
  }, 'color-bulb');
  checkConsistency({
    supportsSwitch: true, supportsLock: true, supportsMomentary: true, supportsDimmer: true,
  }, 'all-mixed');
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('deviceDetailItemNames — edge cases', () => {
  it('Dim always appears last even when combined with many other capabilities', () => {
    const items = deviceDetailItemNames(makeState({
      supportsSwitch: true,
      supportsDimmer: true,
      supportsColorTemperature: true,
      supportsAudioVolume: true,
    }));
    expect(items[items.length - 1]).toBe('Dim');
  });

  it('Back is always index 0', () => {
    const items = deviceDetailItemNames(makeState({ supportsSwitch: true, supportsDimmer: true }));
    expect(items[0]).toBe(BACK);
  });

  it('produces no duplicate indices across all capabilities combined', () => {
    const allFlags: Partial<DeviceEntry> = {
      supportsSwitch: true, supportsDimmer: true, supportsGarageDoor: true,
      supportsLock: true, supportsMediaPlayback: true, supportsAudioVolume: true,
      supportsAudioMute: true, supportsMediaTrackControl: true, supportsTvChannel: true,
      supportsWindowShade: true, supportsValve: true, supportsAlarm: true,
      supportsThermostatMode: true, supportsThermostatHeatingSetpoint: true,
      supportsThermostatCoolingSetpoint: true, supportsFanSpeed: true,
      supportsColorTemperature: true, supportsColorControl: true, supportsMomentary: true,
    };
    const device: DeviceEntry = { deviceId: 'd1', deviceName: 'All', ...allFlags };
    const actions = simulateTapActions(device);
    const indices = actions.map((a) => a.index);
    const uniqueIndices = new Set(indices);
    expect(uniqueIndices.size).toBe(indices.length);
  });

  it('all-capabilities device: tap actions are contiguous from 1 with no gaps', () => {
    const allFlags: Partial<DeviceEntry> = {
      supportsSwitch: true, supportsDimmer: true, supportsGarageDoor: true,
      supportsLock: true, supportsMediaPlayback: true, supportsAudioVolume: true,
      supportsAudioMute: true, supportsMediaTrackControl: true, supportsTvChannel: true,
      supportsWindowShade: true, supportsValve: true, supportsAlarm: true,
      supportsThermostatMode: true, supportsThermostatHeatingSetpoint: true,
      supportsThermostatCoolingSetpoint: true, supportsFanSpeed: true,
      supportsColorTemperature: true, supportsColorControl: true, supportsMomentary: true,
    };
    const device: DeviceEntry = { deviceId: 'd1', deviceName: 'All', ...allFlags };
    const actions = simulateTapActions(device);
    const indices = actions.map((a) => a.index).sort((a, b) => a - b);
    // Should be [1, 2, 3, ... n] with no gaps
    for (let i = 0; i < indices.length; i++) {
      expect(indices[i]).toBe(i + 1);
    }
  });
});
