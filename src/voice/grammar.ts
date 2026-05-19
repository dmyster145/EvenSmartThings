/**
 * Voice text normalization + command vocabulary for SmartThings dictation.
 *
 * The vocabulary (word lists + number maps) is DATA, supplied by a VoiceConfig
 * (see ./config) so it can be downloaded/updated without an app release. This
 * module turns a config into an immutable `Grammar` (Sets + closures); the
 * matching ALGORITHM (match.ts) and the offline Vosk model stay compiled in.
 *
 * `defaultGrammar` is built eagerly from the bundled `defaultVoiceConfig` (no
 * network) and every legacy named export is re-exposed as one of its members,
 * so existing importers keep working unchanged.
 */

import { type VoiceConfig, defaultVoiceConfig } from './config';

/**
 * Lowercase, strip punctuation/diacritics to ASCII-ish, collapse whitespace.
 * Keeps alphanumerics and single spaces only. Vocabulary-free → a pure free
 * function (also re-exposed on Grammar for symmetry).
 */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export interface Grammar {
  SCENE_WORDS: Set<string>;
  ON_WORDS: Set<string>;
  OFF_WORDS: Set<string>;
  ROOM_WORDS: Set<string>;
  FILLER_WORDS: Set<string>;
  GENERIC_NAME_TOKENS: Set<string>;
  OPEN_WORDS: Set<string>;
  CLOSE_WORDS: Set<string>;
  LOCK_WORDS: Set<string>;
  UNLOCK_WORDS: Set<string>;
  PLAY_WORDS: Set<string>;
  PAUSE_WORDS: Set<string>;
  STOP_WORDS: Set<string>;
  MUTE_WORDS: Set<string>;
  UNMUTE_WORDS: Set<string>;
  VOLUME_WORDS: Set<string>;
  VOLUME_UP_WORDS: Set<string>;
  VOLUME_DOWN_WORDS: Set<string>;
  PRESS_WORDS: Set<string>;
  WARMER_WORDS: Set<string>;
  COOLER_WORDS: Set<string>;
  FASTER_WORDS: Set<string>;
  SLOWER_WORDS: Set<string>;
  MODE_HEAT_WORDS: Set<string>;
  MODE_COOL_WORDS: Set<string>;
  MODE_AUTO_WORDS: Set<string>;
  NEXT_WORDS: Set<string>;
  PREV_WORDS: Set<string>;
  TRACK_STRONG_WORDS: Set<string>;
  LEVEL_WORDS: Set<string>;
  NUMBER_WORDS: Record<string, string>;
  NUMBER_WORD_SET: Set<string>;
  /** Accept threshold (0..1). */
  matchMin: number;
  /** Weight applied to GENERIC_NAME_TOKENS in scoreName (0..1). */
  genericTokenWeight: number;
  normalizeText(input: string): string;
  /** Normalize → split → map digit-words to digits. */
  tokenize(input: string): string[];
  /** Extract a percentage 0–100 from tokenized speech, or null. */
  parseLevelPercent(tokens: string[]): number | null;
}

/** Build an immutable Grammar from a (already-validated) VoiceConfig. The
 *  number-parse logic is compiled here; only the maps are data. */
export function createGrammar(config: VoiceConfig): Grammar {
  const NUMBER_WORDS: Record<string, string> = { ...config.numberWords };
  const onesWords = config.onesWords;
  const tensWords = config.tensWords;
  const NUMBER_WORD_SET = new Set<string>([
    ...Object.keys(onesWords),
    ...Object.keys(tensWords),
    ...config.numberExtraWords,
  ]);

  function tokenize(input: string): string[] {
    const norm = normalizeText(input);
    if (!norm) return [];
    return norm.split(' ').map((t) => NUMBER_WORDS[t] ?? t);
  }

  function parseLevelPercent(tokens: string[]): number | null {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (t === 'half') return 50;
      // Pure digits (tokenize already mapped zero–ten word→digit).
      if (/^\d{1,3}$/.test(t)) {
        const n = parseInt(t, 10);
        if (n >= 0 && n <= 100) return n;
        continue;
      }
      if (t === 'hundred') return 100;
      if (t in tensWords) {
        const tens = tensWords[t]!;
        const next = tokens[i + 1];
        if (next && /^[1-9]$/.test(next)) return tens + parseInt(next, 10);
        if (next && next in onesWords && onesWords[next]! < 10) return tens + onesWords[next]!;
        return tens;
      }
      if (t in onesWords) {
        const ones = onesWords[t]!;
        if (tokens[i + 1] === 'hundred') return 100;
        return ones;
      }
    }
    return null;
  }

  return {
    SCENE_WORDS: new Set(config.sceneWords),
    ON_WORDS: new Set(config.onWords),
    OFF_WORDS: new Set(config.offWords),
    ROOM_WORDS: new Set(config.roomWords),
    FILLER_WORDS: new Set(config.fillerWords),
    GENERIC_NAME_TOKENS: new Set(config.genericNameTokens),
    OPEN_WORDS: new Set(config.openWords),
    CLOSE_WORDS: new Set(config.closeWords),
    LOCK_WORDS: new Set(config.lockWords),
    UNLOCK_WORDS: new Set(config.unlockWords),
    PLAY_WORDS: new Set(config.playWords),
    PAUSE_WORDS: new Set(config.pauseWords),
    STOP_WORDS: new Set(config.stopWords),
    MUTE_WORDS: new Set(config.muteWords),
    UNMUTE_WORDS: new Set(config.unmuteWords),
    VOLUME_WORDS: new Set(config.volumeWords),
    VOLUME_UP_WORDS: new Set(config.volumeUpWords),
    VOLUME_DOWN_WORDS: new Set(config.volumeDownWords),
    PRESS_WORDS: new Set(config.pressWords),
    WARMER_WORDS: new Set(config.warmerWords),
    COOLER_WORDS: new Set(config.coolerWords),
    FASTER_WORDS: new Set(config.fasterWords),
    SLOWER_WORDS: new Set(config.slowerWords),
    MODE_HEAT_WORDS: new Set(config.modeHeatWords),
    MODE_COOL_WORDS: new Set(config.modeCoolWords),
    MODE_AUTO_WORDS: new Set(config.modeAutoWords),
    NEXT_WORDS: new Set(config.nextWords),
    PREV_WORDS: new Set(config.prevWords),
    TRACK_STRONG_WORDS: new Set(config.trackStrongWords),
    LEVEL_WORDS: new Set(config.levelWords),
    NUMBER_WORDS,
    NUMBER_WORD_SET,
    matchMin: config.matchMin,
    genericTokenWeight: config.genericTokenWeight,
    normalizeText,
    tokenize,
    parseLevelPercent,
  };
}

