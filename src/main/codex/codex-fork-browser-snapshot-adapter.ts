import { createHash } from "node:crypto";
import {
  makeDefaultBrowserSidebarTabId,
  requireProjectSessionBrowserTabId,
  type BrowserSidebarBrowserUseStateSnapshot,
  type BrowserSidebarDeviceToolbarState,
  type BrowserSidebarStateSnapshot,
} from "../../shared/browser-sidebar";
import { getProjectSessionPanelActiveLeaf } from "../../shared/project-session-panel-layout";
import type {
  PanelId,
  ProjectSession,
  ProjectSessionTab,
} from "../../shared/types";
import type { CodexForkSidePanelSnapshotAdapter } from "./codex-fork-side-panel-transfer";

export interface CodexForkBrowserTabDescriptor {
  active: boolean;
  readonly browserTabId: string;
  readonly deviceToolbarState: BrowserSidebarDeviceToolbarState;
  readonly initialUrl: string | null;
  readonly insertAfterTabId: string | null;
  readonly kind: "browser";
  readonly panel: PanelId;
  readonly tabId: string;
}

export interface CodexForkBrowserSidePanelSnapshot {
  readonly bottomPanelOpen: boolean;
  readonly focusArea: "main" | "right-panel" | "bottom-panel";
  readonly rightPanelFullWidth: boolean;
  readonly rightPanelOpen: boolean;
  readonly sourceBrowserConversationId: string;
  readonly tabs: readonly CodexForkBrowserTabDescriptor[];
  readonly targetBrowserConversationId: string;
}

export interface CodexForkBrowserRuntime {
  getBrowserUseStateSnapshot(): BrowserSidebarBrowserUseStateSnapshot;
  getConversationBrowserTabIds(browserConversationId: string): string[];
  getDeviceToolbarTabState(
    identity: { browserConversationId: string; browserTabId: string },
  ): BrowserSidebarDeviceToolbarState;
  getStateSnapshot(): BrowserSidebarStateSnapshot;
  openClonedBrowserTab(input: {
    browserConversationId: string;
    browserTabId: string;
    initialUrl?: string;
    projectId: string | null;
  }): unknown;
  primeTransferredBrowserTabId(
    browserConversationId: string,
    browserTabId: string,
  ): void;
  setDeviceToolbarTabState(
    identity: { browserConversationId: string; browserTabId: string },
    state: BrowserSidebarDeviceToolbarState,
  ): void;
}

export interface CodexForkBrowserSnapshotAdapterDependencies {
  createTargetBrowserPanelTab(input: {
    browserTabId: string;
    durableTabId: string;
    initialUrl?: string;
    panel: PanelId;
    targetProjectSession: ProjectSession;
  }): ProjectSessionTab;
  getProjectSession(projectSessionId: string): ProjectSession | null;
  resolveBrowserConversationId(conversationId: string): string;
  resolveProjectSession(conversationId: string): ProjectSession | null;
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
  browserTabId: string,
) {
  return state.tabs.find((tab) =>
    tab.browserConversationId === browserConversationId
    && tab.browserTabId === browserTabId
  ) ?? null;
}

function browserUseSnapshot(
  state: BrowserSidebarBrowserUseStateSnapshot,
  browserConversationId: string,
  browserTabId: string,
) {
  return state.tabs.find((tab) =>
    tab.browserConversationId === browserConversationId
    && tab.browserTabId === browserTabId
    && !tab.released
  ) ?? null;
}

