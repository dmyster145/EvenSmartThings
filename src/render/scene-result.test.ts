import { describe, it, expect } from 'vitest';
import { classifySceneResult } from './scene-result';

// @regression — scene confirmation icon mapping.
//
// Confirmed empirically (v1.4.20 device logs): the SmartThings scene-execute
// endpoint returns NO per-device data — just `{ "status": "success"|"failure" }`.
// It cannot distinguish "1 device failed" from "all failed". So the locked
// product rule for scenes is:
//   ✓ status 'success'
//   ! any other non-empty status (ran, but SmartThings flags not-clean — we
//     cannot know how many devices failed)
//   ✗ null / empty 200 body with no status (and, via the caller's catch path,
//     network/HTTP/auth failures — "couldn't run the scene")
// The per-device results[] branch is retained/tested only to future-proof a
// hypothetical account that returns an array (FAILED = error, mixed = partial).
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

  it('no per-device results ⇒ coarse status: success→✓, any other non-empty status→!', () => {
    expect(classifySceneResult({ status: 'success' })).toBe('success');
    // The real-world case: SmartThings returns {status:"failure"} for a scene
    // whose devices partly worked — no per-device detail exists. Show ! not ✗.
    expect(classifySceneResult({ status: 'failure' })).toBe('partial');
    expect(classifySceneResult({ status: 'partial' })).toBe('partial');
    expect(classifySceneResult({ status: 'completed_with_errors' })).toBe('partial');
    expect(classifySceneResult({ status: 'whatever' })).toBe('partial');
  });

  it('no status at all ⇒ failure (✗ — "couldn\'t run the scene")', () => {
    expect(classifySceneResult({})).toBe('failure');
    expect(classifySceneResult(null)).toBe('failure');
    expect(classifySceneResult(undefined)).toBe('failure');
    expect(classifySceneResult({ results: [] })).toBe('failure'); // empty array ⇒ no breakdown
  });
});
