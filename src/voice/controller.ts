/**
 * Push-to-talk voice controller (domain-agnostic).
 *
 * Lifecycle: enter the Voice screen → tap → start() → mic on → stream PCM to the
 * recognizer → end-of-speech (silence) or timeout → finalize → onTranscript →
 * (the app fuzzy-matches the phrase to a scene/device/room and executes it) →
 * mic off.
 *
 * Ported from the EvenChess voice controller, with the chess couplings replaced
 * by injected callbacks so it carries no SmartThings domain logic. Voice is
 * purely additive: if the model fails to load start() returns false and the
 * screen just sits idle. The mic is force-closed on every exit path.
 */

import { createRecognizer, type Recognizer } from './recognizer';
import { payloadToFloat32, meanAbsAmplitude, type AudioPayload } from './pcm';

export interface VoiceControllerDeps {
  bridge: { audioControl(isOpen: boolean): Promise<boolean> };
  /** Relative URL of the bundled Vosk model archive (offline). */
  modelUrl: string;
  /** True only when it's valid to listen (e.g. on the Voice screen, not executing). */
  isEligible(): boolean;
  /** Mic opened — show "Listening…". */
  onListenStart(): void;
  /** Mic closed (any reason). */
  onListenEnd(): void;
  /** Transient status line for the Voice screen. */
  onStatus(message: string): void;
  /** Final transcript — the app matches + executes. */
  onTranscript(text: string): void;
  /** Diagnostic line for the copyable debug log (model/mic/recognizer
   *  lifecycle + failures). Separate from onStatus so it isn't spammed by
   *  interim partials. Optional. */
  onLog?(message: string): void;
  /** Listen-window tunables (from the downloaded/cached voice config). Each
   *  field defaults to the bundled constant when omitted — existing callers
   *  (and controller.test.ts, which omits this) are unaffected. Read ONCE at
   *  construction; a later remote config applies on the next app launch. */
  timings?: Partial<VoiceTimings>;
  /** Where the active config came from (`bundled`/`cache`/`remote@N`) — logged
   *  once for bug-report reproducibility. */
  grammarProvenance?: string;
}

export interface VoiceTimings {
  silenceMs: number;
  minListenMs: number;
  maxListenMs: number;
  resultTimeoutMs: number;
  endpointPollMs: number;
}

const SPEECH_AMPLITUDE = 0.012; // mic-level threshold (audio, not vocab — stays local)
// Bundled listen-window defaults. End-of-speech silence: 900 ms cut people off
// mid-command on a normal pause; 1.6 s lets a natural pause ride through.
// Max utterance raised to 12 s so long commands aren't truncated. A downloaded
// voice config can override these (applied on next launch).
const DEFAULT_TIMINGS: VoiceTimings = {
  silenceMs: 1600,
  minListenMs: 400,
  maxListenMs: 12000,
  resultTimeoutMs: 2000,
  endpointPollMs: 150,
};

export interface VoiceController {
  /** Begin a fresh preload of the model (call once at app init to warm the cache). */
  warm(): void;
  /** Attempt to start listening. Returns false if voice isn't usable right now. */
  start(): boolean;
  /** Feed a raw SDK audio payload (no-op unless listening). */
  feed(payload: AudioPayload): void;
  /** Abort listening (user tapped/navigated away). */
  cancel(): void;
  isListening(): boolean;
  /** Debug/verification: run onTranscript on a phrase, no audio. */
  injectTranscript(text: string): void;
  /** Mic-off + recognizer teardown. Idempotent. Call on every exit path. */
  dispose(): void;
}

