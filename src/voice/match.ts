/**
 * Resolve a spoken transcript to a scene / device / room in the user's catalog.
 *
 * Open-vocabulary recognition is noisy, but the candidate set (the user's own
 * scene/device/room names) is small and known, so fuzzy matching against it is
 * very forgiving. Intent (run scene / turn device on|off / open room) is taken
 * from command words; the remaining words are the name phrase, scored against
 * each catalog entry by token overlap + substring + edit-distance similarity.
 */

import { defaultGrammar, type Grammar, normalizeText } from './grammar';

/** Capabilities the voice layer can drive, per device. */
export interface VoiceDeviceCaps {
  switch?: boolean;       // on / off
  dimmer?: boolean;       // set level %
  openClose?: boolean;    // garage door / window shade / valve
  lock?: boolean;         // lock / unlock
  media?: boolean;        // play / pause / stop
  track?: boolean;        // next / previous track
  mute?: boolean;         // mute / unmute
  volume?: boolean;       // volume up / down
  press?: boolean;        // momentary push
  colorTemp?: boolean;    // colorTemperature warmer / cooler
  fanSpeed?: boolean;     // fanSpeed faster / slower
  shadeLevel?: boolean;   // windowShadeLevel set to N%
  thermostatSet?: boolean;// thermostat setpoint warmer / cooler
  thermostatMode?: boolean;// thermostat heat / cool / auto
}

export interface VoiceCatalogScene { id: string; name: string }
export interface VoiceCatalogDevice { id: string; name: string; caps?: VoiceDeviceCaps }
export interface VoiceCatalogRoom { id: string; name: string }

export interface VoiceCatalog {
  scenes: VoiceCatalogScene[];
  devices: VoiceCatalogDevice[];
  rooms: VoiceCatalogRoom[];
}

/** Device action verbs. 'level' carries a 0–100 `level`. */
export type DeviceAction =
  | 'on' | 'off'
  | 'level'
  | 'open' | 'close'
  | 'lock' | 'unlock'
  | 'play' | 'pause' | 'stop'
  | 'next' | 'prev'
  | 'mute' | 'unmute'
  | 'volumeUp' | 'volumeDown'
  | 'press'
  | 'warmer' | 'cooler'
  | 'faster' | 'slower'
  | 'shadeLevel'
  | 'modeHeat' | 'modeCool' | 'modeAuto';

export type VoiceMatch =
  | { type: 'scene'; id: string; name: string }
  // `ids` (present when >1) lists EVERY device sharing the matched name —
  // 6 lights all called "Kitchen Lights" all get the command.
  | { type: 'device'; id: string; ids?: string[]; name: string; action: DeviceAction; level?: number }
  // action ⇒ switch every switchable device in the room ("office on");
  // level ⇒ set every dimmable device in the room ("kitchen to 30%");
  // neither ⇒ open the room's device list ("open office").
  | { type: 'room'; id: string; name: string; action?: 'on' | 'off'; level?: number }
  | { type: 'none'; reason: string };

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

/** 0–1 similarity between a spoken name phrase and a catalog entry name.
 *  `grammar` supplies the generic-token set + its weight (default = bundled,
 *  so existing 2-arg callers/tests are unaffected). */
export function scoreName(
  queryPhrase: string,
  entryName: string,
  grammar: Grammar = defaultGrammar,
): number {
  const q = normalizeText(queryPhrase);
  const n = normalizeText(entryName);
  if (!q || !n) return 0;
  if (q === n) return 1;

  const tokenWeight = (t: string): number =>
    grammar.GENERIC_NAME_TOKENS.has(t) ? grammar.genericTokenWeight : 1;
  const qSet = new Set(q.split(' '));
  const nSet = new Set(n.split(' '));
  let qW = 0;
  let nW = 0;
  let interW = 0;
  for (const t of qSet) qW += tokenWeight(t);
  for (const t of nSet) {
    const w = tokenWeight(t);
    nW += w;
    if (qSet.has(t)) interW += w;
  }
  // Weighted token-overlap F1: rewards sharing *distinctive* words, and
  // penalizes BOTH missing name words (recall) and extra unexplained spoken
  // words (precision). So "family … off" favors "Family Room: OFF" over the
  // generic "All lights: OFF" even when only generic words also overlap.
  const precision = qW > 0 ? interW / qW : 0;
  const recall = nW > 0 ? interW / nW : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  // Whole-phrase containment (e.g. "movie night" inside "run movie night").
  const substring = q.includes(n) || n.includes(q) ? 0.85 : 0;

  // Edit-distance ratio as a fallback for slurred / mis-decoded words.
  const dist = levenshtein(q, n);
  const editRatio = 1 - dist / Math.max(q.length, n.length);

  return Math.max(f1, substring, editRatio * 0.9);
}

