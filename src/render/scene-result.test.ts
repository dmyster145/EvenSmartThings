import { describe, it, expect } from 'vitest';
import { classifySceneResult } from './scene-result';

// @regression — scene confirmation icon mapping. Locks the product rule:
// ✓ all succeed · ! mixed · ✗ all error / single error. The old code only
// counted 'ACCEPTED'|'COMPLETED' as success, so any other success status
// collapsed to ✗ and ! never appeared.
describe('@regression classifySceneResult', () => {
  it('all devices succeed (no FAILED) ⇒ success', () => {
    expect(classifySceneResult({ results: [{ status: 'COMPLETED' }, { status: 'ACCEPTED' }] })).toBe('success');
  });

  it('success with non-ACCEPTED/COMPLETED status strings still counts as success', () => {
    expect(classifySceneResult({ results: [{ status: 'OK' }, { status: 'EXECUTED' }] })).toBe('success');
    expect(classifySceneResult({ results: [{}, { status: undefined }] })).toBe('success');
  });

  it('every device FAILED ⇒ failure', () => {
    expect(classifySceneResult({ results: [{ status: 'FAILED' }, { status: 'FAILED' }] })).toBe('failure');
  });

  it('single device that FAILED ⇒ failure', () => {
    expect(classifySceneResult({ results: [{ status: 'FAILED' }] })).toBe('failure');
  });

  it('single device that succeeded ⇒ success', () => {
    expect(classifySceneResult({ results: [{ status: 'COMPLETED' }] })).toBe('success');
  });

  it('mixed success + FAILED ⇒ partial (!)', () => {
    expect(classifySceneResult({ results: [{ status: 'COMPLETED' }, { status: 'FAILED' }] })).toBe('partial');
    expect(classifySceneResult({ results: [{ status: 'FAILED' }, { status: 'OK' }, { status: 'FAILED' }] })).toBe('partial');
  });

  it('no per-device results ⇒ falls back to coarse status', () => {
    expect(classifySceneResult({ status: 'success' })).toBe('success');
    expect(classifySceneResult({ status: 'partial' })).toBe('partial');
    expect(classifySceneResult({ status: 'completed_with_errors' })).toBe('partial');
    expect(classifySceneResult({ status: 'whatever' })).toBe('failure');
    expect(classifySceneResult({})).toBe('failure');
    expect(classifySceneResult(null)).toBe('failure');
    expect(classifySceneResult({ results: [] })).toBe('failure'); // empty array ⇒ no breakdown
  });
});
