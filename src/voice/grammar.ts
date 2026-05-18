/**
 * Voice text normalization + command vocabulary for SmartThings dictation.
 *
 * Unlike EvenChess (a fixed chess grammar handed to the decoder), scene /
 * device / room names are arbitrary and user-defined, so the recognizer runs
 * open-vocabulary and the heavy lifting is fuzzy matching the transcript
 * against the live catalog (see match.ts). This module only provides the
 * generic text cleanup and the small set of intent/filler words.
 */

/** Verbs that mean "run this scene". */
export const SCENE_WORDS = new Set([
  'run', 'activate', 'execute', 'start', 'trigger', 'scene', 'set', 'play',
]);

/** Words that mean "turn this device ON". ("open" is intentionally NOT here —
 *  it's reserved for room navigation; say "turn on …" to switch a device on.) */
export const ON_WORDS = new Set(['on', 'enable']);

/** Words that mean "turn this device OFF". */
export const OFF_WORDS = new Set(['off', 'disable', 'close', 'stop']);

/** Verbs that mean "open this room's device list".
 *  NOTE: the literal nouns "room"/"rooms" are deliberately NOT here — they
 *  appear inside real names ("Family Room", "Living Room Lamp", "Family
 *  Room: OFF"). Treating them as command words stripped the distinguishing
 *  token (e.g. "family room lights" → "family lights") and mis-matched
 *  "Family Room: OFF" against "All lights: OFF". Room navigation still
 *  triggers on the actual verbs below. */
export const ROOM_WORDS = new Set(['go', 'goto', 'enter', 'show', 'open']);

/** Leading/utility words dropped before name matching. */
export const FILLER_WORDS = new Set([
  'the', 'a', 'an', 'please', 'hey', 'ok', 'okay', 'my', 'to', 'in', 'and',
  'turn', 'switch', 'um', 'uh', 'now', 'lets', 'let', 'us', 'power', 'make', 'it',
]);

/** Common, low-distinctiveness words in automation names ("Kitchen Lights",
 *  "All Lamps", "Family Room"). Down-weighted in name scoring so a shared
 *  *distinctive* word (e.g. "family") outweighs a shared *generic* one
 *  (e.g. "lights") — "family … off" should pick "Family Room: OFF", not the
 *  catch-all "All lights: OFF". (Not stripped — only weighted.) */
export const GENERIC_NAME_TOKENS = new Set([
  'light', 'lights', 'lamp', 'lamps', 'all', 'everything', 'the', 'a', 'an',
]);

/** Device-control verbs (resolved against the matched device's capabilities
 *  in match.ts — e.g. "open" hits a garage/shade/valve, not room nav, when a
 *  matching openable device exists). Several deliberately overlap ON/OFF/ROOM
 *  words ("close"/"stop"/"open"); the matcher disambiguates by capability. */
export const OPEN_WORDS = new Set(['open', 'raise']);
export const CLOSE_WORDS = new Set(['close', 'shut', 'lower']);
export const LOCK_WORDS = new Set(['lock', 'secure']);
export const UNLOCK_WORDS = new Set(['unlock', 'unsecure']);
export const PLAY_WORDS = new Set(['play', 'resume', 'unpause', 'continue']);
export const PAUSE_WORDS = new Set(['pause']);
export const STOP_WORDS = new Set(['stop', 'halt']);
export const MUTE_WORDS = new Set(['mute', 'silence']);
export const UNMUTE_WORDS = new Set(['unmute']);
/** Relative speaker volume (audioVolume volumeUp/volumeDown). "volume"/"louder"
 *  /"quieter" trigger it; direction from up/down/louder/quieter. */
export const VOLUME_WORDS = new Set(['volume', 'louder', 'quieter']);
export const VOLUME_UP_WORDS = new Set(['up', 'increase', 'louder', 'raise']);
export const VOLUME_DOWN_WORDS = new Set(['down', 'decrease', 'quieter', 'lower']);
/** Press a momentary button (momentary push). */
export const PRESS_WORDS = new Set(['press', 'push']);

// ---- Relative-from-state climate / fan / shade controls -------------------
/** colorTemperature warmer/cooler, OR thermostat setpoint up/down — routed by
 *  the matched device's capability. */
export const WARMER_WORDS = new Set(['warmer', 'hotter']);
export const COOLER_WORDS = new Set(['cooler', 'colder']);
/** fanSpeed +/- 1. */
export const FASTER_WORDS = new Set(['faster']);
export const SLOWER_WORDS = new Set(['slower']);
/** thermostatMode absolute mode. ("off" intentionally excluded — it collides
 *  with the global power-off intent; use the device menu to turn a thermostat
 *  fully off.) */
export const MODE_HEAT_WORDS = new Set(['heat', 'heating']);
export const MODE_COOL_WORDS = new Set(['cool', 'cooling']);
export const MODE_AUTO_WORDS = new Set(['auto', 'automatic']);
/** Skip to the next / previous track (mediaTrackControl). */
export const NEXT_WORDS = new Set(['next', 'forward', 'skip']);
export const PREV_WORDS = new Set(['previous', 'prev', 'back', 'backward', 'rewind']);
/** Track words that are UNAMBIGUOUS commands (vs. "back"/"backward"/"forward"
 *  which also appear in names like "Back Porch"). Only a strong word makes the
 *  track branch terminal; a weak-only phrase falls through if nothing supports
 *  track control, so "turn on back porch" still works. */
export const TRACK_STRONG_WORDS = new Set(['next', 'previous', 'prev', 'skip', 'rewind']);
/** Words that hint a dim/level intent (stripped from the name; the actual
 *  level comes from parseLevelPercent). */
export const LEVEL_WORDS = new Set(['dim', 'brightness', 'level', 'percent', 'percentage', 'pct']);

/** Digit-word → digit, for names like "Scene 2" / "Bedroom 3". */
export const NUMBER_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
};

const ONES_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS_WORDS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** Every spoken number word (for stripping the level value out of a name). */
export const NUMBER_WORD_SET = new Set<string>([
  ...Object.keys(ONES_WORDS), ...Object.keys(TENS_WORDS), 'hundred', 'half',
]);

/**
 * Extract a percentage 0–100 from tokenized speech for dim/level commands:
 * "to 20", "20 percent", "twenty", "twenty five percent", "one hundred",
 * "a hundred", "half". Returns null if no plausible level is present.
 */
export function parseLevelPercent(tokens: string[]): number | null {
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
    if (t in TENS_WORDS) {
      const tens = TENS_WORDS[t]!;
      const next = tokens[i + 1];
      // "twenty five" → 25 (next is a 0–9 digit from tokenize, or 1–9 word).
      if (next && /^[1-9]$/.test(next)) return tens + parseInt(next, 10);
      if (next && next in ONES_WORDS && ONES_WORDS[next]! < 10) return tens + ONES_WORDS[next]!;
      return tens;
    }
    if (t in ONES_WORDS) {
      const ones = ONES_WORDS[t]!;
      if (tokens[i + 1] === 'hundred') return 100;
      return ones;
    }
  }
  return null;
}

/**
 * Lowercase, strip punctuation/diacritics to ASCII-ish, collapse whitespace.
 * Keeps alphanumerics and single spaces only.
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

/** Normalize then split into tokens, mapping digit-words to digits. */
export function tokenize(input: string): string[] {
  const norm = normalizeText(input);
  if (!norm) return [];
  return norm.split(' ').map((t) => NUMBER_WORDS[t] ?? t);
}
