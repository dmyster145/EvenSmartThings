/**
 * Device normalization — converts raw SmartThings SDK Device objects into
 * lightweight DeviceEntry records with pre-computed capability flags.
 * Kept as a pure module so it can be unit-tested without pulling in app.ts.
 */

import type { Device } from '@smartthings/core-sdk';
import type { DeviceEntry } from '../state/contracts';
import { SCENE_NAME_MAX_LEN } from '../state/constants';

/** Returns true if the device exposes at least one of the given capability IDs on any component. */
export function hasCapability(d: Device, ...ids: string[]): boolean {
  return (d.components ?? []).some((c) =>
    (c.capabilities ?? []).some((cap) => ids.includes(cap.id))
  );
}

export function deviceSupportsSwitch(d: Device): boolean { return hasCapability(d, 'switch'); }
export function deviceSupportsDimmer(d: Device): boolean { return hasCapability(d, 'switchLevel'); }
export function deviceSupportsGarageDoor(d: Device): boolean { return hasCapability(d, 'garageDoorControl', 'doorControl'); }
export function deviceSupportsLock(d: Device): boolean { return hasCapability(d, 'lock'); }
export function deviceSupportsMediaPlayback(d: Device): boolean { return hasCapability(d, 'mediaPlayback'); }
export function deviceSupportsAudioVolume(d: Device): boolean { return hasCapability(d, 'audioVolume'); }
export function deviceSupportsAudioMute(d: Device): boolean { return hasCapability(d, 'audioMute'); }
export function deviceSupportsMediaTrackControl(d: Device): boolean { return hasCapability(d, 'mediaTrackControl'); }
export function deviceSupportsTvChannel(d: Device): boolean { return hasCapability(d, 'tvChannel'); }
export function deviceSupportsWindowShade(d: Device): boolean { return hasCapability(d, 'windowShade'); }
export function deviceSupportsValve(d: Device): boolean { return hasCapability(d, 'valve'); }
export function deviceSupportsAlarm(d: Device): boolean { return hasCapability(d, 'alarm'); }
/** thermostatMode OR the mega thermostat capability */
export function deviceSupportsThermostatMode(d: Device): boolean { return hasCapability(d, 'thermostatMode', 'thermostat'); }
/** thermostatHeatingSetpoint OR the mega thermostat capability */
export function deviceSupportsThermostatHeatingSetpoint(d: Device): boolean { return hasCapability(d, 'thermostatHeatingSetpoint', 'thermostat'); }
/** thermostatCoolingSetpoint OR the mega thermostat capability */
export function deviceSupportsThermostatCoolingSetpoint(d: Device): boolean { return hasCapability(d, 'thermostatCoolingSetpoint', 'thermostat'); }
export function deviceSupportsFanSpeed(d: Device): boolean { return hasCapability(d, 'fanSpeed'); }
export function deviceSupportsColorTemperature(d: Device): boolean { return hasCapability(d, 'colorTemperature'); }
export function deviceSupportsColorControl(d: Device): boolean { return hasCapability(d, 'colorControl'); }
export function deviceSupportsMomentary(d: Device): boolean { return hasCapability(d, 'momentary'); }

/**
 * Human-readable device type: prefers manufacturer category → first category
 * → DTH deviceTypeName → integration type string.
 */
export function deviceTypeDisplayName(d: Device): string {
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
export function deviceProtocolDisplayName(d: Device): string {
  const integrationType = d.type ?? '';
  const formatted = String(integrationType)
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return formatted || 'Unknown';
}

/** Converts raw SDK Device list into lightweight DeviceEntry records. */
export function normalizeDevices(devices: Device[]): DeviceEntry[] {
  return devices.map((d) => ({
    deviceId: d.deviceId ?? '',
    deviceName: (d.label ?? d.name ?? 'Device').slice(0, SCENE_NAME_MAX_LEN),
    deviceType: deviceTypeDisplayName(d),
    deviceProtocol: deviceProtocolDisplayName(d),
    supportsSwitch: deviceSupportsSwitch(d),
    supportsDimmer: deviceSupportsDimmer(d),
    supportsGarageDoor: deviceSupportsGarageDoor(d),
    supportsLock: deviceSupportsLock(d),
    supportsMediaPlayback: deviceSupportsMediaPlayback(d),
    supportsAudioVolume: deviceSupportsAudioVolume(d),
    supportsAudioMute: deviceSupportsAudioMute(d),
    supportsMediaTrackControl: deviceSupportsMediaTrackControl(d),
    supportsTvChannel: deviceSupportsTvChannel(d),
    supportsWindowShade: deviceSupportsWindowShade(d),
    supportsValve: deviceSupportsValve(d),
    supportsAlarm: deviceSupportsAlarm(d),
    supportsThermostatMode: deviceSupportsThermostatMode(d),
    supportsThermostatHeatingSetpoint: deviceSupportsThermostatHeatingSetpoint(d),
    supportsThermostatCoolingSetpoint: deviceSupportsThermostatCoolingSetpoint(d),
    supportsFanSpeed: deviceSupportsFanSpeed(d),
    supportsColorTemperature: deviceSupportsColorTemperature(d),
    supportsColorControl: deviceSupportsColorControl(d),
    supportsMomentary: deviceSupportsMomentary(d),
  }));
}
