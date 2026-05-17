/**
 * Tap classification / dedup — pure extraction of the logic that used to live
 * inside initApp()'s handleHubEvent closure.
 *
 * The G2/firmware can emit duplicate or scroll-adjacent tap events. This
 * decides, given the recent tap history, the next `tapCount` and whether the
 * commit should be skipped (because the user is likely scrolling, not
 * selecting). Kept pure so the real algorithm is unit-testable instead of the
 * shadow simulation that previously lived in the test suite.
 */

export interface TapState {
  /** Indices tapped recently, with timestamps (FIFO, pruned by window). */
  recentListIndices: { index: number; time: number }[];
  lastTapIndex: number;
  lastTapTime: number;
  tapCount: number;
}

export interface TapConfig {
  /** Window for "is the user scrolling across items?" detection. */
  scrollWindowMs: number;
  /** Window for "is this another tap on the same item?" detection. */
  tapWindowMs: number;
}

export interface TapEvent {
  listIndex: number;
  /** 1 = single, 2 = double (from the gesture mapper). */
  gestureTaps: number;
  now: number;
}

export interface TapClassification {
  next: TapState;
  /** True ⇒ caller should NOT arm the commit timer (treat as scroll). */
  skipCommitForScroll: boolean;
}

export function createInitialTapState(): TapState {
  return { recentListIndices: [], lastTapIndex: -1, lastTapTime: 0, tapCount: 0 };
}

export function classifyTap(
  prev: TapState,
  ev: TapEvent,
  cfg: TapConfig,
): TapClassification {
  const { listIndex, gestureTaps, now } = ev;

  // Append + prune the recent-index window (clone — pure).
  const recent = [
    ...prev.recentListIndices,
    { index: listIndex, time: now },
  ];
  const cutoff = now - cfg.scrollWindowMs;
  while (recent.length > 0) {
    const first = recent[0];
    if (first == null || first.time >= cutoff) break;
    recent.shift();
  }

  const uniqueIndicesInWindow = new Set(recent.map((e) => e.index)).size;
  const likelyScrolling = uniqueIndicesInWindow >= 2;

  const isSameItemAgain =
    listIndex === prev.lastTapIndex && now - prev.lastTapTime <= cfg.tapWindowMs;
  const isNewItemSingleTap = !isSameItemAgain && gestureTaps === 1;

  let tapCount: number;
  let lastTapIndex: number;
  if (isSameItemAgain) {
    tapCount = Math.min(prev.tapCount + gestureTaps, 4);
    lastTapIndex = prev.lastTapIndex;
  } else {
    tapCount = Math.min(gestureTaps, 4);
    lastTapIndex = listIndex;
  }

  return {
    next: {
      recentListIndices: recent,
      lastTapIndex,
      lastTapTime: now,
      tapCount,
    },
    skipCommitForScroll: isNewItemSingleTap && likelyScrolling,
  };
}
