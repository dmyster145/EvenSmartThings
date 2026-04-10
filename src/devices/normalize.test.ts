import { describe, it, expect } from 'vitest';
import type { Device } from '@smartthings/core-sdk';
import {
  hasCapability,
  normalizeDevices,
  deviceSupportsSwitch,
  deviceSupportsDimmer,
  deviceSupportsGarageDoor,
  deviceSupportsLock,
  deviceSupportsMediaPlayback,
  deviceSupportsAudioVolume,
  deviceSupportsAudioMute,
  deviceSupportsMediaTrackControl,
  deviceSupportsTvChannel,
  deviceSupportsWindowShade,
  deviceSupportsValve,
  deviceSupportsAlarm,
  deviceSupportsThermostatMode,
  deviceSupportsThermostatHeatingSetpoint,
  deviceSupportsThermostatCoolingSetpoint,
  deviceSupportsFanSpeed,
  deviceSupportsColorTemperature,
  deviceSupportsMomentary,
  deviceTypeDisplayName,
  deviceProtocolDisplayName,
} from './normalize';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Device with the given capability IDs on the main component. */
function makeDevice(capabilityIds: string[], overrides: Partial<Device> = {}): Device {
  return {
    deviceId: 'test-id',
    label: 'Test Device',
    components: [
      {
        id: 'main',
        capabilities: capabilityIds.map((id) => ({ id, version: 1 })),
        categories: [],
      },
    ],
    ...overrides,
  } as unknown as Device;
}

/** Build a Device with capabilities spread across multiple components. */
function makeMultiComponentDevice(
  componentCaps: Record<string, string[]>
): Device {
  return {
    deviceId: 'multi-id',
    label: 'Multi Device',
    components: Object.entries(componentCaps).map(([id, caps]) => ({
      id,
      capabilities: caps.map((c) => ({ id: c, version: 1 })),
      categories: [],
    })),
  } as unknown as Device;
}

// ---------------------------------------------------------------------------
// hasCapability
// ---------------------------------------------------------------------------

