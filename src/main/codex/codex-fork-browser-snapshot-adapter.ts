import { createHash } from "node:crypto";
import {
  makeBrowserSidebarConversationScopeKey,
  type BrowserSidebarBrowserUseStateSnapshot,
  type BrowserSidebarDeviceToolbarState,
  type BrowserSidebarStateSnapshot,
} from "../../shared/browser-sidebar";
import type {
  CodexForkBrowserSidePanelSnapshot,
  CodexForkBrowserTabDescriptor,
  CodexForkBrowserViewContext,
} from "../../shared/codex-fork-browser-transfer";
export type {
  CodexForkBrowserSidePanelSnapshot,
  CodexForkBrowserTabDescriptor,
} from "../../shared/codex-fork-browser-transfer";
import { listWorkbenchPanelLeaves } from "../../shared/workbench-panel-layout";
import type { ProjectSession } from "../../shared/types";
import type {
  WorkbenchPanelId,
  WorkbenchSessionViewSnapshot,
  WorkbenchSessionViewTab,
} from "../../shared/workbench-session-view";
import type { CodexForkSidePanelSnapshotAdapter } from "./codex-fork-side-panel-transfer";

export interface CodexForkBrowserRuntime {
  getBrowserUseStateSnapshot(): BrowserSidebarBrowserUseStateSnapshot;
  getConversationBrowserTabIds(
    browserConversationId: string,
    browserViewScopeId: string,
  ): string[];
  getDeviceToolbarTabState(
    identity: {
      browserConversationId: string;
      browserViewScopeId: string;
      browserTabId: string;
    },
  ): BrowserSidebarDeviceToolbarState;
  getStateSnapshot(): BrowserSidebarStateSnapshot;
  openClonedBrowserTab(input: {
    browserConversationId: string;
    browserViewScopeId: string;
    browserTabId: string;
    initialUrl?: string;
    projectId: string | null;
  }): unknown;
  primeTransferredBrowserTabId(
    browserConversationId: string,
    browserViewScopeId: string,
    browserTabId: string,
  ): void;
  setDeviceToolbarTabState(
    identity: {
      browserConversationId: string;
      browserViewScopeId: string;
      browserTabId: string;
    },
    state: BrowserSidebarDeviceToolbarState,
  ): void;
}

export interface CodexForkBrowserSnapshotAdapterDependencies {
  getProjectSession(projectSessionId: string): Promise<ProjectSession | null>;
  resolveBrowserConversationId(conversationId: string): Promise<string>;
  runtime: CodexForkBrowserRuntime;
}

const DEFAULT_DEVICE_TOOLBAR_STATE: BrowserSidebarDeviceToolbarState = {
  responsiveViewportSize: null,
  toolbarState: {
    isEnabled: false,
    presetId: "responsive",
    width: 390,
    height: 844,
  },
};

function browserRuntimeSnapshot(
  state: BrowserSidebarStateSnapshot,
  browserConversationId: string,
  browserViewScopeId: string,
  browserTabId: string,
) {
  return state.tabs.find((tab) =>
    tab.browserConversationId === browserConversationId
    && tab.browserViewScopeId === browserViewScopeId
    && tab.browserTabId === browserTabId
  ) ?? null;
}

function browserUseSnapshot(
  state: BrowserSidebarBrowserUseStateSnapshot,
  browserConversationId: string,
  browserViewScopeId: string,
  browserTabId: string,
) {
  return state.tabs.find((tab) =>
    tab.browserConversationId === browserConversationId
    && tab.browserViewScopeId === browserViewScopeId
    && tab.browserTabId === browserTabId
    && !tab.released
  ) ?? null;
}

function initialUrlForBrowser(
  browserState: BrowserSidebarStateSnapshot,
  browserUseState: BrowserSidebarBrowserUseStateSnapshot,
  browserConversationId: string,
  browserViewScopeId: string,
  browserTabId: string,
): string | null {
  return browserRuntimeSnapshot(
    browserState,
    browserConversationId,
    browserViewScopeId,
    browserTabId,
  )?.url ?? browserUseSnapshot(
    browserUseState,
    browserConversationId,
    browserViewScopeId,
    browserTabId,
  )?.url ?? null;
}

