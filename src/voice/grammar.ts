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

/** Words that mean "open this room's device list". */
export const ROOM_WORDS = new Set(['room', 'rooms', 'go', 'goto', 'enter', 'show', 'open']);

/** Leading/utility words dropped before name matching. */
export const FILLER_WORDS = new Set([
  'the', 'a', 'an', 'please', 'hey', 'ok', 'okay', 'my', 'to', 'in', 'and',
  'turn', 'switch', 'um', 'uh', 'now', 'lets', 'let', 'us',
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
