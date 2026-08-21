import { describe, expect, test } from "vite-plus/test";
import {
  buildAutomationsPath,
  resolveAutomationsRouteState,
  updateAutomationsPath,
} from "./workbench-automations-routes";

describe("workbench automations routes", () => {
  test("builds the root scheduled tasks path without redundant params", () => {
    expect(buildAutomationsPath()).toBe("/automations");
    expect(buildAutomationsPath({ tab: "tasks", automationId: "  " })).toBe("/automations");
  });

  test("preserves Codex automationId and automationMode search semantics", () => {
    expect(
      buildAutomationsPath({
        automationId: "automation-1",
        automationMode: "create",
      }),
    ).toBe("/automations?automationId=automation-1&automationMode=create");

    expect(
      JSON.stringify(
        resolveAutomationsRouteState(
          "/automations?tab=templates&automationId=automation-2&automationMode=create",
        ),
      ),
    ).toBe(
      JSON.stringify({
        tab: "templates",
        automationId: "automation-2",
        automationMode: "create",
      }),
    );
  });

  test("updates selection while preserving current tab by default", () => {
    expect(
      updateAutomationsPath("/automations?tab=templates", {
        automationId: "automation-3",
      }),
    ).toBe("/automations?tab=templates&automationId=automation-3");

    expect(
      updateAutomationsPath("/automations?automationId=automation-3&automationMode=create", {
        automationId: null,
        automationMode: null,
      }),
    ).toBe("/automations");
  });
});