export function createVoiceController(deps: VoiceControllerDeps): VoiceController {
  const { bridge, modelUrl, isEligible, onListenStart, onListenEnd, onStatus, onTranscript } = deps;
  const log = (m: string): void => deps.onLog?.(`[voice] ${m}`);
  // Resolve listen tunables once (remote config applies on next launch).
  const t: VoiceTimings = { ...DEFAULT_TIMINGS, ...(deps.timings ?? {}) };

  let recognizer: Recognizer | null = null;
  let modelFailed = false;
  let warming = false;
  let starting = false;
  let listening = false;
  let finalizing = false;

  let heardSpeech = false;
  let lastVoiceAt = 0;
  let startedAt = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let resultTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimers(): void {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (resultTimer) { clearTimeout(resultTimer); resultTimer = null; }
    if (maxTimer) { clearTimeout(maxTimer); maxTimer = null; }
  }

  function stopMic(): void {
    void bridge.audioControl(false);
  }

  function endSession(): void {
    const wasActive = listening || starting;
    listening = false;
    finalizing = false;
    heardSpeech = false;
    clearTimers();
    stopMic();
    if (wasActive) onListenEnd();
  }

  function handleTranscript(text: string): void {
    if (!listening && !finalizing) return;
    endSession();
    log(`final transcript: "${text}"`);
    onStatus(`Heard: ${text}`);
    onTranscript(text);
  }

  function finalizeUtterance(): void {
    if (finalizing || !listening) return;
    finalizing = true;
    clearTimers();
    recognizer?.finalize();
    resultTimer = setTimeout(() => {
      if (!finalizing) return;
      endSession();
      log('finalize timed out — no transcript from recognizer');
      onStatus('Didn’t catch that — tap to try again');
    }, t.resultTimeoutMs);
  }

  function onEndpointPoll(): void {
    if (!listening) return;
    const now = Date.now();
    if (now - startedAt > t.minListenMs && heardSpeech && now - lastVoiceAt > t.silenceMs) {
      finalizeUtterance();
    }
  }

  async function ensureRecognizer(): Promise<Recognizer | null> {
    if (recognizer) return recognizer;
    try {
      recognizer = await createRecognizer(modelUrl, {
        onFinal: handleTranscript,
        onPartial: (t) => {
          if (listening && t) onStatus(`Hearing: ${t}`);
        },
        onError: (e) => {
          console.error('[voice] recognizer error:', e);
          log(`recognizer error: ${e}`);
        },
      });
      log('offline model loaded — voice ready');
      log(
        `grammar source=${deps.grammarProvenance ?? 'bundled'} silenceMs=${t.silenceMs}`
          + ` maxListenMs=${t.maxListenMs}`,
      );
      return recognizer;
    } catch (err) {
      console.error('[voice] model load failed:', err);
      log(`model load FAILED: ${err instanceof Error ? err.message : String(err)}`);
      modelFailed = true;
      return null;
    }
  }

  function warm(): void {
    if (modelFailed || recognizer || warming) return;
    warming = true;
    void ensureRecognizer().finally(() => {
      warming = false;
    });
  }

  function start(): boolean {
    if (starting || listening || !isEligible()) return false;
    if (modelFailed) {
      log('start blocked: model unavailable');
      onStatus('Voice model unavailable');
      return false;
    }
    if (!recognizer) {
      log('start deferred: model still loading (tap again)');
      warm();
      onStatus('Preparing voice… tap again');
      return false;
    }
    starting = true;
    void (async () => {
      try {
        const ok = await bridge.audioControl(true);
        if (!ok || !isEligible()) {
          stopMic();
          starting = false;
          log(`start aborted: micOpened=${ok} eligible=${isEligible()}`);
          onStatus('Mic unavailable');
          return;
        }
        listening = true;
        finalizing = false;
        heardSpeech = false;
        startedAt = Date.now();
        lastVoiceAt = startedAt;
        log('listening — mic open');
        onListenStart();
        pollTimer = setInterval(onEndpointPoll, t.endpointPollMs);
        maxTimer = setTimeout(finalizeUtterance, t.maxListenMs);
      } finally {
        starting = false;
      }
    })();
    return true;
  }

  function feed(payload: AudioPayload): void {
    if (!listening || !recognizer) return;
    const samples = payloadToFloat32(payload);
    if (samples.length === 0) return;
    if (meanAbsAmplitude(samples) >= SPEECH_AMPLITUDE) {
      heardSpeech = true;
      lastVoiceAt = Date.now();
    }
    recognizer.accept(samples);
  }

  function cancel(): void {
    if (!listening && !starting) return;
    log('listening cancelled (tap/navigation)');
    endSession();
    onStatus('');
  }

  function dispose(): void {
    endSession();
    recognizer?.dispose();
    recognizer = null;
  }

  return {
    warm,
    start,
    feed,
    cancel,
    isListening: () => listening,
    injectTranscript: onTranscript,
    dispose,
  };
}
