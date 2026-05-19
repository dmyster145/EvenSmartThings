import { describe, it, expect, vi } from 'vitest';
import {
  createVoiceConfigController,
  type VoiceConfigDeps,
} from './config-lifecycle';
import { defaultVoiceConfig, serializeVoiceConfig } from './config';

// E2E — the offline-first hydrate → remote refresh → persist controller with
// fully in-memory deps (no bridge/network). Mirrors resume-scheduler e2e.
function makeDeps(over: Partial<VoiceConfigDeps> = {}): {
  deps: VoiceConfigDeps;
  store: { value: string };
  log: ReturnType<typeof vi.fn>;
  onApply: ReturnType<typeof vi.fn>;
} {
  const store = { value: '' };
  const log = vi.fn();
  const onApply = vi.fn();
  const deps: VoiceConfigDeps = {
    readStored: async () => store.value,
    writeStored: async (s) => {
      store.value = s;
      return true;
    },
    fetchRemote: async () => {
      throw new Error('no remote');
    },
    log,
    onApply,
    ...over,
  };
  return { deps, store, log, onApply };
}

const customCfg = { ...defaultVoiceConfig, onWords: ['engage'] };

describe('voice config lifecycle', () => {
  it('starts on the bundled default synchronously (offline-safe)', () => {
    const { deps } = makeDeps();
    const c = createVoiceConfigController(deps);
    expect(c.current().provenance).toBe('bundled');
    expect(c.current().config).toEqual(defaultVoiceConfig);
  });

  it('hydrate() applies a valid on-device cache', async () => {
    const { deps, onApply } = makeDeps({ readStored: async () => serializeVoiceConfig(customCfg) });
    const c = createVoiceConfigController(deps);
    await c.hydrate();
    expect(c.current().provenance).toBe('cache');
    expect(c.current().config.onWords).toEqual(['engage']);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('hydrate() with no/invalid cache stays bundled', async () => {
    const { deps, onApply } = makeDeps({ readStored: async () => '' });
    const c = createVoiceConfigController(deps);
    await c.hydrate();
    expect(c.current().provenance).toBe('bundled');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('refresh() applies + persists a valid remote config', async () => {
    const { deps, store } = makeDeps({
      fetchRemote: async () => ({ ...customCfg, v: 1 }),
    });
    const c = createVoiceConfigController(deps);
    await c.refresh();
    await Promise.resolve(); // let the persist .then settle
    expect(c.current().provenance).toBe('remote@1');
    expect(c.current().config.onWords).toEqual(['engage']);
    expect(store.value).not.toBe(''); // persisted to bridge storage
  });

  it('refresh() with an invalid/old remote keeps last-good', async () => {
    const { deps, log, onApply } = makeDeps({
      fetchRemote: async () => ({ v: 999, onWords: ['nope'] }),
    });
    const c = createVoiceConfigController(deps);
    await c.refresh();
    expect(c.current().provenance).toBe('bundled');
    expect(onApply).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('invalid/old'));
  });

  it('refresh() that throws is swallowed (offline)', async () => {
    const { deps, log, onApply } = makeDeps({
      fetchRemote: async () => {
        throw new Error('network down');
      },
    });
    const c = createVoiceConfigController(deps);
    await c.refresh();
    expect(c.current().provenance).toBe('bundled');
    expect(onApply).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('offline ok'));
  });

  it('a late hydrate() never downgrades an already-applied remote config', async () => {
    const { deps } = makeDeps({
      readStored: async () => serializeVoiceConfig(defaultVoiceConfig),
      fetchRemote: async () => ({ ...customCfg, v: 1 }),
    });
    const c = createVoiceConfigController(deps);
    await c.refresh(); // remote wins first
    await Promise.resolve();
    expect(c.current().provenance).toBe('remote@1');
    await c.hydrate(); // must NOT clobber remote with cache
    expect(c.current().provenance).toBe('remote@1');
    expect(c.current().config.onWords).toEqual(['engage']);
  });
});
