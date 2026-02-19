/**
 * Input mapper — maps Even Hub list events to app actions.
 */

import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import type { Action, AppState } from '../state/contracts';

export function mapEvenHubEvent(event: EvenHubEvent, state: unknown): Action | null {
  if (!event) return null;

  try {
    // On glasses, double-tap is delivered as sysEvent with eventType 3 (DOUBLE_CLICK_EVENT), not listEvent. G2.md: "Simulator vs real device: real hardware sends textEvent or listEvent depending on the active container" but in practice we see sysEvent(3) for double-tap.
    if (event.sysEvent) {
      const rawType = (event.sysEvent as { eventType?: unknown }).eventType;
      if (rawType === 3 || Number(rawType) === 3) {
        const appState = state as AppState | undefined;
        const index = appState?.focusedListIndex ?? 0;
        return { type: 'TAP', selectedIndex: index, gestureTaps: 2 };
      }
    }

    if (event.listEvent) {
      const le = event.listEvent;
      const rawType = le.eventType;
      const rawDoubleClick = rawType === 3 || Number(rawType) === 3;
      const eventType =
        rawType != null ? OsEventTypeList.fromJson(rawType) ?? Number(rawType) : null;
      const index = typeof le.currentSelectItemIndex === 'number' ? le.currentSelectItemIndex : 0;

      if (rawDoubleClick || eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        return { type: 'TAP', selectedIndex: index, gestureTaps: 2 };
      }
      if (
        eventType === OsEventTypeList.CLICK_EVENT ||
        eventType === null ||
        eventType === undefined
      ) {
        return { type: 'TAP', selectedIndex: index, gestureTaps: 1 };
      }
      if (
        eventType !== OsEventTypeList.SCROLL_TOP_EVENT &&
        eventType !== OsEventTypeList.SCROLL_BOTTOM_EVENT
      ) {
        return { type: 'TAP', selectedIndex: index, gestureTaps: 1 };
      }
    }
    return null;
  } catch (err) {
    console.error('[InputMapper] Error processing event:', err);
    return null;
  }
}
