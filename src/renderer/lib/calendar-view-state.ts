import {
  type CalendarRangeState,
  type PersistedCalendarRangePrefs,
  migrateCalendarRangePrefs,
  resolveCalendarRangeAnchorOffset,
  resolveCalendarVisibleDayCount,
} from "./calendar-range";
import { getVisibleDays } from "./calendar-utils";

const STORAGE_KEY = "nodex-calendar-prefs";

export interface CalendarViewState {
  range: CalendarRangeState;
  anchorDate: Date;
}

export function todayCalendarStorageKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function normalizeCalendarAnchorDate(value: Date): Date {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function shiftCalendarAnchorDateByDays(value: Date, days: number): Date {
  const next = normalizeCalendarAnchorDate(value);
  next.setDate(next.getDate() + days);
  return next;
}

export function loadCalendarViewState(): CalendarViewState {
  const today = normalizeCalendarAnchorDate(new Date());
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { range: migrateCalendarRangePrefs(null), anchorDate: today };

    const parsed = JSON.parse(stored) as Partial<PersistedCalendarRangePrefs> & { dayCount?: unknown };
    const range = migrateCalendarRangePrefs(parsed);
    if (parsed.anchorDate && parsed.savedOn === todayCalendarStorageKey()) {
      const restored = new Date(parsed.anchorDate);
      if (!Number.isNaN(restored.getTime())) {
        return { range, anchorDate: normalizeCalendarAnchorDate(restored) };
      }
    }

    return { range, anchorDate: today };
  } catch {
    return { range: migrateCalendarRangePrefs(null), anchorDate: today };
  }
}

export function saveCalendarViewState(state: CalendarViewState): void {
  try {
    const prefs: PersistedCalendarRangePrefs = {
      ...state.range,
      anchorDate: state.anchorDate.toISOString(),
      savedOn: todayCalendarStorageKey(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function resolveCalendarVisibleDays(state: CalendarViewState): Date[] {
  const dayCount = resolveCalendarVisibleDayCount(state.range);
  const effectiveAnchor = shiftCalendarAnchorDateByDays(
    state.anchorDate,
    resolveCalendarRangeAnchorOffset(state.range),
  );
  return getVisibleDays(effectiveAnchor, dayCount);
}

export function formatCalendarToolbarMonthYear(visibleDays: Date[]): string {
  if (visibleDays.length === 0) return "";
  const first = visibleDays[0]!;
  const last = visibleDays[visibleDays.length - 1]!;

  if (first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth()) {
    return first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  if (first.getFullYear() === last.getFullYear()) {
    return `${first.toLocaleDateString(undefined, { month: "short" })} - ${last.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
  }

  return `${first.toLocaleDateString(undefined, { month: "short", year: "numeric" })} - ${last.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
}
