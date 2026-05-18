import { describe, it, expect } from 'vitest';
import { matchVoiceCommand, scoreName, type VoiceCatalog } from './match';

// @regression — the voice resolver product rules:
//  • "run/activate <name>" or a bare scene name → run that scene
//  • "turn on/off <name>", or a bare device name → device on/off (default on)
//  • "open <room>" / room verb → open that room's device list
//  • fuzzy: command/filler words stripped, misheard words tolerated
//  • always commit to the single best guess (no unanswerable "did you mean"
//    prompt — on-device there's no way to reply); nothing close → none
const catalog: VoiceCatalog = {
  scenes: [
    { id: 's1', name: 'Movie Night' },
    { id: 's2', name: 'Good Morning' },
  ],
  devices: [
    { id: 'd1', name: 'Living Room Lamp' },
    { id: 'd2', name: 'Kitchen Lights' },
  ],
  rooms: [
    { id: 'r1', name: 'Bedroom' },
    { id: 'r2', name: 'Garage' },
  ],
};

describe('@regression matchVoiceCommand', () => {
  it('runs a scene by explicit verb', () => {
    expect(matchVoiceCommand('run movie night', catalog)).toEqual({
      type: 'scene', id: 's1', name: 'Movie Night',
    });
    expect(matchVoiceCommand('activate good morning', catalog)).toEqual({
      type: 'scene', id: 's2', name: 'Good Morning',
    });
  });

  it('runs a scene from a bare name (no verb) when it is the strongest match', () => {
    expect(matchVoiceCommand('movie night', catalog)).toEqual({
      type: 'scene', id: 's1', name: 'Movie Night',
    });
  });

  it('turns a device on / off with explicit intent', () => {
    expect(matchVoiceCommand('turn on kitchen lights', catalog)).toEqual({
      type: 'device', id: 'd2', name: 'Kitchen Lights', action: 'on',
    });
    expect(matchVoiceCommand('turn off living room lamp', catalog)).toEqual({
      type: 'device', id: 'd1', name: 'Living Room Lamp', action: 'off',
    });
  });

  it('a bare device name defaults to turning it on', () => {
    expect(matchVoiceCommand('living room lamp', catalog)).toEqual({
      type: 'device', id: 'd1', name: 'Living Room Lamp', action: 'on',
    });
  });

  it('opens a room with a room verb', () => {
    expect(matchVoiceCommand('open bedroom', catalog)).toEqual({
      type: 'room', id: 'r1', name: 'Bedroom',
    });
    expect(matchVoiceCommand('go to garage', catalog)).toEqual({
      type: 'room', id: 'r2', name: 'Garage',
    });
  });

  it('tolerates filler words and minor mis-recognition', () => {
    expect(matchVoiceCommand('please run the movie night scene', catalog)).toMatchObject({
      type: 'scene', id: 's1',
    });
    // "kitchen lites" → still matches "Kitchen Lights"
    expect(matchVoiceCommand('turn on kitchen lites', catalog)).toMatchObject({
      type: 'device', id: 'd2', action: 'on',
    });
  });

  it('reports none when nothing is close (no mis-fire)', () => {
    expect(matchVoiceCommand('quantum flux capacitor', catalog).type).toBe('none');
    expect(matchVoiceCommand('', catalog).type).toBe('none');
    expect(matchVoiceCommand('turn on', catalog).type).toBe('none');
  });

  it('commits to the single best guess for near-tied candidates (no prompt)', () => {
    const amb: VoiceCatalog = {
      scenes: [], rooms: [],
      devices: [
        { id: 'a', name: 'Office Light' },
        { id: 'b', name: 'Office Lights' },
      ],
    };
    // Never returns an unanswerable "ambiguous" — always a concrete action.
    expect(matchVoiceCommand('turn on office light', amb)).toEqual({
      type: 'device', id: 'a', name: 'Office Light', action: 'on',
    });
  });

  it('an action-named scene wins over a weak device match (Lab: OFF bug)', () => {
    // Real-world catalog: a "Lab: OFF" scene + a "Lab" room + an unrelated
    // "Hallway Lights" device (no "Lab Lights" device exists). Before the fix
    // "turn lab lights off" mis-fired "Hallway Lights → off" (shared "lights").
    const cat: VoiceCatalog = {
      scenes: [{ id: 'labOff', name: 'Lab: OFF' }],
      rooms: [{ id: 'labRoom', name: 'Lab' }],
      devices: [{ id: 'hall', name: 'Hallway Lights' }],
    };
    expect(matchVoiceCommand('turn lab lights off', cat)).toEqual({
      type: 'scene', id: 'labOff', name: 'Lab: OFF',
    });
    expect(matchVoiceCommand('lab lights off', cat)).toEqual({
      type: 'scene', id: 'labOff', name: 'Lab: OFF',
    });
    // And a genuinely unrelated "off" command must NOT grab Hallway Lights.
    expect(matchVoiceCommand('turn off the thingamajig', cat).type).toBe('none');
  });

  it('keeps "room" as a name token so "family room" scenes win (Family Room: OFF bug)', () => {
    // "room" must NOT be stripped as a command word, or "turn off family room
    // lights" loses the token that separates "Family Room: OFF" from the
    // generic "All lights: OFF" and the wrong scene fires.
    const cat: VoiceCatalog = {
      scenes: [
        { id: 'allOff', name: 'All lights: OFF' },
        { id: 'famOff', name: 'Family Room: OFF' },
      ],
      rooms: [{ id: 'fam', name: 'Family Room' }],
      devices: [],
    };
    expect(matchVoiceCommand('turn off family room lights', cat)).toEqual({
      type: 'scene', id: 'famOff', name: 'Family Room: OFF',
    });
    // Order in the catalog must not change the winner.
    const cat2: VoiceCatalog = {
      ...cat,
      scenes: [
        { id: 'famOff', name: 'Family Room: OFF' },
        { id: 'allOff', name: 'All lights: OFF' },
      ],
    };
    expect(matchVoiceCommand('turn off family room lights', cat2)).toEqual({
      type: 'scene', id: 'famOff', name: 'Family Room: OFF',
    });
  });

  it('"<room> on/off" switches the whole room (no matching scene/device)', () => {
    const cat: VoiceCatalog = {
      scenes: [], devices: [],
      rooms: [{ id: 'off1', name: 'Office' }],
    };
    expect(matchVoiceCommand('office on', cat)).toEqual({
      type: 'room', id: 'off1', name: 'Office', action: 'on',
    });
    expect(matchVoiceCommand('turn off office', cat)).toEqual({
      type: 'room', id: 'off1', name: 'Office', action: 'off',
    });
  });

  it('a specific device still beats the room for on/off', () => {
    const cat: VoiceCatalog = {
      scenes: [],
      devices: [{ id: 'ol', name: 'Office Lights' }],
      rooms: [{ id: 'off1', name: 'Office' }],
    };
    // "office lights on" → the device (exact 1.0) over the room (~0.85).
    expect(matchVoiceCommand('turn on office lights', cat)).toEqual({
      type: 'device', id: 'ol', name: 'Office Lights', action: 'on',
    });
  });

  it('room navigation (open / go to) carries NO action — just opens the room', () => {
    const cat: VoiceCatalog = {
      scenes: [], devices: [],
      rooms: [{ id: 'off1', name: 'Office' }],
    };
    expect(matchVoiceCommand('open office', cat)).toEqual({
      type: 'room', id: 'off1', name: 'Office',
    });
  });

  it('room navigation still works via real verbs (open / go to), not "room"', () => {
    const cat: VoiceCatalog = {
      scenes: [], devices: [],
      rooms: [{ id: 'r', name: 'Family Room' }],
    };
    expect(matchVoiceCommand('open family room', cat)).toEqual({
      type: 'room', id: 'r', name: 'Family Room',
    });
    expect(matchVoiceCommand('go to family room', cat)).toEqual({
      type: 'room', id: 'r', name: 'Family Room',
    });
  });

  it('a strong device match still wins for on/off when no scene fits', () => {
    const cat: VoiceCatalog = {
      scenes: [{ id: 's', name: 'Movie Night' }],
      rooms: [],
      devices: [{ id: 'kl', name: 'Kitchen Lights' }],
    };
    expect(matchVoiceCommand('turn off kitchen lights', cat)).toEqual({
      type: 'device', id: 'kl', name: 'Kitchen Lights', action: 'off',
    });
  });

  it('dim/level: "set living room lights to 20 percent" → device level 20', () => {
    const cat: VoiceCatalog = {
      scenes: [], rooms: [],
      devices: [{ id: 'lrl', name: 'Living Room Lights', caps: { switch: true, dimmer: true } }],
    };
    expect(matchVoiceCommand('set living room lights to 20 percent', cat)).toEqual({
      type: 'device', id: 'lrl', name: 'Living Room Lights', action: 'level', level: 20,
    });
    expect(matchVoiceCommand('turn living room lights to twenty percent', cat)).toEqual({
      type: 'device', id: 'lrl', name: 'Living Room Lights', action: 'level', level: 20,
    });
    expect(matchVoiceCommand('dim living room lights to 75', cat)).toMatchObject({
      type: 'device', action: 'level', level: 75,
    });
  });

  it('a non-dimmable device is NOT level-matched (capability gated)', () => {
    const cat: VoiceCatalog = {
      scenes: [], rooms: [],
      devices: [{ id: 'p', name: 'Porch Light', caps: { switch: true, dimmer: false } }],
    };
    // No dimmer cap → not a level match; falls through to none (no on/off word).
    expect(matchVoiceCommand('set porch light to 30 percent', cat).type).toBe('none');
  });

  it('device controls resolve by capability (garage / lock / media / mute)', () => {
    const cat: VoiceCatalog = {
      scenes: [], rooms: [],
      devices: [
        { id: 'gd', name: 'Garage Door', caps: { openClose: true } },
        { id: 'fd', name: 'Front Door', caps: { lock: true } },
        { id: 'sp', name: 'Living Room Speaker', caps: { media: true, mute: true } },
      ],
    };
    expect(matchVoiceCommand('open garage door', cat)).toEqual({
      type: 'device', id: 'gd', name: 'Garage Door', action: 'open',
    });
    expect(matchVoiceCommand('close the garage door', cat)).toEqual({
      type: 'device', id: 'gd', name: 'Garage Door', action: 'close',
    });
    expect(matchVoiceCommand('lock front door', cat)).toEqual({
      type: 'device', id: 'fd', name: 'Front Door', action: 'lock',
    });
    expect(matchVoiceCommand('unlock the front door', cat)).toEqual({
      type: 'device', id: 'fd', name: 'Front Door', action: 'unlock',
    });
    expect(matchVoiceCommand('pause living room speaker', cat)).toEqual({
      type: 'device', id: 'sp', name: 'Living Room Speaker', action: 'pause',
    });
    expect(matchVoiceCommand('play the living room speaker', cat)).toMatchObject({
      type: 'device', id: 'sp', action: 'play',
    });
    expect(matchVoiceCommand('mute living room speaker', cat)).toEqual({
      type: 'device', id: 'sp', name: 'Living Room Speaker', action: 'mute',
    });
  });

  it('overloaded verbs fall back when no capable device matches', () => {
    // "close" with no openClose device must still mean OFF (existing behavior),
    // and "open <room>" with no openClose device still navigates the room.
    const cat: VoiceCatalog = {
      scenes: [],
      devices: [{ id: 'kl', name: 'Kitchen Lights', caps: { switch: true } }],
      rooms: [{ id: 'k', name: 'Kitchen' }],
    };
    expect(matchVoiceCommand('close kitchen lights', cat)).toEqual({
      type: 'device', id: 'kl', name: 'Kitchen Lights', action: 'off',
    });
    expect(matchVoiceCommand('open kitchen', cat)).toEqual({
      type: 'room', id: 'k', name: 'Kitchen',
    });
  });

  it('duplicate-named devices ALL receive the command (6× "Kitchen Lights")', () => {
    const cat: VoiceCatalog = {
      scenes: [], rooms: [{ id: 'kr', name: 'Kitchen' }],
      devices: Array.from({ length: 6 }, (_, i) => ({
        id: `kl${i}`, name: 'Kitchen Lights', caps: { switch: true, dimmer: true },
      })),
    };
    const lvl = matchVoiceCommand('turn kitchen lights to 30 percent', cat);
    expect(lvl).toMatchObject({ type: 'device', name: 'Kitchen Lights', action: 'level', level: 30 });
    expect(lvl.type === 'device' && lvl.ids).toEqual(['kl0', 'kl1', 'kl2', 'kl3', 'kl4', 'kl5']);

    const off = matchVoiceCommand('turn off kitchen lights', cat);
    expect(off).toMatchObject({ type: 'device', name: 'Kitchen Lights', action: 'off' });
    expect(off.type === 'device' && off.ids?.length).toBe(6);
  });

  it('"<room> to N%" dims the whole room, not one same-named light', () => {
    const cat: VoiceCatalog = {
      scenes: [],
      rooms: [{ id: 'kr', name: 'Kitchen' }],
      devices: [{ id: 'kl', name: 'Kitchen Lights', caps: { switch: true, dimmer: true } }],
    };
    // "kitchen" (room) outscores "Kitchen Lights" (device) → room-level dim.
    expect(matchVoiceCommand('turn kitchen to 30 percent', cat)).toEqual({
      type: 'room', id: 'kr', name: 'Kitchen', level: 30,
    });
    // But naming the device keeps it device-level.
    expect(matchVoiceCommand('turn kitchen lights to 30 percent', cat)).toMatchObject({
      type: 'device', id: 'kl', action: 'level', level: 30,
    });
  });

  it('a single matched device carries no ids array (back-compat)', () => {
    const cat: VoiceCatalog = {
      scenes: [], rooms: [],
      devices: [{ id: 'd', name: 'Porch Light', caps: { switch: true } }],
    };
    const r = matchVoiceCommand('turn on porch light', cat);
    expect(r).toEqual({ type: 'device', id: 'd', name: 'Porch Light', action: 'on' });
    expect(r.type === 'device' && 'ids' in r).toBe(false);
  });

  it('media track control: next / previous on a named speaker', () => {
    const cat: VoiceCatalog = {
      scenes: [], rooms: [],
      devices: [{ id: 'sp', name: 'Office', caps: { media: true, track: true } }],
    };
    expect(matchVoiceCommand('office next', cat)).toEqual({
      type: 'device', id: 'sp', name: 'Office', action: 'next',
    });
    expect(matchVoiceCommand('skip office', cat)).toMatchObject({ type: 'device', id: 'sp', action: 'next' });
    expect(matchVoiceCommand('office forward', cat)).toMatchObject({ action: 'next' });
    expect(matchVoiceCommand('previous office', cat)).toMatchObject({ type: 'device', id: 'sp', action: 'prev' });
    expect(matchVoiceCommand('office prev', cat)).toMatchObject({ action: 'prev' });
    expect(matchVoiceCommand('go back on office', cat)).toMatchObject({ action: 'prev' });
    // "skip back" → previous (explicit prev word wins).
    expect(matchVoiceCommand('skip back office', cat)).toMatchObject({ action: 'prev' });
  });

  it('track control needs the capability (no mediaTrackControl ⇒ not matched)', () => {
    const cat: VoiceCatalog = {
      scenes: [], rooms: [],
      devices: [{ id: 'l', name: 'Office', caps: { switch: true, track: false } }],
    };
    // "office next" with no track cap shouldn't skip; falls through to none.
    expect(matchVoiceCommand('office next', cat).type).toBe('none');
  });

  it('volume / press / synonyms (command-surface review additions)', () => {
    const cat: VoiceCatalog = {
      scenes: [],
      rooms: [],
      devices: [
        { id: 'sp', name: 'Office', caps: { media: true, mute: true, volume: true } },
        { id: 'btn', name: 'Doorbell', caps: { press: true } },
        { id: 'lk', name: 'Front Door', caps: { lock: true } },
        { id: 'pl', name: 'Porch Light', caps: { switch: true } },
      ],
    };
    // Volume
    expect(matchVoiceCommand('volume up office', cat)).toMatchObject({ type: 'device', id: 'sp', action: 'volumeUp' });
    expect(matchVoiceCommand('turn down the office volume', cat)).toMatchObject({ id: 'sp', action: 'volumeDown' });
    expect(matchVoiceCommand('office louder', cat)).toMatchObject({ id: 'sp', action: 'volumeUp' });
    expect(matchVoiceCommand('office quieter', cat)).toMatchObject({ id: 'sp', action: 'volumeDown' });
    // Momentary press
    expect(matchVoiceCommand('press doorbell', cat)).toMatchObject({ id: 'btn', action: 'press' });
    expect(matchVoiceCommand('push the doorbell', cat)).toMatchObject({ id: 'btn', action: 'press' });
    // Lock synonym
    expect(matchVoiceCommand('secure front door', cat)).toMatchObject({ id: 'lk', action: 'lock' });
    expect(matchVoiceCommand('unsecure the front door', cat)).toMatchObject({ id: 'lk', action: 'unlock' });
    // Play synonyms
    expect(matchVoiceCommand('resume office', cat)).toMatchObject({ id: 'sp', action: 'play' });
    expect(matchVoiceCommand('continue the office', cat)).toMatchObject({ id: 'sp', action: 'play' });
    // "power on/off" filler
    expect(matchVoiceCommand('power on porch light', cat)).toEqual({
      type: 'device', id: 'pl', name: 'Porch Light', action: 'on',
    });
    // Terminal: a volume command with no speaker doesn't fall back to on.
    expect(matchVoiceCommand('volume up porch light', cat).type).toBe('none');
  });

  it('relative-from-state controls (color temp / fan / shade level / thermostat)', () => {
    const cat: VoiceCatalog = {
      scenes: [], rooms: [{ id: 'lr', name: 'Living Room' }],
      devices: [
        { id: 'bulb', name: 'Living Room Lamp', caps: { switch: true, dimmer: true, colorTemp: true } },
        { id: 'fan', name: 'Ceiling Fan', caps: { switch: true, fanSpeed: true } },
        { id: 'bl', name: 'Office Blinds', caps: { openClose: true, shadeLevel: true } },
        { id: 'th', name: 'Hallway Thermostat', caps: { thermostatSet: true, thermostatMode: true } },
      ],
    };
    // Color temperature
    expect(matchVoiceCommand('make the living room lamp warmer', cat)).toMatchObject({
      type: 'device', id: 'bulb', action: 'warmer',
    });
    expect(matchVoiceCommand('living room lamp cooler', cat)).toMatchObject({ id: 'bulb', action: 'cooler' });
    // Fan speed
    expect(matchVoiceCommand('ceiling fan faster', cat)).toMatchObject({ id: 'fan', action: 'faster' });
    expect(matchVoiceCommand('slower ceiling fan', cat)).toMatchObject({ id: 'fan', action: 'slower' });
    // Window-shade level (absolute %)
    expect(matchVoiceCommand('set office blinds to 40 percent', cat)).toMatchObject({
      type: 'device', id: 'bl', action: 'shadeLevel', level: 40,
    });
    // Thermostat setpoint (warmer/cooler routed by capability in app.ts)
    expect(matchVoiceCommand('hallway thermostat warmer', cat)).toMatchObject({ id: 'th', action: 'warmer' });
    // Thermostat mode
    expect(matchVoiceCommand('set hallway thermostat to heat', cat)).toMatchObject({ id: 'th', action: 'modeHeat' });
    expect(matchVoiceCommand('hallway thermostat cool', cat)).toMatchObject({ id: 'th', action: 'modeCool' });
    expect(matchVoiceCommand('hallway thermostat auto', cat)).toMatchObject({ id: 'th', action: 'modeAuto' });
  });

  it('relative-from-state verbs are terminal & capability-gated', () => {
    const cat: VoiceCatalog = {
      scenes: [], rooms: [],
      devices: [{ id: 'p', name: 'Porch Light', caps: { switch: true } }],
    };
    // No colorTemp/fan/thermostat device → "no match", never a stray power-on.
    expect(matchVoiceCommand('porch light warmer', cat).type).toBe('none');
    expect(matchVoiceCommand('porch light faster', cat).type).toBe('none');
    expect(matchVoiceCommand('set porch light to heat', cat).type).toBe('none');
  });

  it('scoreName is 1 for exact and lower for partial', () => {
    expect(scoreName('movie night', 'Movie Night')).toBe(1);
    expect(scoreName('movie', 'Movie Night')).toBeLessThan(1);
    expect(scoreName('xyz', 'Movie Night')).toBeLessThan(0.5);
  });

  it('a shared DISTINCTIVE word beats a shared GENERIC word', () => {
    // Even with "room" stripped, "off family lights" must score the
    // family-specific scene above the catch-all (the only shared word with
    // "All lights: OFF" is the generic "lights"/"off").
    const fam = scoreName('off family lights', 'Family Room: OFF');
    const all = scoreName('off family lights', 'All lights: OFF');
    expect(fam).toBeGreaterThan(all);
    // And a generic-only overlap stays weak (no mis-fire).
    expect(scoreName('lab lights', 'Hallway Lights')).toBeLessThan(0.6);
  });
});