function browserTabsInPanel(
  view: WorkbenchSessionViewSnapshot,
  panel: WorkbenchPanelId,
): Array<Extract<WorkbenchSessionViewTab, { kind: "browser" }>> {
  return listWorkbenchPanelLeaves(view.panels[panel].layout)
    .flatMap((leaf) => leaf.tabIds)
    .map((tabId) => view.tabsById[tabId])
    .filter((
      tab,
    ): tab is Extract<WorkbenchSessionViewTab, { kind: "browser" }> =>
      tab?.kind === "browser"
    );
}

function capturePanelDescriptors(input: {
  browserConversationId: string;
  browserViewScopeId: string;
  browserState: BrowserSidebarStateSnapshot;
  browserUseState: BrowserSidebarBrowserUseStateSnapshot;
  panel: WorkbenchPanelId;
  runtime: CodexForkBrowserRuntime;
  view: WorkbenchSessionViewSnapshot;
}): CodexForkBrowserTabDescriptor[] {
  const activeTabId = listWorkbenchPanelLeaves(
    input.view.panels[input.panel].layout,
  ).find((leaf) =>
    leaf.id === input.view.panels[input.panel].layout.activeLeafId
  )?.activeTabId ?? null;

  return browserTabsInPanel(input.view, input.panel).map((tab) => ({
    active: tab.id === activeTabId,
    browserTabId: tab.config.browserTabId,
    deviceToolbarState: input.runtime.getDeviceToolbarTabState({
      browserConversationId: input.browserConversationId,
      browserViewScopeId: input.browserViewScopeId,
      browserTabId: tab.config.browserTabId,
    }) ?? DEFAULT_DEVICE_TOOLBAR_STATE,
    initialUrl: initialUrlForBrowser(
      input.browserState,
      input.browserUseState,
      input.browserConversationId,
      input.browserViewScopeId,
      tab.config.browserTabId,
    ) ?? tab.config.url ?? null,
    kind: "browser",
    panel: input.panel,
    tabId: tab.id,
  }));
}

function captureViewSnapshot(
  context: CodexForkBrowserViewContext,
  browserConversationId: string,
  runtime: CodexForkBrowserRuntime,
): CodexForkBrowserSidePanelSnapshot {
  const browserState = runtime.getStateSnapshot();
  const browserUseState = runtime.getBrowserUseStateSnapshot();
  const right = capturePanelDescriptors({
    browserConversationId,
    browserViewScopeId: context.browserViewScopeId,
    browserState,
    browserUseState,
    panel: "right",
    runtime,
    view: context.view,
  });
  const bottom = capturePanelDescriptors({
    browserConversationId,
    browserViewScopeId: context.browserViewScopeId,
    browserState,
    browserUseState,
    panel: "bottom",
    runtime,
    view: context.view,
  });
  return {
    bottomPanelOpen: !context.view.panels.bottom.collapsed,
    focusArea: context.view.lastFocusedPanelId === "bottom"
      ? "bottom-panel"
      : context.view.lastFocusedPanelId === "right"
        ? "right-panel"
        : "main",
    rightPanelFullWidth: context.view.panels.right.size.fullWidth === true,
    rightPanelOpen: !context.view.panels.right.collapsed,
    sourceBrowserConversationId: browserConversationId,
    sourceBrowserViewScopeId: context.browserViewScopeId,
    tabs: [...right, ...bottom],
    targetBrowserConversationId: browserConversationId,
    targetBrowserViewScopeId: context.browserViewScopeId,
  };
}

function captureRuntimeFallback(
  browserConversationId: string,
  browserViewScopeId: string,
  runtime: CodexForkBrowserRuntime,
): CodexForkBrowserSidePanelSnapshot {
  const browserState = runtime.getStateSnapshot();
  const browserUseState = runtime.getBrowserUseStateSnapshot();
  const browserTabIds = runtime.getConversationBrowserTabIds(
    browserConversationId,
    browserViewScopeId,
  );
  const rememberedBrowserTabId =
    browserUseState.activeBrowserTabIdsByConversationScope[
      makeBrowserSidebarConversationScopeKey({
        browserConversationId,
        browserViewScopeId,
      })
    ] ?? browserTabIds.at(-1) ?? null;
  return {
    bottomPanelOpen: false,
    focusArea: "main",
    rightPanelFullWidth: false,
    rightPanelOpen: browserTabIds.length > 0,
    sourceBrowserConversationId: browserConversationId,
    sourceBrowserViewScopeId: browserViewScopeId,
    tabs: browserTabIds.map((browserTabId) => ({
      active: browserTabId === rememberedBrowserTabId,
      browserTabId,
      deviceToolbarState: runtime.getDeviceToolbarTabState({
        browserConversationId,
        browserViewScopeId,
        browserTabId,
      }) ?? DEFAULT_DEVICE_TOOLBAR_STATE,
      initialUrl: initialUrlForBrowser(
        browserState,
        browserUseState,
        browserConversationId,
        browserViewScopeId,
        browserTabId,
      ),
      kind: "browser",
      panel: "right",
      tabId: browserTabId,
    })),
    targetBrowserConversationId: browserConversationId,
    targetBrowserViewScopeId: browserViewScopeId,
  };
}

