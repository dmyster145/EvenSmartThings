/**
 * Voice config — the DATA half of the voice grammar (word lists + tunables),
 * made downloadable so vocabulary/threshold/timing tweaks ship without an
 * app update. The match ALGORITHM and the offline Vosk model stay compiled in.
 *
 * Offline-first: `defaultVoiceConfig` (the exact values previously hard-coded
 * in grammar.ts / match.ts / controller.ts) is the permanent fallback. A
 * downloaded or cached blob is validated defensively (mirrors
 * src/state/list-cache.ts): hard failures → null (caller keeps last-good /
 * bundled); a structurally-valid blob with any bad field falls back per-field
 * to the default so the result is ALWAYS fully populated — never partial,
 * never able to brick the recognizer.
 */

/** Bridge-storage key. Bump SCHEMA_VERSION on any breaking shape change so a
 *  stale blob from an older build is ignored rather than mis-applied. */
export const VOICE_CONFIG_KEY = 'smartthings_controls_voice_config';
const SCHEMA_VERSION = 1;

const MAX_LIST_LEN = 64;
const MAX_WORD_LEN = 32;
const MAX_NUMBER_WORDS = 64;

export interface VoiceConfig {
  // ---- Word lists (string[]; names mirror grammar.ts) --------------------
  sceneWords: string[];
  onWords: string[];
  offWords: string[];
  roomWords: string[];
  fillerWords: string[];
  genericNameTokens: string[];
  openWords: string[];
  closeWords: string[];
  lockWords: string[];
  unlockWords: string[];
  playWords: string[];
  pauseWords: string[];
  stopWords: string[];
  muteWords: string[];
  unmuteWords: string[];
  volumeWords: string[];
  volumeUpWords: string[];
  volumeDownWords: string[];
  pressWords: string[];
  warmerWords: string[];
  coolerWords: string[];
  fasterWords: string[];
  slowerWords: string[];
  modeHeatWords: string[];
  modeCoolWords: string[];
  modeAutoWords: string[];
  nextWords: string[];
  prevWords: string[];
  trackStrongWords: string[];
  levelWords: string[];
  // ---- Number parsing data ----------------------------------------------
  numberWords: Record<string, string>; // digit-word → digit (drives tokenize)
  onesWords: Record<string, number>; // zero..nineteen
  tensWords: Record<string, number>; // twenty..ninety
  numberExtraWords: string[]; // e.g. ['hundred','half'] — for NUMBER_WORD_SET
  // ---- Tunables ----------------------------------------------------------
  matchMin: number; // accept threshold (0..1)
  genericTokenWeight: number; // weight of GENERIC_NAME_TOKENS (0..1)
  silenceMs: number; // end-of-speech window
  minListenMs: number; // min utterance before silence can finalize
  maxListenMs: number; // hard cap on one utterance
  resultTimeoutMs: number; // wait for recognizer final after finalize
  endpointPollMs: number; // silence-poll interval
}

interface StoredVoiceConfig extends VoiceConfig {
  v: number;
  cachedAt: number;
}

/** The exact values previously hard-coded in grammar.ts / match.ts /
 *  controller.ts. Permanent offline-first fallback — never removed. */
export const defaultVoiceConfig: VoiceConfig = {
  sceneWords: ['run', 'activate', 'execute', 'start', 'trigger', 'scene', 'set', 'play'],
  onWords: ['on', 'enable'],
  offWords: ['off', 'disable', 'close', 'stop'],
  roomWords: ['go', 'goto', 'enter', 'show', 'open'],
  fillerWords: [
    'the', 'a', 'an', 'please', 'hey', 'ok', 'okay', 'my', 'to', 'in', 'and',
    'turn', 'switch', 'um', 'uh', 'now', 'lets', 'let', 'us', 'power', 'make', 'it',
  ],
  genericNameTokens: ['light', 'lights', 'lamp', 'lamps', 'all', 'everything', 'the', 'a', 'an'],
  openWords: ['open', 'raise'],
  closeWords: ['close', 'shut', 'lower'],
  lockWords: ['lock', 'secure'],
  unlockWords: ['unlock', 'unsecure'],
  playWords: ['play', 'resume', 'unpause', 'continue'],
  pauseWords: ['pause'],
  stopWords: ['stop', 'halt'],
  muteWords: ['mute', 'silence'],
  unmuteWords: ['unmute'],
  volumeWords: ['volume', 'louder', 'quieter'],
  volumeUpWords: ['up', 'increase', 'louder', 'raise'],
  volumeDownWords: ['down', 'decrease', 'quieter', 'lower'],
  pressWords: ['press', 'push'],
  warmerWords: ['warmer', 'hotter'],
  coolerWords: ['cooler', 'colder'],
  fasterWords: ['faster'],
  slowerWords: ['slower'],
  modeHeatWords: ['heat', 'heating'],
  modeCoolWords: ['cool', 'cooling'],
  modeAutoWords: ['auto', 'automatic'],
  nextWords: ['next', 'forward', 'skip'],
  prevWords: ['previous', 'prev', 'back', 'backward', 'rewind'],
  trackStrongWords: ['next', 'previous', 'prev', 'skip', 'rewind'],
  levelWords: ['dim', 'brightness', 'level', 'percent', 'percentage', 'pct'],
  numberWords: {
    zero: '0', one: '1', two: '2', three: '3', four: '4',
    five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  },
  onesWords: {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  },
  tensWords: {
    twenty: 20, thirty: 30, forty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  },
  numberExtraWords: ['hundred', 'half'],
  matchMin: 0.6,
  genericTokenWeight: 0.35,
  silenceMs: 1600,
  minListenMs: 400,
  maxListenMs: 12000,
  resultTimeoutMs: 2000,
  endpointPollMs: 150,
};

