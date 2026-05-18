/**
 * Resolve a spoken transcript to a scene / device / room in the user's catalog.
 *
 * Open-vocabulary recognition is noisy, but the candidate set (the user's own
 * scene/device/room names) is small and known, so fuzzy matching against it is
 * very forgiving. Intent (run scene / turn device on|off / open room) is taken
 * from command words; the remaining words are the name phrase, scored against
 * each catalog entry by token overlap + substring + edit-distance similarity.
 */

import {
  tokenize,
  SCENE_WORDS,
  ON_WORDS,
  OFF_WORDS,
  ROOM_WORDS,
  FILLER_WORDS,
  normalizeText,
} from './grammar';

export interface VoiceCatalogScene { id: string; name: string }
export interface VoiceCatalogDevice { id: string; name: string }
export interface VoiceCatalogRoom { id: string; name: string }

export interface VoiceCatalog {
  scenes: VoiceCatalogScene[];
  devices: VoiceCatalogDevice[];
  rooms: VoiceCatalogRoom[];
}

export type VoiceMatch =
  | { type: 'scene'; id: string; name: string }
  | { type: 'device'; id: string; name: string; action: 'on' | 'off' }
  | { type: 'room'; id: string; name: string }
  | { type: 'none'; reason: string };

/** Min score to accept a match; below this we report "no match".
 *  0.6 (not 0.5): a single shared generic word like "lights" yields ~0.5 — too
 *  weak to fire (it once mis-routed "lab lights off" to "Hallway Lights").
 *  Exact / substring / close-edit matches still clear this comfortably. */
const MATCH_MIN = 0.6;

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/** 0–1 similarity between a spoken name phrase and a catalog entry name. */
export function scoreName(queryPhrase: string, entryName: string): number {
  const q = normalizeText(queryPhrase);
  const n = normalizeText(entryName);
  if (!q || !n) return 0;
  if (q === n) return 1;

  const qTokens = q.split(' ');
  const nTokens = n.split(' ');
  const qSet = new Set(qTokens);
  const shared = nTokens.filter((t) => qSet.has(t)).length;
  // Fraction of the entry name's words that were spoken.
  const coverage = shared / nTokens.length;

  // Whole-name substring (e.g. "movie night" inside "run movie night").
  const substring = q.includes(n) || n.includes(q) ? 0.85 : 0;

  // Edit-distance ratio as a fallback for slurred / mis-decoded words.
  const dist = levenshtein(q, n);
  const editRatio = 1 - dist / Math.max(q.length, n.length);

  return Math.max(coverage, substring, editRatio * 0.9);
}

interface Scored { id: string; name: string; score: number }

/** Highest-scoring entry at/above the threshold, or null. No ambiguity prompt —
 *  on-device there's no way to answer "did you mean…", so we always commit to
 *  the best guess; a wrong guess just means tap + speak again. */
function bestOf(entries: Array<{ id: string; name: string }>, phrase: string): Scored | null {
  let best: Scored | null = null;
  for (const e of entries) {
    const score = scoreName(phrase, e.name);
    if (!best || score > best.score) best = { id: e.id, name: e.name, score };
  }
  return best && best.score >= MATCH_MIN ? best : null;
}

/**
 * @param transcript final recognizer text
 * @param catalog the user's current scenes / devices / rooms (display names)
 */
export function matchVoiceCommand(transcript: string, catalog: VoiceCatalog): VoiceMatch {
  const tokens = tokenize(transcript);
  if (tokens.length === 0) return { type: 'none', reason: 'Nothing heard' };

  const has = (set: Set<string>) => tokens.some((t) => set.has(t));
  const explicitOff = has(OFF_WORDS);
  const explicitOn = has(ON_WORDS);
  const wantScene = has(SCENE_WORDS);
  const wantRoom = has(ROOM_WORDS);

  // Scene names frequently embed the action ("Lab: OFF", "All Lights On"), so
  // keep on/off words when matching SCENES; strip them for device/room names
  // (the device is "Lab Lights"; the on/off is the separate action).
  const scenePhrase = tokens
    .filter((t) => !FILLER_WORDS.has(t) && !SCENE_WORDS.has(t) && !ROOM_WORDS.has(t))
    .join(' ');
  const namePhrase = tokens
    .filter(
      (t) =>
        !FILLER_WORDS.has(t) &&
        !SCENE_WORDS.has(t) &&
        !ON_WORDS.has(t) &&
        !OFF_WORDS.has(t) &&
        !ROOM_WORDS.has(t),
    )
    .join(' ');
  if (!scenePhrase && !namePhrase) return { type: 'none', reason: 'No name in command' };

  const sceneR = scenePhrase ? bestOf(catalog.scenes, scenePhrase) : null;
  const deviceR = namePhrase ? bestOf(catalog.devices, namePhrase) : null;
  const roomR = namePhrase ? bestOf(catalog.rooms, namePhrase) : null;

  // Explicit on/off ⇒ a device command, OR an action-named scene like
  // "Lab: OFF". Pick whichever matched more strongly so a weak device match
  // (e.g. only the word "lights" shared) can't beat a clearly-named scene.
  if (explicitOff || explicitOn) {
    if (sceneR && (!deviceR || sceneR.score >= deviceR.score)) {
      return { type: 'scene', id: sceneR.id, name: sceneR.name };
    }
    if (deviceR) {
      return { type: 'device', id: deviceR.id, name: deviceR.name, action: explicitOff ? 'off' : 'on' };
    }
    return { type: 'none', reason: `No match for “${namePhrase || scenePhrase}”` };
  }

  // Explicit scene verb ⇒ run the scene.
  if (wantScene && sceneR) {
    return { type: 'scene', id: sceneR.id, name: sceneR.name };
  }

  // Explicit room verb ⇒ open the room.
  if (wantRoom && roomR) {
    return { type: 'room', id: roomR.id, name: roomR.name };
  }

  // No explicit verb — pick the globally strongest candidate.
  const ranked = [
    sceneR ? { kind: 'scene' as const, ...sceneR } : null,
    deviceR ? { kind: 'device' as const, ...deviceR } : null,
    roomR ? { kind: 'room' as const, ...roomR } : null,
  ]
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  if (!top) return { type: 'none', reason: `No match for “${namePhrase || scenePhrase}”` };

  if (top.kind === 'scene') return { type: 'scene', id: top.id, name: top.name };
  if (top.kind === 'room') return { type: 'room', id: top.id, name: top.name };
  // A device with no explicit verb defaults to turning it on.
  return { type: 'device', id: top.id, name: top.name, action: 'on' };
}
