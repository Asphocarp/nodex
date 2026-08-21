import { createHash } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  makeBrowserSidebarConversationScopeKey,
  type BrowserSidebarBrowserUseStateSnapshot,
  type BrowserSidebarStateSnapshot,
} from "../../shared/browser-sidebar";
import type {
  CodexForkBrowserSceneContext,
  CodexForkBrowserSidePanelSnapshot,
  CodexForkBrowserTabDescriptor,
} from "../../shared/codex-fork-browser-transfer";
import type { ProjectSession } from "../../shared/types";
import { listWorkbenchPanelLeaves } from "../../shared/workbench-panel-layout";
import type { WorkbenchPanelId } from "../../shared/workbench-session-view";
import type {
  WorkbenchSceneSnapshot,
  WorkbenchSurfaceDescriptor,
} from "../../shared/workbench-scene";
import type { BrowserState } from "./BrowserState";

export class BrowserForkTransferError extends Schema.TaggedError<BrowserForkTransferError>()(
  "BrowserForkTransferError",
  {
    targetBrowserConversationId: Schema.String,
    targetProjectSessionId: Schema.String,
  },
) {}

export interface BrowserForkTransfer {
  readonly capture: (
    browserConversationId: string,
    sourceSceneContext?: CodexForkBrowserSceneContext,
  ) => Effect.Effect<CodexForkBrowserSidePanelSnapshot>;
  readonly rebase: (
    snapshot: CodexForkBrowserSidePanelSnapshot,
    targetBrowserConversationId: string,
  ) => Effect.Effect<CodexForkBrowserSidePanelSnapshot>;
  readonly apply: (
    snapshot: CodexForkBrowserSidePanelSnapshot,
    input: {
      readonly targetBrowserConversationId: string;
      readonly targetBrowserViewScopeId: string;
      readonly targetProjectSession: Pick<ProjectSession, "id" | "projectId">;
    },
  ) => Effect.Effect<CodexForkBrowserSidePanelSnapshot, BrowserForkTransferError>;
}

function browserTabsInPanel(
  scene: WorkbenchSceneSnapshot,
  panel: WorkbenchPanelId,
): Array<Extract<WorkbenchSurfaceDescriptor, { kind: "browser" }>> {
  return listWorkbenchPanelLeaves(scene.panels[panel].layout)
    .flatMap((leaf) => leaf.tabIds)
    .map((surfaceId) => scene.panelSurfacesById[surfaceId])
    .filter(
      (surface): surface is Extract<WorkbenchSurfaceDescriptor, { kind: "browser" }> =>
        surface?.kind === "browser",
    );
}

function initialUrlForBrowser(
  browserState: BrowserSidebarStateSnapshot,
  browserUseState: BrowserSidebarBrowserUseStateSnapshot,
  browserConversationId: string,
  browserViewScopeId: string,
  browserTabId: string,
): string | null {
  const runtimeTab = browserState.tabs.find(
    (tab) =>
      tab.browserConversationId === browserConversationId &&
      tab.browserViewScopeId === browserViewScopeId &&
      tab.browserTabId === browserTabId,
  );
  if (runtimeTab) return runtimeTab.url;

  return (
    browserUseState.tabs.find(
      (tab) =>
        tab.browserConversationId === browserConversationId &&
        tab.browserViewScopeId === browserViewScopeId &&
        tab.browserTabId === browserTabId &&
        !tab.released,
    )?.url ?? null
  );
}

function capturePanelDescriptors(input: {
  readonly browserConversationId: string;
  readonly browserState: BrowserSidebarStateSnapshot;
  readonly browserUseState: BrowserSidebarBrowserUseStateSnapshot;
  readonly browserViewScopeId: string;
  readonly panel: WorkbenchPanelId;
  readonly scene: WorkbenchSceneSnapshot;
  readonly state: BrowserState;
}): CodexForkBrowserTabDescriptor[] {
  const activeTabId =
    listWorkbenchPanelLeaves(input.scene.panels[input.panel].layout).find(
      (leaf) => leaf.id === input.scene.panels[input.panel].layout.activeLeafId,
    )?.activeTabId ?? null;

  return browserTabsInPanel(input.scene, input.panel).map((tab) => ({
    active: tab.id === activeTabId,
    browserTabId: tab.config.browserTabId,
    deviceToolbarState: input.state.getDeviceToolbarTabState({
      browserConversationId: input.browserConversationId,
      browserViewScopeId: input.browserViewScopeId,
      browserTabId: tab.config.browserTabId,
    }),
    initialUrl:
      initialUrlForBrowser(
        input.browserState,
        input.browserUseState,
        input.browserConversationId,
        input.browserViewScopeId,
        tab.config.browserTabId,
      ) ??
      tab.config.url ??
      null,
    kind: "browser",
    panel: input.panel,
    tabId: tab.id,
  }));
}