interface Scored { id: string; name: string; score: number }

/** Highest-scoring entry at/above the threshold, or null. No ambiguity prompt —
 *  on-device there's no way to answer "did you mean…", so we always commit to
 *  the best guess; a wrong guess just means tap + speak again. */
function bestOf(
  entries: Array<{ id: string; name: string }>,
  phrase: string,
  grammar: Grammar,
): Scored | null {
  let best: Scored | null = null;
  for (const e of entries) {
    const score = scoreName(phrase, e.name, grammar);
    if (!best || score > best.score) best = { id: e.id, name: e.name, score };
  }
  return best && best.score >= grammar.matchMin ? best : null;
}

type CapKey = keyof VoiceDeviceCaps;
/** caps absent ⇒ treat as capable (keeps simple test catalogs working; the
 *  app always populates caps from the live device list). */
function capable(d: VoiceCatalogDevice, key: CapKey): boolean {
  return !d.caps || d.caps[key] === true;
}
function bestDevice(
  devices: VoiceCatalogDevice[],
  phrase: string,
  key: CapKey,
  grammar: Grammar,
): Scored | null {
  if (!phrase) return null;
  return bestOf(devices.filter((d) => capable(d, key)), phrase, grammar);
}
/** Single best device matching ANY of the given capabilities (used by the
 *  relative-from-state controls, which are read-modify-write per device and so
 *  act on the best match rather than batching across duplicates). */
function bestDeviceAny(
  devices: VoiceCatalogDevice[],
  phrase: string,
  keys: CapKey[],
  grammar: Grammar,
): Scored | null {
  if (!phrase) return null;
  return bestOf(devices.filter((d) => !d.caps || keys.some((k) => d.caps![k] === true)), phrase, grammar);
}
function dev1(s: Scored, action: DeviceAction, level?: number): VoiceMatch {
  return { type: 'device', id: s.id, name: s.name, action, ...(level !== undefined ? { level } : {}) };
}

interface DeviceGroup { id: string; ids: string[]; name: string; score: number }
/** Best capable device + EVERY capable device that shares its (normalized)
 *  name, so duplicate-named devices ("Kitchen Lights" ×6) all get the
 *  command instead of just the first. */
function bestDeviceGroup(
  devices: VoiceCatalogDevice[],
  phrase: string,
  key: CapKey,
  grammar: Grammar,
): DeviceGroup | null {
  const best = bestDevice(devices, phrase, key, grammar);
  if (!best) return null;
  const target = normalizeText(best.name);
  const ids = devices
    .filter((d) => capable(d, key) && normalizeText(d.name) === target)
    .map((d) => d.id);
  return { id: best.id, ids, name: best.name, score: best.score };
}
function deviceMatch(g: DeviceGroup, action: DeviceAction, level?: number): VoiceMatch {
  return {
    type: 'device',
    id: g.id,
    ...(g.ids.length > 1 ? { ids: g.ids } : {}),
    name: g.name,
    action,
    ...(level !== undefined ? { level } : {}),
  };
}

/** Level only when there's an explicit cue (a LEVEL word like "percent", or
 *  "to <n>") so a number inside a device name ("Bedroom 2") isn't read as a
 *  brightness. Returns 0–100 or null. */