const WORD_LIST_KEYS: Array<keyof VoiceConfig> = [
  'sceneWords', 'onWords', 'offWords', 'roomWords', 'fillerWords', 'genericNameTokens',
  'openWords', 'closeWords', 'lockWords', 'unlockWords', 'playWords', 'pauseWords',
  'stopWords', 'muteWords', 'unmuteWords', 'volumeWords', 'volumeUpWords',
  'volumeDownWords', 'pressWords', 'warmerWords', 'coolerWords', 'fasterWords',
  'slowerWords', 'modeHeatWords', 'modeCoolWords', 'modeAutoWords', 'nextWords',
  'prevWords', 'trackStrongWords', 'levelWords', 'numberExtraWords',
];

/** Valid string[] (every item a non-empty string ≤ MAX_WORD_LEN, ≤ MAX_LIST_LEN
 *  items) → lowercased/trimmed; else the bundled default for that field. */
function strArr(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v) || v.length > MAX_LIST_LEN) return fallback;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') return fallback;
    const w = item.toLowerCase().trim();
    if (w.length === 0 || w.length > MAX_WORD_LEN) return fallback;
    out.push(w);
  }
  return out;
}

function strMap(v: unknown, fallback: Record<string, string>): Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fallback;
  const e = Object.entries(v as Record<string, unknown>);
  if (e.length > MAX_NUMBER_WORDS) return fallback;
  const out: Record<string, string> = {};
  for (const [k, val] of e) {
    if (typeof val !== 'string' || k.length > MAX_WORD_LEN || val.length > MAX_WORD_LEN) {
      return fallback;
    }
    out[k.toLowerCase()] = val;
  }
  return out;
}

function numMap(v: unknown, fallback: Record<string, number>): Record<string, number> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fallback;
  const e = Object.entries(v as Record<string, unknown>);
  if (e.length > MAX_NUMBER_WORDS) return fallback;
  const out: Record<string, number> = {};
  for (const [k, val] of e) {
    if (typeof val !== 'number' || !Number.isFinite(val) || k.length > MAX_WORD_LEN) {
      return fallback;
    }
    out[k.toLowerCase()] = val;
  }
  return out;
}

/** Finite number clamped into [min,max]; non-number → fallback. So a bad
 *  remote value (matchMin:99, silenceMs:-5) can never brick the recognizer. */
function num(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export function serializeVoiceConfig(cfg: VoiceConfig): string {
  const payload: StoredVoiceConfig = { ...cfg, v: SCHEMA_VERSION, cachedAt: Date.now() };
  return JSON.stringify(payload);
}

/**
 * Parse a stored/remote config blob. Returns null ONLY on a hard failure
 * (missing, bad JSON, not an object, wrong schema version) — caller then
 * keeps the last-good/bundled config. Otherwise returns a FULLY-populated
 * VoiceConfig with each invalid/missing field replaced by the bundled default.
 */
export function parseVoiceConfig(raw: string | null | undefined): VoiceConfig | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const s = parsed as Partial<StoredVoiceConfig> & Record<string, unknown>;
  if (s.v !== SCHEMA_VERSION) return null;

  const out = { ...defaultVoiceConfig } as VoiceConfig;
  for (const key of WORD_LIST_KEYS) {
    (out[key] as string[]) = strArr(s[key as string], defaultVoiceConfig[key] as string[]);
  }
  out.numberWords = strMap(s.numberWords, defaultVoiceConfig.numberWords);
  out.onesWords = numMap(s.onesWords, defaultVoiceConfig.onesWords);
  out.tensWords = numMap(s.tensWords, defaultVoiceConfig.tensWords);
  out.matchMin = num(s.matchMin, defaultVoiceConfig.matchMin, 0, 1);
  out.genericTokenWeight = num(s.genericTokenWeight, defaultVoiceConfig.genericTokenWeight, 0, 1);
  out.silenceMs = num(s.silenceMs, defaultVoiceConfig.silenceMs, 200, 10000);
  out.minListenMs = num(s.minListenMs, defaultVoiceConfig.minListenMs, 0, 5000);
  out.maxListenMs = num(s.maxListenMs, defaultVoiceConfig.maxListenMs, 2000, 60000);
  out.resultTimeoutMs = num(s.resultTimeoutMs, defaultVoiceConfig.resultTimeoutMs, 200, 10000);
  out.endpointPollMs = num(s.endpointPollMs, defaultVoiceConfig.endpointPollMs, 50, 1000);
  return out;
}