describe('hasCapability', () => {
  it('returns true when the capability is present on any component', () => {
    expect(hasCapability(makeDevice(['switch']), 'switch')).toBe(true);
  });

  it('returns false when the capability is absent', () => {
    expect(hasCapability(makeDevice(['switch']), 'lock')).toBe(false);
  });

  it('returns true when any of several ids match', () => {
    expect(hasCapability(makeDevice(['doorControl']), 'garageDoorControl', 'doorControl')).toBe(true);
  });

  it('returns false for a device with no components', () => {
    const d = { deviceId: 'x', components: [] } as unknown as Device;
    expect(hasCapability(d, 'switch')).toBe(false);
  });

  it('returns false for a device with undefined components', () => {
    const d = { deviceId: 'x' } as unknown as Device;
    expect(hasCapability(d, 'switch')).toBe(false);
  });

  it('returns false for a component with no capabilities', () => {
    const d = makeDevice([]);
    expect(hasCapability(d, 'switch')).toBe(false);
  });

  it('detects capability on a non-main component', () => {
    const d = makeMultiComponentDevice({ other: ['switch'] });
    expect(hasCapability(d, 'switch')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Individual capability detectors
// ---------------------------------------------------------------------------

describe('capability detectors', () => {
  describe('deviceSupportsSwitch', () => {
    it('returns true for switch capability', () => {
      expect(deviceSupportsSwitch(makeDevice(['switch']))).toBe(true);
    });
    it('returns false when absent', () => {
      expect(deviceSupportsSwitch(makeDevice(['lock']))).toBe(false);
    });
  });

  describe('deviceSupportsDimmer', () => {
    it('returns true for switchLevel capability', () => {
      expect(deviceSupportsDimmer(makeDevice(['switchLevel']))).toBe(true);
    });
    it('returns false when absent', () => {
      expect(deviceSupportsDimmer(makeDevice(['switch']))).toBe(false);
    });
  });

  describe('deviceSupportsGarageDoor', () => {
    it('returns true for garageDoorControl', () => {
      expect(deviceSupportsGarageDoor(makeDevice(['garageDoorControl']))).toBe(true);
    });
    it('returns true for doorControl', () => {
      expect(deviceSupportsGarageDoor(makeDevice(['doorControl']))).toBe(true);
    });
    it('returns false when absent', () => {
      expect(deviceSupportsGarageDoor(makeDevice(['switch']))).toBe(false);
    });
  });

  describe('deviceSupportsLock', () => {
    it('returns true for lock capability', () => {
      expect(deviceSupportsLock(makeDevice(['lock']))).toBe(true);
    });
    it('is not triggered by lockCodes alone', () => {
      expect(deviceSupportsLock(makeDevice(['lockCodes']))).toBe(false);
    });
  });

  describe('deviceSupportsMediaPlayback', () => {
    it('returns true for mediaPlayback', () => {
      expect(deviceSupportsMediaPlayback(makeDevice(['mediaPlayback']))).toBe(true);
    });
  });

  describe('deviceSupportsAudioVolume', () => {
    it('returns true for audioVolume', () => {
      expect(deviceSupportsAudioVolume(makeDevice(['audioVolume']))).toBe(true);
    });
  });

  describe('deviceSupportsAudioMute', () => {
    it('returns true for audioMute', () => {
      expect(deviceSupportsAudioMute(makeDevice(['audioMute']))).toBe(true);
    });
    it('is not triggered by audioVolume alone', () => {
      expect(deviceSupportsAudioMute(makeDevice(['audioVolume']))).toBe(false);
    });
  });

  describe('deviceSupportsMediaTrackControl', () => {
    it('returns true for mediaTrackControl', () => {
      expect(deviceSupportsMediaTrackControl(makeDevice(['mediaTrackControl']))).toBe(true);
    });
  });

  describe('deviceSupportsTvChannel', () => {
    it('returns true for tvChannel', () => {
      expect(deviceSupportsTvChannel(makeDevice(['tvChannel']))).toBe(true);
    });
  });

  describe('deviceSupportsWindowShade', () => {
    it('returns true for windowShade', () => {
      expect(deviceSupportsWindowShade(makeDevice(['windowShade']))).toBe(true);
    });
    it('is not triggered by windowShadeLevel alone', () => {
      expect(deviceSupportsWindowShade(makeDevice(['windowShadeLevel']))).toBe(false);
    });
  });

  describe('deviceSupportsValve', () => {
    it('returns true for valve', () => {
      expect(deviceSupportsValve(makeDevice(['valve']))).toBe(true);
    });
  });

  describe('deviceSupportsAlarm', () => {
    it('returns true for alarm', () => {
      expect(deviceSupportsAlarm(makeDevice(['alarm']))).toBe(true);
    });
  });

  describe('deviceSupportsThermostatMode', () => {
    it('returns true for thermostatMode', () => {
      expect(deviceSupportsThermostatMode(makeDevice(['thermostatMode']))).toBe(true);
    });
    it('returns true for the mega thermostat capability', () => {
      expect(deviceSupportsThermostatMode(makeDevice(['thermostat']))).toBe(true);
    });
    it('returns false when absent', () => {
      expect(deviceSupportsThermostatMode(makeDevice(['switch']))).toBe(false);
    });
  });

  describe('deviceSupportsThermostatHeatingSetpoint', () => {
    it('returns true for thermostatHeatingSetpoint', () => {
      expect(deviceSupportsThermostatHeatingSetpoint(makeDevice(['thermostatHeatingSetpoint']))).toBe(true);
    });
    it('returns true for the mega thermostat capability', () => {
      expect(deviceSupportsThermostatHeatingSetpoint(makeDevice(['thermostat']))).toBe(true);
    });
    it('returns false for thermostatCoolingSetpoint alone', () => {
      expect(deviceSupportsThermostatHeatingSetpoint(makeDevice(['thermostatCoolingSetpoint']))).toBe(false);
    });
  });

  describe('deviceSupportsThermostatCoolingSetpoint', () => {
    it('returns true for thermostatCoolingSetpoint', () => {
      expect(deviceSupportsThermostatCoolingSetpoint(makeDevice(['thermostatCoolingSetpoint']))).toBe(true);
    });
    it('returns true for the mega thermostat capability', () => {
      expect(deviceSupportsThermostatCoolingSetpoint(makeDevice(['thermostat']))).toBe(true);
    });
    it('returns false for thermostatHeatingSetpoint alone', () => {
      expect(deviceSupportsThermostatCoolingSetpoint(makeDevice(['thermostatHeatingSetpoint']))).toBe(false);
    });
  });

  describe('deviceSupportsFanSpeed', () => {
    it('returns true for fanSpeed', () => {
      expect(deviceSupportsFanSpeed(makeDevice(['fanSpeed']))).toBe(true);
    });
  });

  describe('deviceSupportsColorTemperature', () => {
    it('returns true for colorTemperature', () => {
      expect(deviceSupportsColorTemperature(makeDevice(['colorTemperature']))).toBe(true);
    });
  });

  describe('deviceSupportsMomentary', () => {
    it('returns true for momentary', () => {
      expect(deviceSupportsMomentary(makeDevice(['momentary']))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// deviceTypeDisplayName
// ---------------------------------------------------------------------------

describe('deviceTypeDisplayName', () => {
  it('prefers manufacturer category over other categories', () => {
    const d = makeDevice([], {
      components: [{
        id: 'main',
        capabilities: [],
        categories: [
          { name: 'Switch', categoryType: 'user' },
          { name: 'SmartPlug', categoryType: 'manufacturer' },
        ],
      }],
    } as unknown as Partial<Device>);
    expect(deviceTypeDisplayName(d)).toBe('SmartPlug');
  });

  it('falls back to first category when no manufacturer category', () => {
    const d = makeDevice([], {
      components: [{
        id: 'main',
        capabilities: [],
        categories: [{ name: 'Light', categoryType: 'user' }],
      }],
    } as unknown as Partial<Device>);
    expect(deviceTypeDisplayName(d)).toBe('Light');
  });

  it('falls back to DTH deviceTypeName when no categories', () => {
    const d = { deviceId: 'x', components: [], dth: { deviceTypeName: 'Z-Wave Switch' } } as unknown as Device;
    expect(deviceTypeDisplayName(d)).toBe('Z-Wave Switch');
  });

  it('falls back to formatted integration type', () => {
    const d = { deviceId: 'x', components: [], type: 'LAN' } as unknown as Device;
    expect(deviceTypeDisplayName(d)).toBe('Lan');
  });

  it('returns Unknown when nothing is available', () => {
    const d = { deviceId: 'x', components: [] } as unknown as Device;
    expect(deviceTypeDisplayName(d)).toBe('Unknown');
  });

  it('uses the main component, not a secondary component', () => {
    const d = makeMultiComponentDevice({ other: [] });
    (d as any).components[0].categories = [{ name: 'OtherType', categoryType: 'user' }];
    (d as any).components.unshift({ id: 'main', capabilities: [], categories: [{ name: 'MainType', categoryType: 'user' }] });
    expect(deviceTypeDisplayName(d)).toBe('MainType');
  });
});

// ---------------------------------------------------------------------------
// deviceProtocolDisplayName
// ---------------------------------------------------------------------------

describe('deviceProtocolDisplayName', () => {
  it('formats ZIGBEE as Zigbee', () => {
    const d = { type: 'ZIGBEE', components: [] } as unknown as Device;
    expect(deviceProtocolDisplayName(d)).toBe('Zigbee');
  });

  it('formats Z_WAVE as Z Wave', () => {
    const d = { type: 'Z_WAVE', components: [] } as unknown as Device;
    expect(deviceProtocolDisplayName(d)).toBe('Z Wave');
  });

  it('returns Unknown when type is absent', () => {
    const d = { components: [] } as unknown as Device;
    expect(deviceProtocolDisplayName(d)).toBe('Unknown');
  });
});

// ---------------------------------------------------------------------------
// normalizeDevices
// ---------------------------------------------------------------------------

describe('normalizeDevices', () => {
  it('returns an empty array for empty input', () => {
    expect(normalizeDevices([])).toEqual([]);
  });

  it('maps deviceId correctly', () => {
    const d = makeDevice([], { deviceId: 'abc-123' } as Partial<Device>);
    expect(normalizeDevices([d])[0].deviceId).toBe('abc-123');
  });

  it('prefers label over name for deviceName', () => {
    const d = makeDevice([], { label: 'My Light', name: 'Hue Bulb' } as Partial<Device>);
    expect(normalizeDevices([d])[0].deviceName).toBe('My Light');
  });

  it('falls back to name when label is absent', () => {
    const d = { ...makeDevice([]), label: undefined, name: 'Hue Bulb' } as unknown as Device;
    expect(normalizeDevices([d])[0].deviceName).toBe('Hue Bulb');
  });

  it('falls back to "Device" when both label and name are absent', () => {
    const d = { ...makeDevice([]), label: undefined, name: undefined } as unknown as Device;
    expect(normalizeDevices([d])[0].deviceName).toBe('Device');
  });

  it('truncates deviceName to 64 characters', () => {
    const longName = 'A'.repeat(100);
    const d = makeDevice([], { label: longName } as Partial<Device>);
    expect(normalizeDevices([d])[0].deviceName).toHaveLength(64);
  });

  it('falls back empty deviceId to empty string', () => {
    const d = { ...makeDevice([]), deviceId: undefined } as unknown as Device;
    expect(normalizeDevices([d])[0].deviceId).toBe('');
  });

  describe('capability flags', () => {
    it('sets supportsSwitch for switch capability', () => {
      expect(normalizeDevices([makeDevice(['switch'])])[0].supportsSwitch).toBe(true);
    });
    it('sets supportsDimmer for switchLevel capability', () => {
      expect(normalizeDevices([makeDevice(['switchLevel'])])[0].supportsDimmer).toBe(true);
    });
    it('sets supportsGarageDoor for garageDoorControl', () => {
      expect(normalizeDevices([makeDevice(['garageDoorControl'])])[0].supportsGarageDoor).toBe(true);
    });
    it('sets supportsGarageDoor for doorControl', () => {
      expect(normalizeDevices([makeDevice(['doorControl'])])[0].supportsGarageDoor).toBe(true);
    });
    it('sets supportsLock for lock', () => {
      expect(normalizeDevices([makeDevice(['lock'])])[0].supportsLock).toBe(true);
    });
    it('sets supportsMediaPlayback for mediaPlayback', () => {
      expect(normalizeDevices([makeDevice(['mediaPlayback'])])[0].supportsMediaPlayback).toBe(true);
    });
    it('sets supportsAudioVolume for audioVolume', () => {
      expect(normalizeDevices([makeDevice(['audioVolume'])])[0].supportsAudioVolume).toBe(true);
    });
    it('sets supportsAudioMute for audioMute', () => {
      expect(normalizeDevices([makeDevice(['audioMute'])])[0].supportsAudioMute).toBe(true);
    });
    it('sets supportsMediaTrackControl for mediaTrackControl', () => {
      expect(normalizeDevices([makeDevice(['mediaTrackControl'])])[0].supportsMediaTrackControl).toBe(true);
    });
    it('sets supportsTvChannel for tvChannel', () => {
      expect(normalizeDevices([makeDevice(['tvChannel'])])[0].supportsTvChannel).toBe(true);
    });
    it('sets supportsWindowShade for windowShade', () => {
      expect(normalizeDevices([makeDevice(['windowShade'])])[0].supportsWindowShade).toBe(true);
    });
    it('sets supportsValve for valve', () => {
      expect(normalizeDevices([makeDevice(['valve'])])[0].supportsValve).toBe(true);
    });
    it('sets supportsAlarm for alarm', () => {
      expect(normalizeDevices([makeDevice(['alarm'])])[0].supportsAlarm).toBe(true);
    });
    it('sets supportsThermostatMode for thermostatMode', () => {
      expect(normalizeDevices([makeDevice(['thermostatMode'])])[0].supportsThermostatMode).toBe(true);
    });
    it('sets all thermostat flags for the mega thermostat capability', () => {
      const entry = normalizeDevices([makeDevice(['thermostat'])])[0];
      expect(entry.supportsThermostatMode).toBe(true);
      expect(entry.supportsThermostatHeatingSetpoint).toBe(true);
      expect(entry.supportsThermostatCoolingSetpoint).toBe(true);
    });
    it('sets supportsThermostatHeatingSetpoint for thermostatHeatingSetpoint', () => {
      expect(normalizeDevices([makeDevice(['thermostatHeatingSetpoint'])])[0].supportsThermostatHeatingSetpoint).toBe(true);
    });
    it('sets supportsThermostatCoolingSetpoint for thermostatCoolingSetpoint', () => {
      expect(normalizeDevices([makeDevice(['thermostatCoolingSetpoint'])])[0].supportsThermostatCoolingSetpoint).toBe(true);
    });
    it('sets supportsFanSpeed for fanSpeed', () => {
      expect(normalizeDevices([makeDevice(['fanSpeed'])])[0].supportsFanSpeed).toBe(true);
    });
    it('sets supportsColorTemperature for colorTemperature', () => {
      expect(normalizeDevices([makeDevice(['colorTemperature'])])[0].supportsColorTemperature).toBe(true);
    });
    it('sets supportsMomentary for momentary', () => {
      expect(normalizeDevices([makeDevice(['momentary'])])[0].supportsMomentary).toBe(true);
    });

    it('all flags are false for a device with no capabilities', () => {
      const entry = normalizeDevices([makeDevice([])])[0];
      expect(entry.supportsSwitch).toBe(false);
      expect(entry.supportsDimmer).toBe(false);
      expect(entry.supportsGarageDoor).toBe(false);
      expect(entry.supportsLock).toBe(false);
      expect(entry.supportsMediaPlayback).toBe(false);
      expect(entry.supportsAudioVolume).toBe(false);
      expect(entry.supportsAudioMute).toBe(false);
      expect(entry.supportsMediaTrackControl).toBe(false);
      expect(entry.supportsTvChannel).toBe(false);
      expect(entry.supportsWindowShade).toBe(false);
      expect(entry.supportsValve).toBe(false);
      expect(entry.supportsAlarm).toBe(false);
      expect(entry.supportsThermostatMode).toBe(false);
      expect(entry.supportsThermostatHeatingSetpoint).toBe(false);
      expect(entry.supportsThermostatCoolingSetpoint).toBe(false);
      expect(entry.supportsFanSpeed).toBe(false);
      expect(entry.supportsColorTemperature).toBe(false);
      expect(entry.supportsMomentary).toBe(false);
    });

    it('sets multiple flags for a device with multiple capabilities', () => {
      const entry = normalizeDevices([makeDevice(['switch', 'switchLevel', 'colorTemperature'])])[0];
      expect(entry.supportsSwitch).toBe(true);
      expect(entry.supportsDimmer).toBe(true);
      expect(entry.supportsColorTemperature).toBe(true);
      expect(entry.supportsLock).toBe(false);
    });

    it('detects capabilities on non-main components', () => {
      const d = makeMultiComponentDevice({ secondary: ['lock'] });
      expect(normalizeDevices([d])[0].supportsLock).toBe(true);
    });

    it('detects capabilities spread across multiple components', () => {
      const d = makeMultiComponentDevice({ main: ['switch'], extra: ['audioVolume'] });
      const entry = normalizeDevices([d])[0];
      expect(entry.supportsSwitch).toBe(true);
      expect(entry.supportsAudioVolume).toBe(true);
    });
  });

  it('normalizes multiple devices independently', () => {
    const devices = [makeDevice(['switch']), makeDevice(['lock'])];
    const entries = normalizeDevices(devices);
    expect(entries).toHaveLength(2);
    expect(entries[0].supportsSwitch).toBe(true);
    expect(entries[0].supportsLock).toBe(false);
    expect(entries[1].supportsSwitch).toBe(false);
    expect(entries[1].supportsLock).toBe(true);
  });
});