/** Bundled grammar — eager, synchronous, no network. Permanent offline-first
 *  default; a downloaded/cached config replaces the *active* grammar at
 *  runtime (see config-lifecycle.ts), this stays the fallback. */
export const defaultGrammar: Grammar = createGrammar(defaultVoiceConfig);

// ---- Back-compat shims: every legacy named export is a defaultGrammar member
//      so existing importers (and the 76+6 voice tests) keep working unchanged.
export const SCENE_WORDS = defaultGrammar.SCENE_WORDS;
export const ON_WORDS = defaultGrammar.ON_WORDS;
export const OFF_WORDS = defaultGrammar.OFF_WORDS;
export const ROOM_WORDS = defaultGrammar.ROOM_WORDS;
export const FILLER_WORDS = defaultGrammar.FILLER_WORDS;
export const GENERIC_NAME_TOKENS = defaultGrammar.GENERIC_NAME_TOKENS;
export const OPEN_WORDS = defaultGrammar.OPEN_WORDS;
export const CLOSE_WORDS = defaultGrammar.CLOSE_WORDS;
export const LOCK_WORDS = defaultGrammar.LOCK_WORDS;
export const UNLOCK_WORDS = defaultGrammar.UNLOCK_WORDS;
export const PLAY_WORDS = defaultGrammar.PLAY_WORDS;
export const PAUSE_WORDS = defaultGrammar.PAUSE_WORDS;
export const STOP_WORDS = defaultGrammar.STOP_WORDS;
export const MUTE_WORDS = defaultGrammar.MUTE_WORDS;
export const UNMUTE_WORDS = defaultGrammar.UNMUTE_WORDS;
export const VOLUME_WORDS = defaultGrammar.VOLUME_WORDS;
export const VOLUME_UP_WORDS = defaultGrammar.VOLUME_UP_WORDS;
export const VOLUME_DOWN_WORDS = defaultGrammar.VOLUME_DOWN_WORDS;
export const PRESS_WORDS = defaultGrammar.PRESS_WORDS;
export const WARMER_WORDS = defaultGrammar.WARMER_WORDS;
export const COOLER_WORDS = defaultGrammar.COOLER_WORDS;
export const FASTER_WORDS = defaultGrammar.FASTER_WORDS;
export const SLOWER_WORDS = defaultGrammar.SLOWER_WORDS;
export const MODE_HEAT_WORDS = defaultGrammar.MODE_HEAT_WORDS;
export const MODE_COOL_WORDS = defaultGrammar.MODE_COOL_WORDS;
export const MODE_AUTO_WORDS = defaultGrammar.MODE_AUTO_WORDS;
export const NEXT_WORDS = defaultGrammar.NEXT_WORDS;
export const PREV_WORDS = defaultGrammar.PREV_WORDS;
export const TRACK_STRONG_WORDS = defaultGrammar.TRACK_STRONG_WORDS;
export const LEVEL_WORDS = defaultGrammar.LEVEL_WORDS;
export const NUMBER_WORDS = defaultGrammar.NUMBER_WORDS;
export const NUMBER_WORD_SET = defaultGrammar.NUMBER_WORD_SET;

/** Delegate to the bundled grammar (legacy free-function API). */
export function tokenize(input: string): string[] {
  return defaultGrammar.tokenize(input);
}
export function parseLevelPercent(tokens: string[]): number | null {
  return defaultGrammar.parseLevelPercent(tokens);
}