function rebaseSnapshot(
  snapshot: CodexForkBrowserSidePanelSnapshot,
  targetBrowserConversationId: string,
): CodexForkBrowserSidePanelSnapshot {
  return {
    ...snapshot,
    targetBrowserConversationId,
  };
}

function remintIdentity(
  prefix: string,
  targetSessionId: string,
  sourceId: string,
  index: number,
): string {
  const digest = createHash("sha256")
    .update(targetSessionId)
    .update("\0")
    .update(sourceId)
    .update("\0")
    .update(String(index))
    .digest("hex");
  return `${prefix}:${digest.slice(0, 48)}`;
}

export function createCodexForkBrowserSnapshotAdapter(
  dependencies: CodexForkBrowserSnapshotAdapterDependencies,
): CodexForkSidePanelSnapshotAdapter<CodexForkBrowserSidePanelSnapshot> {
  return {
    async capture(sourceConversationId, sourceViewContext) {
      const browserConversationId = await dependencies.resolveBrowserConversationId(
        sourceConversationId,
      );
      if (
        sourceViewContext
        && sourceViewContext.view.sessionId === browserConversationId
      ) {
        return captureViewSnapshot(
          sourceViewContext,
          browserConversationId,
          dependencies.runtime,
        );
      }
      return captureRuntimeFallback(
        browserConversationId,
        sourceViewContext?.browserViewScopeId
          ?? `headless:${browserConversationId}`,
        dependencies.runtime,
      );
    },

    async rebase(snapshot, input) {
      return rebaseSnapshot(
        snapshot,
        await dependencies.resolveBrowserConversationId(
          input.targetConversationId,
        ),
      );
    },

    async apply(snapshot, input) {
      const targetSession = await dependencies.getProjectSession(
        input.targetProjectSessionId,
      );
      if (!targetSession) {
        throw new Error("Target project session was not found");
      }
      if (snapshot.targetBrowserConversationId !== targetSession.id) {
        throw new Error("Target browser conversation identity is not stable");
      }

      const applied: CodexForkBrowserSidePanelSnapshot = {
        ...snapshot,
        targetBrowserViewScopeId: input.targetBrowserViewScopeId,
        tabs: snapshot.tabs.map((descriptor, index) => ({
          ...descriptor,
          browserTabId: remintIdentity(
            "fork-browser-runtime",
            targetSession.id,
            descriptor.browserTabId,
            index,
          ),
          tabId: remintIdentity(
            "fork-browser-view",
            targetSession.id,
            descriptor.tabId,
            index,
          ),
        })),
      };

      for (const descriptor of applied.tabs) {
        dependencies.runtime.primeTransferredBrowserTabId(
          applied.targetBrowserConversationId,
          applied.targetBrowserViewScopeId,
          descriptor.browserTabId,
        );
        const initialUrl = descriptor.initialUrl ?? undefined;
        dependencies.runtime.openClonedBrowserTab({
          browserConversationId: applied.targetBrowserConversationId,
          browserViewScopeId: applied.targetBrowserViewScopeId,
          browserTabId: descriptor.browserTabId,
          ...(initialUrl === undefined ? {} : { initialUrl }),
          projectId: targetSession.projectId,
        });
        dependencies.runtime.setDeviceToolbarTabState(
          {
            browserConversationId: applied.targetBrowserConversationId,
            browserViewScopeId: applied.targetBrowserViewScopeId,
            browserTabId: descriptor.browserTabId,
          },
          descriptor.deviceToolbarState,
        );
      }
      return applied;
    },
  };
}
