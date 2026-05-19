import { describe, it, expect } from 'vitest';
import { createGrammar, defaultGrammar, SCENE_WORDS, tokenize, parseLevelPercent } from './grammar';
import { defaultVoiceConfig } from './config';

// Unit — the createGrammar factory must be behavior-preserving vs the legacy
// hard-coded module: defaultGrammar (built from defaultVoiceConfig) is what
// every existing importer/test now uses via shims.
describe('createGrammar factory', () => {
  it('defaultGrammar Sets match the bundled config', () => {
    expect([...defaultGrammar.SCENE_WORDS].sort()).toEqual([...defaultVoiceConfig.sceneWords].sort());
    // Legacy shim export is the same Set instance.
    expect(SCENE_WORDS).toBe(defaultGrammar.SCENE_WORDS);
    expect(defaultGrammar.matchMin).toBe(0.6);
    expect(defaultGrammar.genericTokenWeight).toBe(0.35);
  });

  it('NUMBER_WORD_SET is derived from ones + tens + extras', () => {
    expect(defaultGrammar.NUMBER_WORD_SET.has('five')).toBe(true);
    expect(defaultGrammar.NUMBER_WORD_SET.has('twenty')).toBe(true);
    expect(defaultGrammar.NUMBER_WORD_SET.has('hundred')).toBe(true);
    expect(defaultGrammar.NUMBER_WORD_SET.has('half')).toBe(true);
  });

  it('tokenize maps digit-words via the config; parseLevelPercent reads its maps', () => {
    expect(defaultGrammar.tokenize('turn on five')).toEqual(['turn', 'on', '5']);
    expect(defaultGrammar.parseLevelPercent(['twenty', '5'])).toBe(25);
    // Legacy free-function shims delegate to defaultGrammar.
    expect(tokenize('to ten')).toEqual(['to', '10']);
    expect(parseLevelPercent(['half'])).toBe(50);
  });

  it('number parsing is data-driven (a config without "twenty" cannot parse it)', () => {
    const noTwenty = createGrammar({
      ...defaultVoiceConfig,
      tensWords: { thirty: 30 }, // 'twenty' removed
    });
    expect(noTwenty.parseLevelPercent(['twenty'])).toBeNull();
    expect(defaultGrammar.parseLevelPercent(['twenty'])).toBe(20);
  });
});
