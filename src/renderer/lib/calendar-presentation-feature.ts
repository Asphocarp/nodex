import type { DatabaseViewKind } from "../../shared/database-kernel";
import type { ProjectSessionDbView } from "../../shared/types";

export interface CalendarPresentationFeature {
  readonly enabled: boolean;
}

export interface ResolveCalendarPresentationFeatureInput {
  readonly releaseDefault: boolean;
  readonly development: boolean;
  readonly developmentOverride?: unknown;
}

const CALENDAR_PRESENTATION_RELEASE_DEFAULT = false;

export function resolveCalendarPresentationFeature({
  releaseDefault,
  development,
  developmentOverride,
}: ResolveCalendarPresentationFeatureInput): CalendarPresentationFeature {
  if (!development) return Object.freeze({ enabled: releaseDefault });
  if (developmentOverride === undefined) {
    return Object.freeze({ enabled: releaseDefault });
  }
  if (developmentOverride === "true") return Object.freeze({ enabled: true });
  if (developmentOverride === "false") return Object.freeze({ enabled: false });
  return Object.freeze({ enabled: false });
}

/**
 * Temporary application-wide Release Toggle for Calendar presentations.
 * Remove it after the redesigned Calendar graduates its product review and
 * stabilization window; schedules, reminders, and occurrence actions are not
 * controlled by this decision.
 */
export const calendarPresentationFeature = resolveCalendarPresentationFeature({
  releaseDefault: CALENDAR_PRESENTATION_RELEASE_DEFAULT,
  development: import.meta.env.DEV,
  developmentOverride: import.meta.env.VITE_NODEX_CALENDAR_PRESENTATION,
});

export function resolveLegacyWorkbenchPresentation(
  requested: ProjectSessionDbView,
  feature: CalendarPresentationFeature = calendarPresentationFeature,
): ProjectSessionDbView {
  if (feature.enabled || requested !== "calendar") return requested;
  return "kanban";
}

export function resolveDurableDatabasePresentation(
  requested: DatabaseViewKind,
  feature: CalendarPresentationFeature = calendarPresentationFeature,
): DatabaseViewKind {
  if (feature.enabled || requested !== "calendar") return requested;
  return "list";
}
