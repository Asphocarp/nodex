import { describe, expect, test } from "vitest";
import type {
  PageCreateTarget,
  PageCreateTargetRegistryState,
} from "./page-create-target-registry";
import { resolvePageCreateTarget } from "./page-create-target-registry";

const target = (
  surfaceId: string,
  readOnlyReason: string | null = null,
): PageCreateTarget => ({
  surfaceId,
  panelTabId: `tab:${surfaceId}`,
  project: {
    id: `project:${surfaceId}`,
    name: surfaceId,
    appearance: { color: "blue", marker: { kind: "icon", icon: "terminal" } },
  },
  databaseViewId: `view:${surfaceId}`,
  clientSessionId: "session-test",
  accessContext: { kind: "project", projectId: `project:${surfaceId}` },
  properties: [],
  columns: [{ id: "triage", name: "Triage" }, { id: "plan", name: "Plan" }],
  readOnlyReason,
});

const state = (
  targets: readonly PageCreateTarget[],
  activeSurfaceId: string | null,
): PageCreateTargetRegistryState => ({
  activeSurfaceId,
  nextActivitySequence: targets.length + 1,
  registrations: Object.fromEntries(targets.map((item, index) => [
    item.surfaceId,
    {
      token: `token:${item.surfaceId}`,
      target: item,
      activeColumnId: item.surfaceId === activeSurfaceId ? "plan" : null,
      activitySequence: item.surfaceId === activeSurfaceId ? index + 1 : 0,
    },
  ])),
});

describe("Page create target resolution", () => {
  test("prefers the active writable surface and its active column", () => {
    const resolution = resolvePageCreateTarget(state(
      [target("left"), target("right")],
      "right",
    ));

    expect(resolution).toMatchObject({
      status: "resolved",
      target: { surfaceId: "right" },
      columnId: "plan",
    });
  });

  test("uses the only writable surface but refuses an ambiguous pair", () => {
    expect(resolvePageCreateTarget(state(
      [target("left"), target("right", "Read only")],
      null,
    ))).toMatchObject({ status: "resolved", target: { surfaceId: "left" } });

    expect(resolvePageCreateTarget(state(
      [target("left"), target("right")],
      null,
    ))).toEqual({
      status: "unavailable",
      reason: "Focus a Board before creating a Page.",
    });
  });

  test("keeps the most recently interacted mounted surface after the active one unmounts", () => {
    const previous = state([target("left"), target("center"), target("right")], null);
    const resolution = resolvePageCreateTarget({
      ...previous,
      registrations: {
        ...previous.registrations,
        left: { ...previous.registrations.left!, activitySequence: 4 },
        center: { ...previous.registrations.center!, activitySequence: 7 },
      },
      nextActivitySequence: 9,
    });

    expect(resolution).toMatchObject({
      status: "resolved",
      target: { surfaceId: "center" },
      columnId: "triage",
    });
  });

  test("surfaces the canonical unavailable reason when no target is writable", () => {
    expect(resolvePageCreateTarget(state(
      [target("left", "This View is grouped by Tags")],
      "left",
    ))).toEqual({
      status: "unavailable",
      reason: "This View is grouped by Tags",
    });
  });
});
