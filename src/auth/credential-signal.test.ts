import { describe, it, expect } from 'vitest';
import { hasCredentialSignal } from './credential-signal';

// @regression — locks the optimistic-startup predicate. The optimistic path
// and the session-failure fallback path BOTH consume this; if they ever
// disagree, the "Could not reach server" dead-end / 22s "Scene/Scene" bugs
// regress.
describe('@regression hasCredentialSignal', () => {
  it('is false only when every signal is absent', () => {
    expect(hasCredentialSignal({})).toBe(false);
    expect(hasCredentialSignal({ restoredToken: null, urlSessionToken: null, pendingId: null })).toBe(false);
    expect(hasCredentialSignal({ restoredToken: '', urlSessionToken: '', pendingId: '' })).toBe(false);
  });

  it('is true when any single signal is present', () => {
    expect(hasCredentialSignal({ restoredToken: 'tok' })).toBe(true);
    expect(hasCredentialSignal({ urlSessionToken: '_st123' })).toBe(true);
    expect(hasCredentialSignal({ pendingId: 'a4f0e1e9' })).toBe(true);
  });

  it('is true when multiple signals are present', () => {
    expect(hasCredentialSignal({ restoredToken: 't', pendingId: 'p' })).toBe(true);
  });
});
