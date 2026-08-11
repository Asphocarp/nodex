import { describe, expect, test } from "vitest";
import {
  resolveCalendarPresentationFeature,
  resolveDurableDatabasePresentation,
  resolveLegacyWorkbenchPresentation,
  type CalendarPresentationFeature,
} from "./calendar-presentation-feature";

const enabled: CalendarPresentationFeature = { enabled: true };
const disabled: CalendarPresentationFeature = { enabled: false };

describe("resolveCalendarPresentationFeature", () => {
  test("uses the checked-in release decision outside development", () => {
    expect(resolveCalendarPresentationFeature({
      releaseDefault: false,
      development: false,
      developmentOverride: "true",
    })).toEqual({ enabled: false });
    expect(resolveCalendarPresentationFeature({
      releaseDefault: true,
      development: false,
      developmentOverride: "false",
    })).toEqual({ enabled: true });
  });

  test("accepts only exact boolean literals as development overrides", () => {
    expect(resolveCalendarPresentationFeature({
      releaseDefault: false,
      development: true,
      developmentOverride: "true",
    })).toEqual({ enabled: true });
    expect(resolveCalendarPresentationFeature({
      releaseDefault: true,
      development: true,
      developmentOverride: "false",
    })).toEqual({ enabled: false });
  });

  test.each(["", "TRUE", "1", "yes", true, null, {}])(
    "fails closed for malformed development override %j",
    (developmentOverride) => {
      expect(resolveCalendarPresentationFeature({
        releaseDefault: true,
        development: true,
        developmentOverride,
      })).toEqual({ enabled: false });
    },
  );

  test("uses the checked-in decision when no development override exists", () => {
    expect(resolveCalendarPresentationFeature({
      releaseDefault: false,
      development: true,
    })).toEqual({ enabled: false });
    expect(resolveCalendarPresentationFeature({
      releaseDefault: true,
      development: true,
    })).toEqual({ enabled: true });
  });
});

describe("Calendar presentation projection", () => {
  test("projects hidden legacy Calendar state to Board without changing other views", () => {
    expect(resolveLegacyWorkbenchPresentation("calendar", disabled)).toBe("kanban");
    expect(resolveLegacyWorkbenchPresentation("list", disabled)).toBe("list");
    expect(resolveLegacyWorkbenchPresentation("toggle-list", disabled)).toBe("toggle-list");
  });

  test("projects a hidden durable Calendar View to List", () => {
    expect(resolveDurableDatabasePresentation("calendar", disabled)).toBe("list");
    expect(resolveDurableDatabasePresentation("kanban", disabled)).toBe("kanban");
    expect(resolveDurableDatabasePresentation("list", disabled)).toBe("list");
  });

  test("preserves Calendar presentations while the feature is enabled", () => {
    expect(resolveLegacyWorkbenchPresentation("calendar", enabled)).toBe("calendar");
    expect(resolveDurableDatabasePresentation("calendar", enabled)).toBe("calendar");
  });
});
