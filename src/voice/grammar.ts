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
  'turn', 'switch', 'um', 'uh', 'now', 'lets', 'let', 'us',
]);

/** Common, low-distinctiveness words in automation names ("Kitchen Lights",
 *  "All Lamps", "Family Room"). Down-weighted in name scoring so a shared
 *  *distinctive* word (e.g. "family") outweighs a shared *generic* one
 *  (e.g. "lights") — "family … off" should pick "Family Room: OFF", not the
 *  catch-all "All lights: OFF". (Not stripped — only weighted.) */
export const GENERIC_NAME_TOKENS = new Set([
  'light', 'lights', 'lamp', 'lamps', 'all', 'everything', 'the', 'a', 'an',
]);

/** Digit-word → digit, for names like "Scene 2" / "Bedroom 3". */
export const NUMBER_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
};

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
