import { describe, it, expect } from 'vitest';
import { classifyTap, createInitialTapState, type TapConfig } from './tap-dedup';

// @regression — the real click-dedup algorithm (extracted from initApp's
// handleHubEvent closure). Previously this could only be tested via a shadow
// re-implementation in composer.test.ts. Locks: duplicate-tap accumulation,
// new-item reset, and the "skip commit because the user is scrolling"
// heuristic that the firmware-double-CLICK fix depends on.

const CFG: TapConfig = { scrollWindowMs: 400, tapWindowMs: 800 };

describe('@regression classifyTap', () => {
  it('first tap on an item starts tapCount at the gesture count', () => {
    const r = classifyTap(createInitialTapState(), { listIndex: 2, gestureTaps: 1, now: 1000 }, CFG);
    expect(r.next.tapCount).toBe(1);
    expect(r.next.lastTapIndex).toBe(2);
    expect(r.skipCommitForScroll).toBe(false);
  });

  it('repeated taps on the SAME item within the tap window accumulate (capped at 4)', () => {
    let st = createInitialTapState();
    st = classifyTap(st, { listIndex: 2, gestureTaps: 1, now: 1000 }, CFG).next;
    st = classifyTap(st, { listIndex: 2, gestureTaps: 1, now: 1100 }, CFG).next;
    expect(st.tapCount).toBe(2);
    st = classifyTap(st, { listIndex: 2, gestureTaps: 1, now: 1200 }, CFG).next;
    st = classifyTap(st, { listIndex: 2, gestureTaps: 1, now: 1300 }, CFG).next;
    st = classifyTap(st, { listIndex: 2, gestureTaps: 1, now: 1400 }, CFG).next;
    expect(st.tapCount).toBe(4); // capped
  });

  it('a double-tap gesture on the same item adds 2', () => {
    let st = classifyTap(createInitialTapState(), { listIndex: 0, gestureTaps: 1, now: 1000 }, CFG).next;
    st = classifyTap(st, { listIndex: 0, gestureTaps: 2, now: 1100 }, CFG).next;
    expect(st.tapCount).toBe(3);
  });

  it('tapping a NEW item resets tapCount and moves lastTapIndex', () => {
    let st = classifyTap(createInitialTapState(), { listIndex: 2, gestureTaps: 1, now: 1000 }, CFG).next;
    st = classifyTap(st, { listIndex: 2, gestureTaps: 1, now: 1100 }, CFG).next; // count 2
    const r = classifyTap(st, { listIndex: 5, gestureTaps: 1, now: 1200 }, CFG);
    expect(r.next.tapCount).toBe(1);
    expect(r.next.lastTapIndex).toBe(5);
  });

  it('same item after the tap window is treated as a fresh tap (count resets)', () => {
    const st = classifyTap(createInitialTapState(), { listIndex: 3, gestureTaps: 1, now: 1000 }, CFG).next;
    const r = classifyTap(st, { listIndex: 3, gestureTaps: 1, now: 1000 + 801 }, CFG);
    expect(r.next.tapCount).toBe(1);
  });

  it('skips commit when sweeping across ≥2 distinct items within the scroll window (likely scrolling)', () => {
    let st = createInitialTapState();
    const a = classifyTap(st, { listIndex: 1, gestureTaps: 1, now: 1000 }, CFG);
    st = a.next;
    expect(a.skipCommitForScroll).toBe(false); // first, only one unique index
    const b = classifyTap(st, { listIndex: 2, gestureTaps: 1, now: 1100 }, CFG);
    expect(b.skipCommitForScroll).toBe(true); // 2 unique indices in window, new-item single tap
  });

  it('does NOT skip commit for a deliberate double-tap even amid scrolling', () => {
    let st = createInitialTapState();
    st = classifyTap(st, { listIndex: 1, gestureTaps: 1, now: 1000 }, CFG).next;
    const r = classifyTap(st, { listIndex: 2, gestureTaps: 2, now: 1100 }, CFG);
    expect(r.skipCommitForScroll).toBe(false); // gestureTaps===2 ⇒ not a single-tap scroll
  });

  it('prunes the recent-index window past scrollWindowMs', () => {
    let st = createInitialTapState();
    st = classifyTap(st, { listIndex: 1, gestureTaps: 1, now: 1000 }, CFG).next;
    st = classifyTap(st, { listIndex: 2, gestureTaps: 1, now: 1100 }, CFG).next;
    // 1000 entry is now older than scrollWindowMs(400) relative to 1500.
    const r = classifyTap(st, { listIndex: 3, gestureTaps: 1, now: 1500 }, CFG);
    // window holds only times >= 1500-400=1100 → {1100:idx2, 1500:idx3} = 2 unique
    expect(r.skipCommitForScroll).toBe(true);
    expect(r.next.recentListIndices.every((e) => e.time >= 1100)).toBe(true);
  });
});
