/**
 * Voice config served by GET /api/voice-config.
 *
 * This is the DATA half of the voice grammar (word lists + tunables). Editing
 * this file + `vercel deploy --prod` ships vocabulary/threshold/timing changes
 * to all wearers WITHOUT a client `.ehpk` repack or Even Hub portal re-review.
 * The client validates this defensively (src/voice/config.ts parseVoiceConfig)
 * and falls back to its bundled copy if anything is off, so it can never brick
 * the offline recognizer. Keep `v` in sync with SCHEMA_VERSION in
 * src/voice/config.ts, and keep the values in sync with `defaultVoiceConfig`
 * there (a regression test asserts they match).
 *
 * Future: swap the handler to read Vercel Edge Config for deploy-free edits —
 * the client contract (GET /api/voice-config) does not change.
 */
export const VOICE_CONFIG_PAYLOAD = {
  v: 1,
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