function captureBrowserDescriptor(input: {
  browserConversationId: string;
  browserState: BrowserSidebarStateSnapshot;
  browserUseState: BrowserSidebarBrowserUseStateSnapshot;
  insertAfterTabId: string | null;
  panel: PanelId;
  runtime: CodexForkBrowserRuntime;
  tab: ProjectSessionTab;
  activeTabId: string | null;
}): CodexForkBrowserTabDescriptor {
  const browserTabId = requireProjectSessionBrowserTabId(input.tab);
  const runtimeSnapshot = browserRuntimeSnapshot(
    input.browserState,
    input.browserConversationId,
    browserTabId,
  );
  const useSnapshot = browserUseSnapshot(
    input.browserUseState,
    input.browserConversationId,
    browserTabId,
  );
  return {
    active: input.tab.id === input.activeTabId,
    browserTabId,
    deviceToolbarState: input.runtime.getDeviceToolbarTabState({
      browserConversationId: input.browserConversationId,
      browserTabId,
    }) ?? DEFAULT_DEVICE_TOOLBAR_STATE,
    initialUrl: runtimeSnapshot?.url ?? useSnapshot?.url ?? null,
    insertAfterTabId: input.insertAfterTabId,
    kind: "browser",
    panel: input.panel,
    tabId: input.tab.id,
  };
}

function capturePanelBrowserDescriptors(input: {
  browserConversationId: string;
  browserState: BrowserSidebarStateSnapshot;
  browserUseState: BrowserSidebarBrowserUseStateSnapshot;
  panel: PanelId;
  runtime: CodexForkBrowserRuntime;
  session: ProjectSession;
}): CodexForkBrowserTabDescriptor[] {
  const activeTabId = getProjectSessionPanelActiveLeaf(
    input.session.panels[input.panel].layout,
  ).activeTabId;
  const descriptors: CodexForkBrowserTabDescriptor[] = [];
  let activeWasEncountered = false;
  let repairedActive: CodexForkBrowserTabDescriptor | null = null;
  let insertAfterTabId: string | null = null;

  for (const tab of input.session.tabs.filter((candidate) => candidate.panelId === input.panel)) {
    if (tab.id === activeTabId) {
      activeWasEncountered = true;
      repairedActive = descriptors.at(-1) ?? null;
    }
    if (tab.kind !== "browser") continue;

    const descriptor = captureBrowserDescriptor({
      ...input,
      activeTabId,
      insertAfterTabId,
      tab,
    });
    descriptors.push(descriptor);
    if (activeWasEncountered && repairedActive === null) repairedActive = descriptor;
    insertAfterTabId = descriptor.tabId;
  }

  if (!descriptors.some((descriptor) => descriptor.active) && repairedActive !== null) {
    repairedActive.active = true;
  }
  return descriptors;
}

function appendFirst(ordered: string[], seen: Set<string>, value: string): void {
  if (seen.has(value)) return;
  seen.add(value);
  ordered.push(value);
}

