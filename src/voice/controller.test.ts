import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RecognizerCallbacks } from './recognizer';

// Mock the vosk-browser-backed recognizer so the controller state machine can
// be tested in node without loading the WASM model.
const h = vi.hoisted(() => {
  const fakeRec = { accept: vi.fn(), finalize: vi.fn(), dispose: vi.fn() };
  return {
    fakeRec,
    lastCb: { current: null as RecognizerCallbacks | null },
    createRecognizer: vi.fn(async (_url: string, cb: RecognizerCallbacks) => {
      h.lastCb.current = cb;
      return fakeRec;
    }),
  };
});

vi.mock('./recognizer', () => ({
  createRecognizer: h.createRecognizer,
  preloadVoiceModel: vi.fn(),
}));

import { createVoiceController, type VoiceControllerDeps } from './controller';

/** Loud full-scale int16 little-endian bytes ⇒ amplitude ≈ 1 (speech). */
const LOUD = Array.from({ length: 64 }, (_, i) => (i % 2 === 0 ? 0xff : 0x7f));

function makeDeps(overrides: Partial<VoiceControllerDeps> = {}): {
  deps: VoiceControllerDeps;
  audioControl: ReturnType<typeof vi.fn>;
  onListenStart: ReturnType<typeof vi.fn>;
  onListenEnd: ReturnType<typeof vi.fn>;
  onStatus: ReturnType<typeof vi.fn>;
  onTranscript: ReturnType<typeof vi.fn>;
} {
  const audioControl = vi.fn(async () => true);
  const onListenStart = vi.fn();
  const onListenEnd = vi.fn();
  const onStatus = vi.fn();
  const onTranscript = vi.fn();
  const deps: VoiceControllerDeps = {
    bridge: { audioControl },
    modelUrl: '/vosk/model.tar.gz',
    isEligible: () => true,
    onListenStart,
    onListenEnd,
    onStatus,
    onTranscript,
    ...overrides,
  };
  return { deps, audioControl, onListenStart, onListenEnd, onStatus, onTranscript };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('voice controller state machine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.createRecognizer.mockClear();
    h.fakeRec.accept.mockClear();
    h.fakeRec.finalize.mockClear();
    h.fakeRec.dispose.mockClear();
    h.lastCb.current = null;
    h.createRecognizer.mockImplementation(async (_url: string, cb: RecognizerCallbacks) => {
      h.lastCb.current = cb;
      return h.fakeRec;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('start() is a no-op until the model is warmed (returns false)', async () => {
    const { deps, audioControl } = makeDeps();
    const c = createVoiceController(deps);
    expect(c.start()).toBe(false);
    expect(audioControl).not.toHaveBeenCalled();
  });

  it('start() returns false when not eligible even after warm', async () => {
    const { deps, audioControl } = makeDeps({ isEligible: () => false });
    const c = createVoiceController(deps);
    c.warm();
    await flush();
    expect(c.start()).toBe(false);
    expect(audioControl).not.toHaveBeenCalled();
  });

  it('warm → start opens the mic and announces listening', async () => {
    const { deps, audioControl, onListenStart } = makeDeps();
    const c = createVoiceController(deps);
    c.warm();
    await flush();
    expect(c.start()).toBe(true);
    await flush();
    expect(audioControl).toHaveBeenCalledWith(true);
    expect(onListenStart).toHaveBeenCalledOnce();
    expect(c.isListening()).toBe(true);
  });

  it('speech then silence finalizes and delivers the transcript, mic closed', async () => {
    const { deps, audioControl, onTranscript, onListenEnd } = makeDeps();
    const c = createVoiceController(deps);
    c.warm();
    await flush();
    c.start();
    await flush();

    c.feed(LOUD); // heardSpeech = true
    expect(h.fakeRec.accept).toHaveBeenCalled();

    // Past MIN_LISTEN and SILENCE (1600 ms) windows → endpoint poll finalizes.
    await vi.advanceTimersByTimeAsync(1900);
    expect(h.fakeRec.finalize).toHaveBeenCalled();

    // Recognizer delivers the final text.
    h.lastCb.current!.onFinal('movie night');
    expect(onTranscript).toHaveBeenCalledWith('movie night');
    expect(audioControl).toHaveBeenLastCalledWith(false);
    expect(onListenEnd).toHaveBeenCalled();
    expect(c.isListening()).toBe(false);
  });

  it('cancel() closes the mic and clears status', async () => {
    const { deps, audioControl, onListenEnd, onStatus } = makeDeps();
    const c = createVoiceController(deps);
    c.warm();
    await flush();
    c.start();
    await flush();
    expect(c.isListening()).toBe(true);

    c.cancel();
    expect(audioControl).toHaveBeenLastCalledWith(false);
    expect(onListenEnd).toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith('');
    expect(c.isListening()).toBe(false);
  });

  it('a "didn’t catch that" timeout fires if no result arrives', async () => {
    const { deps, onStatus } = makeDeps();
    const c = createVoiceController(deps);
    c.warm();
    await flush();
    c.start();
    await flush();
    c.feed(LOUD);
    await vi.advanceTimersByTimeAsync(1500); // finalize
    await vi.advanceTimersByTimeAsync(2500); // RESULT_TIMEOUT elapsed, no onFinal
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('Didn’t catch that'));
    expect(c.isListening()).toBe(false);
  });

  it('dispose() is idempotent and tears down the recognizer', async () => {
    const { deps } = makeDeps();
    const c = createVoiceController(deps);
    c.warm();
    await flush();
    c.dispose();
    c.dispose();
    expect(h.fakeRec.dispose).toHaveBeenCalledTimes(1);
  });

  it('model load failure degrades gracefully (start stays false)', async () => {
    h.createRecognizer.mockRejectedValueOnce(new Error('wasm boom'));
    const { deps, onStatus } = makeDeps();
    const c = createVoiceController(deps);
    c.warm();
    await flush();
    expect(c.start()).toBe(false);
    expect(onStatus).toHaveBeenCalledWith('Voice model unavailable');
  });

  it('feed is ignored when not listening', async () => {
    const { deps } = makeDeps();
    const c = createVoiceController(deps);
    c.warm();
    await flush();
    c.feed(LOUD);
    expect(h.fakeRec.accept).not.toHaveBeenCalled();
  });
});
