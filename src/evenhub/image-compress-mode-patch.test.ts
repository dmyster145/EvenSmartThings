import { describe, it, expect } from 'vitest';
import { ImageRawDataUpdate } from '@evenrealities/even_hub_sdk';
import { EvenHubBridge } from './bridge';

// @regression — locks the workaround for the SDK 0.0.12 image bug. 0.0.12's
// static ImageRawDataUpdate.toJson() stamps compressMode:2 (LZ4) onto payloads
// while the bundle ships no LZ4 code, so the host rejects every image with
// sendFailed and nothing renders. EvenHubBridge.init() wraps toJson to strip the
// field, restoring the pre-0.0.12 wire shape. If the "bug still present" check
// below ever fails, the SDK has been fixed → delete patchImageCompressModeBug()
// (and this suffix of the test).

function sampleImage() {
  return { containerID: 3, containerName: 'board', imageData: [0x42, 0x4d, 0x01, 0x02] };
}

describe('@regression SDK 0.0.12 image compressMode workaround', () => {
  it('the pinned SDK still emits the mislabeled compressMode:2 (remove patch when this fails)', () => {
    // Reading toJson before any init() runs the patch: this is the raw SDK shape.
    const raw = ImageRawDataUpdate.toJson(sampleImage());
    expect(raw.compressMode).toBe(2);
  });

  it('init() strips compressMode so the payload matches the pre-0.0.12 wire shape', async () => {
    // No Even App bridge in the test env → init races its timeout to bridge=null,
    // but patchImageCompressModeBug() runs first (top of init), which is all we need.
    await new EvenHubBridge().init(1);

    const patched = ImageRawDataUpdate.toJson(sampleImage());
    expect('compressMode' in patched).toBe(false);
    // The real image fields must survive untouched.
    expect(patched.containerID).toBe(3);
    expect(patched.containerName).toBe('board');
    expect(patched.imageData).toBeDefined();
  });

  it('is idempotent across repeated init() calls', async () => {
    await new EvenHubBridge().init(1);
    await new EvenHubBridge().init(1);
    const patched = ImageRawDataUpdate.toJson(sampleImage());
    expect('compressMode' in patched).toBe(false);
    expect(patched.imageData).toBeDefined();
  });
});
