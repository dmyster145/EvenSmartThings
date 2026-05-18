import { describe, it, expect } from 'vitest';
import {
  payloadToInt16,
  payloadToFloat32,
  int16ToFloat32,
  meanAbsAmplitude,
  VOICE_SAMPLE_RATE,
} from './pcm';

// @regression — the SDK delivers `audioEvent.audioPcm` as Uint8Array OR
// number[] OR base64 string (host JSON bridging); all are 16 kHz mono LE int16.
// pcm.ts must normalize every shape identically or recognition silently breaks.
describe('@regression voice pcm normalization', () => {
  // Two LE int16 samples: -32768 (0x0000... actually 0x8000) and 32767 (0x7FFF).
  const bytes = [0x00, 0x80, 0xff, 0x7f]; // [-32768, 32767]
  const u8 = new Uint8Array(bytes);
  const b64 = Buffer.from(u8).toString('base64');

  it('fixed sample rate is 16 kHz', () => {
    expect(VOICE_SAMPLE_RATE).toBe(16000);
  });

  it('decodes little-endian int16 from a Uint8Array', () => {
    const i16 = payloadToInt16(u8);
    expect(Array.from(i16)).toEqual([-32768, 32767]);
  });

  it('number[] and base64 decode identically to Uint8Array', () => {
    const fromArr = Array.from(payloadToInt16(bytes));
    const fromB64 = Array.from(payloadToInt16(b64));
    expect(fromArr).toEqual([-32768, 32767]);
    expect(fromB64).toEqual([-32768, 32767]);
  });

  it('odd byte length is truncated to whole samples (no crash)', () => {
    const i16 = payloadToInt16([0x00, 0x80, 0xff]); // 3 bytes ⇒ 1 sample
    expect(i16.length).toBe(1);
    expect(i16[0]).toBe(-32768);
  });

  it('int16 → float32 maps to [-1, 1]', () => {
    const f = int16ToFloat32(Int16Array.from([-32768, 32767, 0]));
    expect(f[0]).toBeCloseTo(-1, 5);
    expect(f[1]).toBeCloseTo(1, 5);
    expect(f[2]).toBe(0);
  });

  it('payloadToFloat32 round-trips a base64 payload', () => {
    const f = payloadToFloat32(b64);
    expect(f[0]).toBeCloseTo(-1, 5);
    expect(f[1]).toBeCloseTo(1, 5);
  });

  it('meanAbsAmplitude is 0 for silence and ~1 for full-scale', () => {
    expect(meanAbsAmplitude(new Float32Array(0))).toBe(0);
    expect(meanAbsAmplitude(Float32Array.from([0, 0, 0]))).toBe(0);
    expect(meanAbsAmplitude(Float32Array.from([1, -1, 1]))).toBeCloseTo(1, 5);
  });

  it('garbage payloads degrade to empty (never throw)', () => {
    expect(payloadToInt16({} as unknown as number[]).length).toBe(0);
    expect(payloadToFloat32('' ).length).toBe(0);
  });
});