function extractLevel(tokens: string[], grammar: Grammar): number | null {
  const hasLevelWord = tokens.some((t) => grammar.LEVEL_WORDS.has(t));
  const toIdx = tokens.lastIndexOf('to');
  // Require an explicit cue ("to <n>" or a level word) so a number inside a
  // device name ("Bedroom 2") is never read as a brightness.
  if (!hasLevelWord && toIdx < 0) return null;
  // "set X to 75", "X to twenty percent" — number right after "to".
  if (toIdx >= 0) {
    const n = grammar.parseLevelPercent(tokens.slice(toIdx + 1));
    if (n !== null) return n;
  }
  // "X 20 percent" — number just before the unit word.
  const unitIdx = tokens.findIndex(
    (t) => t === 'percent' || t === 'percentage' || t === 'pct',
  );
  if (unitIdx > 0) {
    const n = grammar.parseLevelPercent(tokens.slice(Math.max(0, unitIdx - 2), unitIdx));
    if (n !== null) return n;
  }
  // "dim X 75" — number right after the level word.
  const lvlIdx = tokens.findIndex((t) => grammar.LEVEL_WORDS.has(t));
  if (lvlIdx >= 0) {
    const n = grammar.parseLevelPercent(tokens.slice(lvlIdx + 1, lvlIdx + 3));
    if (n !== null) return n;
  }
  return null;
}

/**
 * @param transcript final recognizer text
 * @param catalog the user's current scenes / devices / rooms (display names)
 */
