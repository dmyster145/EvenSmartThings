import { describe, it, expect } from 'vitest';
import { defaultVoiceConfig, serializeVoiceConfig, parseVoiceConfig } from './config';
import { createGrammar } from './grammar';
import { matchVoiceCommand, type VoiceCatalog } from './match';

// @smoke — end-to-end of the config pipeline with no network/DOM:
// serialized blob → parseVoiceConfig → createGrammar → matchVoiceCommand.
describe('@smoke voice config pipeline', () => {
  const cat: VoiceCatalog = {
    scenes: [],
    rooms: [],
    devices: [{ id: 'kl', name: 'Kitchen Lights', caps: { switch: true } }],
  };

  it('a downloaded synonym fires; a removed default no longer does (replace, not merge)', () => {
    // Replace the OFF vocabulary: only "disengage" means off now.
    const blob = serializeVoiceConfig({ ...defaultVoiceConfig, offWords: ['disengage'] });
    const g = createGrammar(parseVoiceConfig(blob)!);
    expect(matchVoiceCommand('disengage kitchen lights', cat, g)).toMatchObject({
      type: 'device', id: 'kl', action: 'off',
    });
    // "off" is no longer an OFF word → it can't turn the device off (a merge
    // would still honor the bundled "off"; replacement must not).
    const r = matchVoiceCommand('turn off kitchen lights', cat, g);
    expect(r.type === 'device' && r.action).toBe('on'); // bare-name default, NOT 'off'
  });

  it('offline fallback chain: empty/corrupt cache → null (caller keeps bundled)', () => {
    expect(parseVoiceConfig('')).toBeNull();
    expect(parseVoiceConfig('not json at all')).toBeNull();
    // A valid blob still parses (cache hit path).
    expect(parseVoiceConfig(serializeVoiceConfig(defaultVoiceConfig))).toEqual(defaultVoiceConfig);
  });
});