function captureMountedSnapshot(
  session: ProjectSession,
  browserConversationId: string,
  runtime: CodexForkBrowserRuntime,
): CodexForkBrowserSidePanelSnapshot {
  const browserState = runtime.getStateSnapshot();
  const browserUseState = runtime.getBrowserUseStateSnapshot();
  const right = capturePanelBrowserDescriptors({
    browserConversationId,
    browserState,
    browserUseState,
    panel: "right",
    runtime,
    session,
  });
  const bottom = capturePanelBrowserDescriptors({
    browserConversationId,
    browserState,
    browserUseState,
    panel: "bottom",
    runtime,
    session,
  });
  const visible = [...right, ...bottom];
  const representedBrowserIds = new Set(
    visible.map((descriptor) => descriptor.browserTabId),
  );
  const orderedBrowserIds: string[] = [];
  const seenBrowserIds = new Set<string>();
  for (const descriptor of visible) {
    appendFirst(orderedBrowserIds, seenBrowserIds, descriptor.browserTabId);
  }
  for (const browserUseTab of browserUseState.tabs) {
    if (
      browserUseTab.browserConversationId !== browserConversationId
      || browserUseTab.released
    ) {
      continue;
    }
    appendFirst(orderedBrowserIds, seenBrowserIds, browserUseTab.browserTabId);
  }

  const rememberedBrowserTabId =
    browserUseState.activeBrowserTabIdsByConversation[browserConversationId] ?? null;
  const activeRightBrowserTabId = right.find((descriptor) => descriptor.active)?.browserTabId ?? null;
  const activeBottomBrowserTabId = bottom.find((descriptor) => descriptor.active)?.browserTabId ?? null;
  const focusedBrowserTabId = rememberedBrowserTabId !== null
    && seenBrowserIds.has(rememberedBrowserTabId)
    ? rememberedBrowserTabId
    : activeRightBrowserTabId
      ?? activeBottomBrowserTabId
      ?? orderedBrowserIds.at(-1)
      ?? null;
  const extras: CodexForkBrowserTabDescriptor[] = [];
  let insertAfterTabId = right.at(-1)?.tabId ?? null;
  for (const browserTabId of orderedBrowserIds) {
    if (representedBrowserIds.has(browserTabId)) continue;
    representedBrowserIds.add(browserTabId);
    const snapshot = browserRuntimeSnapshot(
      browserState,
      browserConversationId,
      browserTabId,
    );
    const useSnapshot = browserUseSnapshot(
      browserUseState,
      browserConversationId,
      browserTabId,
    );
    const descriptor: CodexForkBrowserTabDescriptor = {
      active: browserTabId === focusedBrowserTabId,
      browserTabId,
      deviceToolbarState: runtime.getDeviceToolbarTabState({
        browserConversationId,
        browserTabId,
      }),
      initialUrl: snapshot?.url ?? useSnapshot?.url ?? null,
      insertAfterTabId,
      kind: "browser",
      panel: "right",
      tabId: browserTabId,
    };
    extras.push(descriptor);
    insertAfterTabId = descriptor.tabId;
  }

  return {
    bottomPanelOpen: !session.panels.bottom.collapsed,
    focusArea: "main",
    rightPanelFullWidth: session.panels.right.size.fullWidth === true,
    rightPanelOpen: !session.panels.right.collapsed,
    sourceBrowserConversationId: browserConversationId,
    tabs: [...visible, ...extras],
    targetBrowserConversationId: browserConversationId,
  };
}

function captureFallbackSnapshot(
  browserConversationId: string,
  runtime: CodexForkBrowserRuntime,
): CodexForkBrowserSidePanelSnapshot {
  const browserState = runtime.getStateSnapshot();
  const browserUseState = runtime.getBrowserUseStateSnapshot();
  const browserTabIds = runtime.getConversationBrowserTabIds(browserConversationId);
  return {
    bottomPanelOpen: false,
    focusArea: "main",
    rightPanelFullWidth: false,
    rightPanelOpen: false,
    sourceBrowserConversationId: browserConversationId,
    tabs: browserTabIds.map((browserTabId, index) => {
      const snapshot = browserRuntimeSnapshot(
        browserState,
        browserConversationId,
        browserTabId,
      );
      const useSnapshot = browserUseSnapshot(
        browserUseState,
        browserConversationId,
        browserTabId,
      );
      return {
        active: index === browserTabIds.length - 1,
        browserTabId,
        deviceToolbarState: runtime.getDeviceToolbarTabState({
          browserConversationId,
          browserTabId,
        }),
        initialUrl: snapshot?.url ?? useSnapshot?.url ?? null,
        insertAfterTabId: browserTabIds[index - 1] ?? null,
        kind: "browser" as const,
        panel: "right" as const,
        tabId: browserTabId,
      };
    }),
    targetBrowserConversationId: browserConversationId,
  };
}

