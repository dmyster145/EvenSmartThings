/**
 * Voice-config lifecycle — offline-first hydrate → remote refresh → persist.
 *
 * Pure and dependency-injected (no DOM/SDK/fetch directly) so the wiring is
 * unit/E2E-testable, mirroring src/lifecycle/resume-scheduler.ts. The bundled
 * `defaultGrammar` is active synchronously from construction, so voice works
 * before any I/O and with zero network. Order in app.ts: construct → hydrate()
 * (cached) → refresh() (best-effort remote). Neither blocks startup or voice;
 * neither ever throws.
 */

import {
  type VoiceConfig,
  defaultVoiceConfig,
  parseVoiceConfig,
  serializeVoiceConfig,
} from './config';
import { type Grammar, createGrammar, defaultGrammar } from './grammar';

export interface VoiceConfigDeps {
  /** Bridge persistent storage read ('' if absent — survives WebView wipe). */
  readStored(): Promise<string>;
  /** Bridge persistent storage write (best-effort). */
  writeStored(serialized: string): Promise<boolean>;
  /** Public backend GET — raw JSON, validated here. */
  fetchRemote(): Promise<unknown>;
  /** Copyable debug-log line. */
  log(message: string): void;
  /** Called when the active config changes (swap the live grammar holder). */
  onApply(config: VoiceConfig, grammar: Grammar, provenance: string): void;
}

export interface VoiceConfigController {
  current(): { config: VoiceConfig; grammar: Grammar; provenance: string };
  /** Apply the on-device cached config if present + valid (else stay bundled). */
  hydrate(): Promise<void>;
  /** Best-effort: fetch the latest config, validate, apply + persist. */
  refresh(): Promise<void>;
}

export function createVoiceConfigController(deps: VoiceConfigDeps): VoiceConfigController {
  let config: VoiceConfig = defaultVoiceConfig;
  let grammar: Grammar = defaultGrammar;
  let provenance = 'bundled';
  let persisted = false;

  function apply(cfg: VoiceConfig, prov: string): void {
    config = cfg;
    grammar = createGrammar(cfg);
    provenance = prov;
    deps.onApply(config, grammar, provenance);
  }

  async function hydrate(): Promise<void> {
    try {
      // If a remote refresh already won the race, don't downgrade to cache.
      if (provenance.startsWith('remote')) return;
      const cfg = parseVoiceConfig(await deps.readStored());
      if (!cfg) {
        deps.log('Voice config: no usable cache — using bundled.');
        return;
      }
      apply(cfg, 'cache');
      deps.log('Voice config: applied cached.');
    } catch {
      // Keep whatever is active (bundled). Never throw.
    }
  }

  async function refresh(): Promise<void> {
    try {
      const raw = await deps.fetchRemote();
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const cfg = parseVoiceConfig(text);
      if (!cfg) {
        deps.log('Voice config remote: invalid/old — kept last-good.');
        return;
      }
      apply(cfg, 'remote@1');
      if (!persisted) {
        persisted = true;
        void deps
          .writeStored(serializeVoiceConfig(cfg))
          .then((ok) => {
            if (ok) deps.log('Voice config: applied remote + persisted.');
            else persisted = false;
          })
          .catch(() => {
            persisted = false;
          });
      } else {
        deps.log('Voice config: applied remote.');
      }
    } catch {
      deps.log('Voice config remote: unreachable — offline ok.');
    }
  }

  return {
    current: () => ({ config, grammar, provenance }),
    hydrate,
    refresh,
  };
}
