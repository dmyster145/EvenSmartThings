/**
 * Thin wrapper over vosk-browser.
 *
 * vosk-browser is fully self-contained: its worker is an inlined Blob and the
 * Kaldi WASM is embedded in the bundle, so there is NO CDN/network dependency.
 * Only the speech model archive is fetched — from a bundled, relative URL
 * (offline): `/vosk/model.tar.gz`.
 *
 * Unlike the EvenChess port this recognizer takes an OPTIONAL grammar. Scene /
 * device / room names are user-defined and frequently contain words outside a
 * fixed vocabulary, so we default to open-vocabulary dictation and let the
 * fuzzy matcher (match.ts) correct recognition slips against the known catalog.
 * A caller may still pass a constrained word list when the catalog is small and
 * known to be in-lexicon.
 */

import { createModel, type Model } from 'vosk-browser';
import { VOICE_SAMPLE_RATE } from './pcm';

export interface RecognizerCallbacks {
  onPartial?(text: string): void;
  onFinal(text: string): void;
  onError(error: string): void;
}

export interface Recognizer {
  /** Feed mono Float32 samples at 16 kHz. */
  accept(samples: Float32Array): void;
  /** Force end-of-utterance; the final transcript arrives via onFinal. */
  finalize(): void;
  dispose(): void;
}

interface VoskMessage {
  event?: string;
  error?: unknown;
  result?: { text?: string; partial?: string };
}

let modelPromise: Promise<Model> | null = null;

/** Load (once) and cache the model. Safe to call eagerly to warm the cache. */
export function preloadVoiceModel(modelUrl: string): Promise<Model> {
  if (!modelPromise) {
    modelPromise = createModel(modelUrl).catch((err) => {
      modelPromise = null; // allow a later retry
      throw err;
    });
  }
  return modelPromise;
}

export async function createRecognizer(
  modelUrl: string,
  cb: RecognizerCallbacks,
  grammar?: string[] | null,
): Promise<Recognizer> {
  const model = await preloadVoiceModel(modelUrl);
  // A non-empty grammar constrains the decoder; omit it entirely for
  // open-vocabulary dictation (the default for arbitrary SmartThings names).
  const rec =
    grammar && grammar.length > 0
      ? new model.KaldiRecognizer(VOICE_SAMPLE_RATE, JSON.stringify(grammar))
      : new model.KaldiRecognizer(VOICE_SAMPLE_RATE);
  rec.setWords(true);

  rec.on('result', (m: VoskMessage) => {
    const text = m?.result?.text?.trim();
    if (text) cb.onFinal(text);
  });
  rec.on('partialresult', (m: VoskMessage) => {
    const partial = m?.result?.partial?.trim();
    if (partial && cb.onPartial) cb.onPartial(partial);
  });
  rec.on('error', (m: VoskMessage) => {
    cb.onError(typeof m?.error === 'string' ? m.error : 'recognizer error');
  });

  let disposed = false;
  return {
    accept(samples: Float32Array): void {
      if (disposed || samples.length === 0) return;
      try {
        rec.acceptWaveformFloat(samples, VOICE_SAMPLE_RATE);
      } catch (err) {
        cb.onError(`acceptWaveform failed: ${String(err)}`);
      }
    },
    finalize(): void {
      if (disposed) return;
      try {
        rec.retrieveFinalResult();
      } catch {
        /* a final result may already be in flight */
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        rec.remove();
      } catch {
        /* worker may already be gone */
      }
    },
  };
}