function rebaseSnapshot(
  snapshot: CodexForkBrowserSidePanelSnapshot,
  targetBrowserConversationId: string,
): CodexForkBrowserSidePanelSnapshot {
  const sourceDefaultBrowserTabId = makeDefaultBrowserSidebarTabId(
    snapshot.sourceBrowserConversationId,
  );
  const targetDefaultBrowserTabId = makeDefaultBrowserSidebarTabId(
    targetBrowserConversationId,
  );
  const targetTabIdsBySourceTabId = new Map<string, string>();
  for (const descriptor of snapshot.tabs) {
    targetTabIdsBySourceTabId.set(
      descriptor.tabId,
      descriptor.browserTabId === sourceDefaultBrowserTabId
        ? targetDefaultBrowserTabId
        : descriptor.tabId,
    );
  }

  return {
    ...snapshot,
    tabs: snapshot.tabs.map((descriptor) => ({
      ...descriptor,
      browserTabId: descriptor.browserTabId === sourceDefaultBrowserTabId
        ? targetDefaultBrowserTabId
        : descriptor.browserTabId,
      insertAfterTabId: descriptor.insertAfterTabId === null
        ? null
        : targetTabIdsBySourceTabId.get(descriptor.insertAfterTabId)
          ?? descriptor.insertAfterTabId,
      tabId: targetTabIdsBySourceTabId.get(descriptor.tabId)
        ?? descriptor.tabId,
    })),
    targetBrowserConversationId,
  };
}

function makeDurableTargetTabId(
  targetProjectSessionId: string,
  descriptor: CodexForkBrowserTabDescriptor,
  index: number,
): string {
  const digest = createHash("sha256")
    .update(targetProjectSessionId)
    .update("\0")
    .update(descriptor.tabId)
    .update("\0")
    .update(String(index))
    .digest("hex");
  return `fork-browser:${digest.slice(0, 48)}`;
}

export function createCodexForkBrowserSnapshotAdapter(
  dependencies: CodexForkBrowserSnapshotAdapterDependencies,
): CodexForkSidePanelSnapshotAdapter<CodexForkBrowserSidePanelSnapshot> {
  return {
    capture(sourceConversationId) {
      const session = dependencies.resolveProjectSession(sourceConversationId);
      const browserConversationId = session?.id
        ?? dependencies.resolveBrowserConversationId(sourceConversationId);
      return session
        ? captureMountedSnapshot(session, browserConversationId, dependencies.runtime)
        : captureFallbackSnapshot(browserConversationId, dependencies.runtime);
    },

    rebase(snapshot, input) {
      return rebaseSnapshot(
        snapshot,
        dependencies.resolveBrowserConversationId(input.targetConversationId),
      );
    },

    apply(snapshot, input) {
      const targetProjectSession = dependencies.getProjectSession(
        input.targetProjectSessionId,
      );
      if (!targetProjectSession) {
        throw new Error("Target project session was not found");
      }
      if (snapshot.targetBrowserConversationId !== targetProjectSession.id) {
        throw new Error("Target browser conversation identity is not stable");
      }

      snapshot.tabs.forEach((descriptor, index) => {
        if (
          descriptor.browserTabId
          !== makeDefaultBrowserSidebarTabId(snapshot.targetBrowserConversationId)
        ) {
          dependencies.runtime.primeTransferredBrowserTabId(
            snapshot.targetBrowserConversationId,
            descriptor.browserTabId,
          );
        }
        const initialUrl = descriptor.initialUrl ?? undefined;
        dependencies.createTargetBrowserPanelTab({
          browserTabId: descriptor.browserTabId,
          durableTabId: makeDurableTargetTabId(
            input.targetProjectSessionId,
            descriptor,
            index,
          ),
          ...(initialUrl === undefined ? {} : { initialUrl }),
          panel: descriptor.panel,
          targetProjectSession,
        });
        dependencies.runtime.openClonedBrowserTab({
          browserConversationId: snapshot.targetBrowserConversationId,
          browserTabId: descriptor.browserTabId,
          ...(initialUrl === undefined ? {} : { initialUrl }),
          projectId: targetProjectSession.projectId,
        });
        dependencies.runtime.setDeviceToolbarTabState(
          {
            browserConversationId: snapshot.targetBrowserConversationId,
            browserTabId: descriptor.browserTabId,
          },
          descriptor.deviceToolbarState,
        );
      });
    },
  };
}
