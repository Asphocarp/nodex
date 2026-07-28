import {
  describe,
  expect,
  test,
} from "vitest";
import {
  createWorkbenchEphemeralPanelState,
  reduceWorkbenchEphemeralPanelState,
} from "./workbench-ephemeral-panel-state";

describe("Workbench ephemeral panel state", () => {
  test("functional updates are committed through one aggregate", () => {
    const initial = createWorkbenchEphemeralPanelState();
    const next = reduceWorkbenchEphemeralPanelState(initial, {
      type: "update",
      field: "sideChatActiveTabByPanel",
      update: (current) => ({
        ...current,
        "session:one:right:leaf:right": "side-chat:one",
      }),
    });

    expect(next.sideChatActiveTabByPanel).toEqual({
      "session:one:right:leaf:right": "side-chat:one",
    });
    expect(next.mcpAppActiveTabByPanel)
      .toBe(initial.mcpAppActiveTabByPanel);
  });

  test("identity updates preserve the aggregate reference", () => {
    const initial = createWorkbenchEphemeralPanelState();
    const next = reduceWorkbenchEphemeralPanelState(initial, {
      type: "update",
      field: "pendingProcessOutputOpen",
      update: null,
    });

    expect(next).toBe(initial);
  });

  test("session pruning removes every family and slot-keyed override", () => {
    const initial = {
      ...createWorkbenchEphemeralPanelState(),
      sideChatTabsBySession: {
        "session:one": [],
        "session:two": [],
      },
      sideChatActiveTabByPanel: {
        "session:one:right:leaf:right": "side-chat:one",
        "session:two:right:leaf:right": "side-chat:two",
      },
      mcpAppTabsBySession: {
        "session:one": [],
      },
      planActiveTabByPanel: {
        "session:one:bottom:leaf:bottom": "plan:one",
      },
      activePlanKeyBySession: {
        "session:one": "plan:one",
        "session:two": "plan:two",
      },
      panelCollapsedOverrides: {
        "session:one:right": false,
        "session:two:right": true,
      },
    };

    const next = reduceWorkbenchEphemeralPanelState(initial, {
      type: "prune-session",
      sessionId: "session:one",
    });

    expect(next.sideChatTabsBySession).toEqual({
      "session:two": [],
    });
    expect(next.sideChatActiveTabByPanel).toEqual({
      "session:two:right:leaf:right": "side-chat:two",
    });
    expect(next.mcpAppTabsBySession).toEqual({});
    expect(next.planActiveTabByPanel).toEqual({});
    expect(next.activePlanKeyBySession).toEqual({
      "session:two": "plan:two",
    });
    expect(next.panelCollapsedOverrides).toEqual({
      "session:two:right": true,
    });
  });

  test("selecting one family atomically clears competing slot selections", () => {
    const slot = "session:one:right:leaf:right";
    const fallback = "session:one:right";
    const initial = {
      ...createWorkbenchEphemeralPanelState(),
      previewTabsByPanel: {
        [slot]: { id: "preview" },
      },
      sideChatActiveTabByPanel: {
        [fallback]: "side-chat:one",
      },
      mcpAppActiveTabByPanel: {
        [slot]: "mcp:one",
      },
      processOutputActiveTabByPanel: {
        [slot]: "process:one",
      },
    } as unknown as ReturnType<typeof createWorkbenchEphemeralPanelState>;

    const next = reduceWorkbenchEphemeralPanelState(initial, {
      type: "select-slot",
      slotKeys: [slot, fallback],
      activeField: "planActiveTabByPanel",
      tabId: "plan:one",
      sessionId: "session:one",
      planKey: "turn:one",
    });

    expect(next.previewTabsByPanel).toEqual({});
    expect(next.sideChatActiveTabByPanel).toEqual({});
    expect(next.mcpAppActiveTabByPanel).toEqual({});
    expect(next.processOutputActiveTabByPanel).toEqual({});
    expect(next.planActiveTabByPanel).toEqual({
      [slot]: "plan:one",
    });
    expect(next.activePlanKeyBySession).toEqual({
      "session:one": "turn:one",
    });
  });
});