export function matchVoiceCommand(
  transcript: string,
  catalog: VoiceCatalog,
  grammar: Grammar = defaultGrammar,
): VoiceMatch {
  const tokens = grammar.tokenize(transcript);
  if (tokens.length === 0) return { type: 'none', reason: 'Nothing heard' };

  const has = (set: Set<string>) => tokens.some((t) => set.has(t));
  const explicitOff = has(grammar.OFF_WORDS);
  const explicitOn = has(grammar.ON_WORDS);
  const wantScene = has(grammar.SCENE_WORDS);
  const wantRoom = has(grammar.ROOM_WORDS);

  // Scene names frequently embed the action ("Lab: OFF", "All Lights On"), so
  // keep on/off words when matching SCENES; strip them for device/room names
  // (the device is "Lab Lights"; the on/off is the separate action).
  const scenePhrase = tokens
    .filter((t) => !grammar.FILLER_WORDS.has(t) && !grammar.SCENE_WORDS.has(t) && !grammar.ROOM_WORDS.has(t))
    .join(' ');
  // Strip every command/verb word so only the entity name remains. Digits are
  // kept (device names like "Bedroom 2"); the dim-level branch uses its own
  // number-stripped phrase.
  const isVerb = (t: string): boolean =>
    grammar.FILLER_WORDS.has(t) || grammar.SCENE_WORDS.has(t) || grammar.ON_WORDS.has(t) ||
    grammar.OFF_WORDS.has(t) || grammar.ROOM_WORDS.has(t) || grammar.OPEN_WORDS.has(t) ||
    grammar.CLOSE_WORDS.has(t) || grammar.LOCK_WORDS.has(t) || grammar.UNLOCK_WORDS.has(t) ||
    grammar.PLAY_WORDS.has(t) || grammar.PAUSE_WORDS.has(t) || grammar.STOP_WORDS.has(t) ||
    grammar.MUTE_WORDS.has(t) || grammar.UNMUTE_WORDS.has(t) || grammar.NEXT_WORDS.has(t) ||
    grammar.PREV_WORDS.has(t) || grammar.VOLUME_WORDS.has(t) || grammar.VOLUME_UP_WORDS.has(t) ||
    grammar.VOLUME_DOWN_WORDS.has(t) || grammar.PRESS_WORDS.has(t) || grammar.WARMER_WORDS.has(t) ||
    grammar.COOLER_WORDS.has(t) || grammar.FASTER_WORDS.has(t) || grammar.SLOWER_WORDS.has(t) ||
    grammar.MODE_HEAT_WORDS.has(t) || grammar.MODE_COOL_WORDS.has(t) ||
    grammar.MODE_AUTO_WORDS.has(t) || grammar.LEVEL_WORDS.has(t);
  const namePhrase = tokens.filter((t) => !isVerb(t)).join(' ');
  const levelNamePhrase = tokens
    .filter((t) => !isVerb(t) && !/^\d{1,3}$/.test(t) && !grammar.NUMBER_WORD_SET.has(t))
    .join(' ');
  if (!scenePhrase && !namePhrase && !levelNamePhrase) {
    return { type: 'none', reason: 'No name in command' };
  }

  // ---- Device-control verbs (resolved against device capabilities) --------
  // These run BEFORE on/off because several words overlap (close=off,
  // open=room-nav, stop=off): a capable device wins; otherwise we fall
  // through so the overloaded word keeps its old meaning.
  const level = explicitOn || explicitOff ? null : extractLevel(tokens, grammar);
  if (level !== null) {
    // Dim a device-group OR a whole room ("kitchen to 30%" = the Kitchen room;
    // "kitchen lights to 30%" = every device named "Kitchen Lights").
    const d = bestDeviceGroup(catalog.devices, levelNamePhrase, 'dimmer', grammar);
    const r = levelNamePhrase ? bestOf(catalog.rooms, levelNamePhrase, grammar) : null;
    if (r && (!d || r.score >= d.score)) {
      return { type: 'room', id: r.id, name: r.name, level };
    }
    if (d) return deviceMatch(d, 'level', level);
    // "set the blinds to 40 percent" → windowShadeLevel (absolute).
    const sh = bestDeviceAny(catalog.devices, levelNamePhrase, ['shadeLevel'], grammar);
    if (sh) return dev1(sh, 'shadeLevel', level);
    // An explicit "set … to N%" with nothing dimmable must NOT silently fall
    // through to on/off — that would fire the wrong action on a wrong device.
    return { type: 'none', reason: `Nothing to set for “${levelNamePhrase}”` };
  }
  if (has(grammar.WARMER_WORDS) || has(grammar.COOLER_WORDS)) {
    // Routed in app.ts: colorTemperature on a bulb, else thermostat setpoint.
    const s = bestDeviceAny(catalog.devices, namePhrase, ['colorTemp', 'thermostatSet'], grammar);
    if (s) return dev1(s, has(grammar.WARMER_WORDS) ? 'warmer' : 'cooler');
    return { type: 'none', reason: `Nothing to adjust for “${namePhrase}”` }; // terminal
  }
  if (has(grammar.FASTER_WORDS) || has(grammar.SLOWER_WORDS)) {
    const s = bestDeviceAny(catalog.devices, namePhrase, ['fanSpeed'], grammar);
    if (s) return dev1(s, has(grammar.FASTER_WORDS) ? 'faster' : 'slower');
    return { type: 'none', reason: `No fan for “${namePhrase}”` }; // terminal
  }
  if (has(grammar.MODE_HEAT_WORDS) || has(grammar.MODE_COOL_WORDS) || has(grammar.MODE_AUTO_WORDS)) {
    const s = bestDeviceAny(catalog.devices, namePhrase, ['thermostatMode'], grammar);
    if (s) {
      const a = has(grammar.MODE_AUTO_WORDS)
        ? 'modeAuto'
        : has(grammar.MODE_COOL_WORDS) ? 'modeCool' : 'modeHeat';
      return dev1(s, a);
    }
    return { type: 'none', reason: `No thermostat for “${namePhrase}”` }; // terminal
  }
  if (has(grammar.LOCK_WORDS) || has(grammar.UNLOCK_WORDS)) {
    const d = bestDeviceGroup(catalog.devices, namePhrase, 'lock', grammar);
    if (d) return deviceMatch(d, has(grammar.UNLOCK_WORDS) ? 'unlock' : 'lock');
  }
  if (has(grammar.NEXT_WORDS) || has(grammar.PREV_WORDS)) {
    const d = bestDeviceGroup(catalog.devices, namePhrase, 'track', grammar);
    // "skip back" → previous (an explicit prev word wins over a next word).
    if (d) return deviceMatch(d, has(grammar.PREV_WORDS) ? 'prev' : 'next');
    // Terminal only for an unambiguous track word ("office next") — never fall
    // through to a default power-on. A weak-only phrase ("back porch") falls
    // through so it can still match a normal device/room.
    if (has(grammar.TRACK_STRONG_WORDS)) {
      return { type: 'none', reason: `Nothing to skip for “${namePhrase}”` };
    }
  }
  if (has(grammar.PLAY_WORDS) || has(grammar.PAUSE_WORDS) || has(grammar.STOP_WORDS)) {
    const d = bestDeviceGroup(catalog.devices, namePhrase, 'media', grammar);
    if (d) return deviceMatch(d, has(grammar.PAUSE_WORDS) ? 'pause' : has(grammar.STOP_WORDS) ? 'stop' : 'play');
  }
  if (has(grammar.MUTE_WORDS) || has(grammar.UNMUTE_WORDS)) {
    const d = bestDeviceGroup(catalog.devices, namePhrase, 'mute', grammar);
    if (d) return deviceMatch(d, has(grammar.UNMUTE_WORDS) ? 'unmute' : 'mute');
  }
  if (has(grammar.VOLUME_WORDS)) {
    const d = bestDeviceGroup(catalog.devices, namePhrase, 'volume', grammar);
    if (d) return deviceMatch(d, has(grammar.VOLUME_DOWN_WORDS) ? 'volumeDown' : 'volumeUp');
    return { type: 'none', reason: `No speaker for “${namePhrase}”` }; // terminal
  }
  if (has(grammar.PRESS_WORDS)) {
    const d = bestDeviceGroup(catalog.devices, namePhrase, 'press', grammar);
    if (d) return deviceMatch(d, 'press');
    return { type: 'none', reason: `Nothing to press for “${namePhrase}”` }; // terminal
  }
  if (has(grammar.OPEN_WORDS) || has(grammar.CLOSE_WORDS)) {
    const d = bestDeviceGroup(catalog.devices, namePhrase, 'openClose', grammar);
    if (d) return deviceMatch(d, has(grammar.CLOSE_WORDS) ? 'close' : 'open');
  }
  // ------------------------------------------------------------------------

  const sceneR = scenePhrase ? bestOf(catalog.scenes, scenePhrase, grammar) : null;
  const deviceG = bestDeviceGroup(catalog.devices, namePhrase, 'switch', grammar);
  const deviceR = deviceG ? { id: deviceG.id, name: deviceG.name, score: deviceG.score } : null;
  const roomR = namePhrase ? bestOf(catalog.rooms, namePhrase, grammar) : null;

  // Explicit on/off ⇒ an action-named scene ("Lab: OFF"), a single device, or
  // a whole room ("office on" = switch every switchable device in the room).
  // Pick the strongest; on ties prefer scene → device → room (most specific
  // configured intent first) so a weak generic overlap can't win.
  if (explicitOff || explicitOn) {
    const action: 'on' | 'off' = explicitOff ? 'off' : 'on';
    const candidates = [
      sceneR ? { kind: 'scene' as const, ...sceneR } : null,
      deviceR ? { kind: 'device' as const, ...deviceR } : null,
      roomR ? { kind: 'room' as const, ...roomR } : null,
    ].filter((x): x is NonNullable<typeof x> => x !== null);
    // Stable priority on equal scores: scene, device, room.
    const rank = { scene: 0, device: 1, room: 2 };
    candidates.sort((a, b) => b.score - a.score || rank[a.kind] - rank[b.kind]);
    const top = candidates[0];
    if (!top) return { type: 'none', reason: `No match for “${namePhrase || scenePhrase}”` };
    if (top.kind === 'scene') return { type: 'scene', id: top.id, name: top.name };
    if (top.kind === 'device') return deviceMatch(deviceG!, action);
    return { type: 'room', id: top.id, name: top.name, action };
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
  return deviceMatch(deviceG!, 'on');
}
