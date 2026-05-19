import { describe, it, expect } from 'vitest';
import {
  VOICE_CONFIG_KEY,
  defaultVoiceConfig,
  serializeVoiceConfig,
  parseVoiceConfig,
} from './config';
import { VOICE_CONFIG_PAYLOAD } from '../../server/voice-config.js';

// Unit + @regression — voice config defensive parse (mirrors list-cache).
// A bad/stale/oversized blob must degrade per-field to the bundled default
// (never partial, never able to brick the offline recognizer).
describe('voice config parse', () => {
  it('round-trips the bundled default', () => {
    expect(parseVoiceConfig(serializeVoiceConfig(defaultVoiceConfig))).toEqual(defaultVoiceConfig);
  });

  it('uses a stable bridge-storage key', () => {
    expect(VOICE_CONFIG_KEY).toBe('smartthings_controls_voice_config');
  });

  it('returns null on hard failures (caller keeps last-good)', () => {
    expect(parseVoiceConfig(null)).toBeNull();
    expect(parseVoiceConfig(undefined)).toBeNull();
    expect(parseVoiceConfig('')).toBeNull();
    expect(parseVoiceConfig('{not json')).toBeNull();
    expect(parseVoiceConfig('42')).toBeNull();
    expect(parseVoiceConfig('"a string"')).toBeNull();
  });

  it('@regression returns null on schema-version mismatch (stale build)', () => {
    const stale = JSON.stringify({ ...VOICE_CONFIG_PAYLOAD, v: 999 });
    expect(parseVoiceConfig(stale)).toBeNull();
  });

  it('replaces a single bad field with the bundled default, keeps the rest', () => {
    const blob = JSON.stringify({
      ...VOICE_CONFIG_PAYLOAD,
      onWords: 'nope', // not an array
      offWords: ['x'.repeat(40)], // word too long
      sceneWords: new Array(100).fill('a'), // list too long
      onesWords: 'bad',
    });
    const cfg = parseVoiceConfig(blob)!;
    expect(cfg).not.toBeNull();
    expect(cfg.onWords).toEqual(defaultVoiceConfig.onWords);
    expect(cfg.offWords).toEqual(defaultVoiceConfig.offWords);
    expect(cfg.sceneWords).toEqual(defaultVoiceConfig.sceneWords);
    expect(cfg.onesWords).toEqual(defaultVoiceConfig.onesWords);
    // A good field on the same blob is still taken from the blob.
    expect(cfg.roomWords).toEqual(VOICE_CONFIG_PAYLOAD.roomWords);
  });

  it('clamps out-of-range tunables instead of bricking', () => {
    const cfg = parseVoiceConfig(
      JSON.stringify({ ...VOICE_CONFIG_PAYLOAD, matchMin: 99, silenceMs: -5, maxListenMs: 1 }),
    )!;
    expect(cfg.matchMin).toBe(1);
    expect(cfg.silenceMs).toBe(200);
    expect(cfg.maxListenMs).toBe(2000);
  });

  it('lowercases/trims words from a remote blob', () => {
    const cfg = parseVoiceConfig(
      JSON.stringify({ ...VOICE_CONFIG_PAYLOAD, onWords: [' ON ', 'Enable'] }),
    )!;
    expect(cfg.onWords).toEqual(['on', 'enable']);
  });

  it('@regression server payload === bundled default (drift guard)', () => {
    // The shipped static config and the offline-fallback must never diverge.
    expect(parseVoiceConfig(JSON.stringify(VOICE_CONFIG_PAYLOAD))).toEqual(defaultVoiceConfig);
  });
});
