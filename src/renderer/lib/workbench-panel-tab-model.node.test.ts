import { describe, expect, test } from "vitest";
import {
  buildSideChatParentNavigationPath,
  isAutomationPanelTab,
  isBackgroundAgentPanelTab,
  isMcpAppPanelTab,
  isPanelTabClosable,
  isPlanPanelTab,
  isProcessOutputPanelTab,
  isRootThreadRightPanelComposerOverlayEligibleTab,
  isSideChatPanelTab,
  isSubagentsPanelTab,
  isTransientPanelTab,
  makeProcessOutputPanelTabId,
  type ProjectSessionRenderableTab,
  type SideChatPanelTab,
} from "./workbench-panel-tab-model";
import {
  makeTestWorkbenchSession,
  makeTestWorkbenchTab,
} from "@/components/workbench/workbench-testkit/panel-fixtures";

function transient(
  discriminant: string,
): ProjectSessionRenderableTab {
  return {
    [discriminant]: true,
    id: discriminant,
    sessionId: "session-1",
    projectId: "project-1",
    panelId: "right",
    title: discriminant,
    stateKey: 0,
  } as unknown as ProjectSessionRenderableTab;
}

describe("workbench panel tab model", () => {
  test.each([
    ["sideChat", isSideChatPanelTab],
    ["mcpApp", isMcpAppPanelTab],
    ["planPanel", isPlanPanelTab],
    ["automationPanel", isAutomationPanelTab],
    ["backgroundAgent", isBackgroundAgentPanelTab],
    ["subagentsPanel", isSubagentsPanelTab],
    ["processOutputPanel", isProcessOutputPanelTab],
  ] as const)("recognizes only the %s discriminant", (kind, guard) => {
    expect(guard(transient(kind))).toBe(true);
    expect(guard(transient("different"))).toBe(false);
  });

  test("classifies every auxiliary family as transient", () => {
    for (const discriminant of [
      "sideChat",
      "mcpApp",
      "planPanel",
      "automationPanel",
      "backgroundAgent",
      "subagentsPanel",
      "processOutputPanel",
    ]) {
      expect(isTransientPanelTab(transient(discriminant))).toBe(true);
    }
    expect(isTransientPanelTab(makeTestWorkbenchTab({
      id: "browser",
      kind: "browser",
    }))).toBe(false);
  });

  test("keeps loading side chats non-closable", () => {
    const sideChat = {
      sideChat: true,
      id: "side-chat",
      sessionId: "session-1",
      panelId: "right",
      parentThreadId: "parent",
      parentNavigationPath: "path",
      threadId: null,
      title: "Side chat",
      status: "loading",
      stateKey: 0,
    } satisfies SideChatPanelTab;
    expect(isPanelTabClosable(sideChat)).toBe(false);
    expect(isPanelTabClosable({ ...sideChat, status: "ready" }))
      .toBe(true);
    expect(isPanelTabClosable({ ...sideChat, status: "expired" }))
      .toBe(true);
  });

  test("limits root composer overlay eligibility to durable surfaces", () => {
    for (const tab of [
      makeTestWorkbenchTab({ id: "review", kind: "review" }),
      makeTestWorkbenchTab({ id: "browser", kind: "browser" }),
      makeTestWorkbenchTab({
        id: "page",
        kind: "page_stage",
        pageId: "page-1",
      }),
    ]) {
      expect(isRootThreadRightPanelComposerOverlayEligibleTab(tab))
        .toBe(true);
    }
    expect(isRootThreadRightPanelComposerOverlayEligibleTab(
      makeTestWorkbenchTab({
        id: "terminal",
        kind: "terminal",
      }),
    )).toBe(false);
    expect(isRootThreadRightPanelComposerOverlayEligibleTab(
      transient("planPanel"),
    )).toBe(false);
    expect(isRootThreadRightPanelComposerOverlayEligibleTab(null))
      .toBe(false);
  });

  test("encodes process identities and project-aware side-chat paths", () => {
    expect(makeProcessOutputPanelTabId("thread:a/b", "item:c d"))
      .toBe("process-output:thread%3Aa%2Fb:item%3Ac%20d");
    expect(buildSideChatParentNavigationPath(
      makeTestWorkbenchSession({ projectId: "project-1" }),
      "thread-1",
    )).toBe(
      "project:project-1/session:session-1/thread:thread-1",
    );
    expect(buildSideChatParentNavigationPath(
      makeTestWorkbenchSession({ projectId: null }),
      "thread-1",
    )).toBe("session:session-1/thread:thread-1");
  });
});