function captureSceneSnapshot(
  state: BrowserState,
  context: CodexForkBrowserSceneContext,
  browserConversationId: string,
): CodexForkBrowserSidePanelSnapshot {
  const browserState = state.getStateSnapshot();
  const browserUseState = state.getBrowserUseStateSnapshot();
  const right = capturePanelDescriptors({
    browserConversationId,
    browserState,
    browserUseState,
    browserViewScopeId: context.browserViewScopeId,
    panel: "right",
    scene: context.scene,
    state,
  });
  const bottom = capturePanelDescriptors({
    browserConversationId,
    browserState,
    browserUseState,
    browserViewScopeId: context.browserViewScopeId,
    panel: "bottom",
    scene: context.scene,
    state,
  });
  return {
    bottomPanelOpen: !context.scene.panels.bottom.collapsed,
    focusArea:
      context.scene.lastFocusedPanelId === "bottom"
        ? "bottom-panel"
        : context.scene.lastFocusedPanelId === "right"
          ? "right-panel"
          : "main",
    rightPanelFullWidth: context.scene.panels.right.size.fullWidth === true,
    rightPanelOpen: !context.scene.panels.right.collapsed,
    sourceBrowserConversationId: browserConversationId,
    sourceBrowserViewScopeId: context.browserViewScopeId,
    tabs: [...right, ...bottom],
    targetBrowserConversationId: browserConversationId,
    targetBrowserViewScopeId: context.browserViewScopeId,
  };
}

function captureRuntimeFallback(
  state: BrowserState,
  browserConversationId: string,
  browserViewScopeId: string,
): CodexForkBrowserSidePanelSnapshot {
  const browserState = state.getStateSnapshot();
  const browserUseState = state.getBrowserUseStateSnapshot();
  const browserTabIds = state.getConversationBrowserTabIds(
    browserConversationId,
    browserViewScopeId,
  );
  const rememberedBrowserTabId =
    browserUseState.activeBrowserTabIdsByConversationScope[
      makeBrowserSidebarConversationScopeKey({ browserConversationId, browserViewScopeId })
    ] ??
    browserTabIds.at(-1) ??
    null;
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
      deviceToolbarState: state.getDeviceToolbarTabState({
        browserConversationId,
        browserViewScopeId,
        browserTabId,
      }),
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

export function makeBrowserForkTransfer(state: BrowserState): BrowserForkTransfer {
  return {
    capture: (browserConversationId, sourceSceneContext) =>
      Effect.sync(() => {
        if (
          sourceSceneContext?.scene.owner.kind === "session" &&
          sourceSceneContext.scene.owner.sessionId === browserConversationId
        ) {
          return captureSceneSnapshot(state, sourceSceneContext, browserConversationId);
        }
        return captureRuntimeFallback(
          state,
          browserConversationId,
          sourceSceneContext?.browserViewScopeId ?? `headless:${browserConversationId}`,
        );
      }),
    rebase: (snapshot, targetBrowserConversationId) =>
      Effect.succeed({ ...snapshot, targetBrowserConversationId }),
    apply: (snapshot, input) =>
      Effect.gen(function* () {
        if (
          input.targetBrowserConversationId !== input.targetProjectSession.id ||
          snapshot.targetBrowserConversationId !== input.targetProjectSession.id
        ) {
          return yield* new BrowserForkTransferError({
            targetBrowserConversationId: snapshot.targetBrowserConversationId,
            targetProjectSessionId: input.targetProjectSession.id,
          });
        }

        const applied: CodexForkBrowserSidePanelSnapshot = {
          ...snapshot,
          targetBrowserViewScopeId: input.targetBrowserViewScopeId,
          tabs: snapshot.tabs.map((descriptor, index) => ({
            ...descriptor,
            browserTabId: remintIdentity(
              "fork-browser-runtime",
              input.targetProjectSession.id,
              descriptor.browserTabId,
              index,
            ),
            tabId: remintIdentity(
              "fork-browser-view",
              input.targetProjectSession.id,
              descriptor.tabId,
              index,
            ),
          })),
        };

        yield* Effect.sync(() => {
          for (const descriptor of applied.tabs) {
            state.primeTransferredBrowserTabId(
              applied.targetBrowserConversationId,
              applied.targetBrowserViewScopeId,
              descriptor.browserTabId,
            );
            state.primeClonedTab({
              browserConversationId: applied.targetBrowserConversationId,
              browserViewScopeId: applied.targetBrowserViewScopeId,
              browserTabId: descriptor.browserTabId,
              deviceToolbarState: descriptor.deviceToolbarState,
              ...(descriptor.initialUrl === null ? {} : { initialUrl: descriptor.initialUrl }),
              projectId: input.targetProjectSession.projectId,
            });
          }
        });
        return applied;
      }),
  };
}
