/**
 * Shared constants for state and layout.
 */

export const DISPLAY_WIDTH = 576;
export const DISPLAY_HEIGHT = 288;

/** List container: SDK allows 1–20 items, 64 chars per item name. */
export const LIST_MAX_ITEMS = 20;
/** Scenes/devices/rooms per page; 2 slots reserved for "Previous/Back" / "Next" list entries. */
export const SCENES_PER_PAGE = LIST_MAX_ITEMS - 2;
export const DEVICES_PER_PAGE = SCENES_PER_PAGE;
export const ROOMS_PER_PAGE = SCENES_PER_PAGE;

/** Dim levels 0–100 in steps of 10 (11 values). */
export const DIM_LEVELS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
export const DIM_LEVELS_PER_PAGE = SCENES_PER_PAGE;
export const LIST_ITEM_NAME_MAX_LEN = 64;

/** Max scene name length for display (truncate with ellipsis). */
export const SCENE_NAME_MAX_LEN = LIST_ITEM_NAME_MAX_LEN;

export const CONTAINER_ID_LIST = 1;
export const CONTAINER_NAME_LIST = 'scenes-list';

/** Image container: thumbs status (success/error) on the right. SDK: image width 20–200, height 20–100. */
export const CONTAINER_ID_CONFIRMATION = 2;
export const CONTAINER_NAME_CONFIRMATION = 'confirmation';

/** Layout: list on left, thumbs status top-right (square so icon isn’t stretched wide). */
export const LIST_WIDTH = 300;
/** Height per list item; list container height = min(DISPLAY_HEIGHT, itemCount * this) so items align to top-left. */
export const LIST_ITEM_HEIGHT = 48;
/** Height of list when only 2 items (main menu); kept for reference, = 2 * LIST_ITEM_HEIGHT. */
export const LIST_HEIGHT_MAIN_MENU = LIST_ITEM_HEIGHT * 2;
export const CONFIRMATION_WIDTH = 25;
export const CONFIRMATION_HEIGHT = 25;

/** Vertical offset of the SmartThings statuses box (top of display). */
export const STATS_TOP_OFFSET = 0;
/** Height of the SmartThings statuses text box (full height to the right of the list). */
export const STATS_BOX_HEIGHT = DISPLAY_HEIGHT;

export const PAT_STORAGE_KEY = 'smartthings_pat';
export const PREFERENCES_STORAGE_KEY = 'smartthings_preferences';