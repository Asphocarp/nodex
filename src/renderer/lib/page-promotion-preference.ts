import { writeStoredBoolean } from "./storage-boolean";

export const TASK_SHORTHAND_PAGE_PROMOTION_STORAGE_KEY =
  "nodex-task-shorthand-page-promotion-v1";
export const LEGACY_SMART_PREFIX_PARSING_STORAGE_KEY =
  "nodex-smart-prefix-parsing-enabled-v1";
export const LEGACY_STRIP_SMART_PREFIX_STORAGE_KEY =
  "nodex-strip-smart-prefix-from-title-v1";
export const DEFAULT_TASK_SHORTHAND_PAGE_PROMOTION_ENABLED = true;
export const TASK_SHORTHAND_PAGE_PROMOTION_CHANGE_EVENT =
  "nodex:task-shorthand-page-promotion-change";

const storedBoolean = (key: string): boolean | null => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return null;
  } catch {
    return null;
  }
};

export const readTaskShorthandPagePromotionEnabled = (): boolean => {
  const current = storedBoolean(TASK_SHORTHAND_PAGE_PROMOTION_STORAGE_KEY);
  if (current !== null) return current;
  const enabled = storedBoolean(LEGACY_SMART_PREFIX_PARSING_STORAGE_KEY) !== false
    && storedBoolean(LEGACY_STRIP_SMART_PREFIX_STORAGE_KEY) !== false;
  writeTaskShorthandPagePromotionEnabled(enabled);
  try {
    localStorage.removeItem(LEGACY_SMART_PREFIX_PARSING_STORAGE_KEY);
    localStorage.removeItem(LEGACY_STRIP_SMART_PREFIX_STORAGE_KEY);
  } catch {
    // The in-memory preference remains authoritative for this renderer session.
  }
  return enabled;
};

export const writeTaskShorthandPagePromotionEnabled = (
  value: boolean,
): boolean => {
  const stored = writeStoredBoolean(
    TASK_SHORTHAND_PAGE_PROMOTION_STORAGE_KEY,
    value,
    DEFAULT_TASK_SHORTHAND_PAGE_PROMOTION_ENABLED,
  );
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(
      TASK_SHORTHAND_PAGE_PROMOTION_CHANGE_EVENT,
      { detail: { enabled: value } },
    ));
  }
  return stored;
};
