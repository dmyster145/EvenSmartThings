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
