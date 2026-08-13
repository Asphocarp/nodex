import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  fireEvent,
  getByRole,
  waitFor,
} from "@testing-library/dom";
import {
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  BrowserPageFailure,
  BrowserSidebarBrowserUseStateSnapshot,
  BrowserSidebarBrowserUseViewportEvent,
  BrowserSidebarLocalServersSnapshot,
  BrowserSidebarTabSnapshot,
  BrowserSidebarViewport,
  BrowserUseCursorState,
} from "../../../shared/browser-sidebar";
import type {
  BrowserDownloadsSnapshot,
} from "../../../shared/browser-download";
import type {
  BrowserAnnotationAnchor,
  BrowserAnnotationDesignChange,
} from "../../../shared/browser-annotation";
import type { WorkbenchTabProjection } from "@/lib/types";
import type {
  WorkbenchSessionRenderProjection,
} from "@/lib/workbench-session-presentation";
import {
  BrowserAnnotationComposer,
  BrowserCommentOverlay,
  BrowserDownloadsPage,
  BrowserNewTabState,
  BrowserPageFailureState,
  BrowserSidebarPanel,
  BrowserUnavailableState,
  BrowserWebviewStage,
} from "./browser-sidebar-panel";
import { BrowserProfileImportDialog } from "./browser-profile-import-dialog";
import { BrowserUseCursorOverlay } from "./browser-use-cursor-portal";

const meta = {
  title: "Browser/Platform matrix",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;
type PanelKind = "bottom" | "right";
type StoryTheme = "dark" | "light";

interface BrowserStoryFixture {
  downloads?: BrowserDownloadsSnapshot;
  localServers?: BrowserSidebarLocalServersSnapshot;
  snapshot: BrowserSidebarTabSnapshot;
  browserUseState?: BrowserSidebarBrowserUseStateSnapshot;
  cursor?: BrowserUseCursorState;
  viewport?: BrowserSidebarBrowserUseViewportEvent;
}

const browserStoryFixtures = new Map<string, BrowserStoryFixture>();
let storyProfileDownloads: BrowserDownloadsSnapshot = { downloads: [] };

function storyFixtureKey(input: {
  browserConversationId: string;
  browserViewScopeId: string;
  browserTabId: string;
}): string {
  return `${input.browserConversationId}\0${input.browserViewScopeId}\0${input.browserTabId}`;
}

function installBrowserStoryApi(): void {
  if (typeof window === "undefined" || window.api) return;
  const api = {
    invoke: async (channel: string, ...args: unknown[]) => {
      if (channel === "browser-sidebar-command") {
        const command = args[0] as {
          browserConversationId?: string;
          browserViewScopeId?: string;
          browserTabId?: string;
          type?: string;
        } | undefined;
        const fixture = command?.browserConversationId
          && command.browserViewScopeId
          && command.browserTabId
          ? browserStoryFixtures.get(storyFixtureKey({
              browserConversationId: command.browserConversationId,
              browserViewScopeId: command.browserViewScopeId,
              browserTabId: command.browserTabId,
            }))
          : undefined;
        return {
          ok: true,
          ...(command?.type === "register-tab" && fixture
            ? { snapshot: fixture.snapshot }
            : {}),
        };
      }
      if (channel === "browser-local-server-preferences-get") {
        return {
          expandedProjectIds: ["alpha"],
          showMode: "online",
          sortMode: "recently-used",
        };
      }
      if (channel === "browser-downloads-list") {
        return storyProfileDownloads;
      }
      if (channel === "browser-site-info") {
        return {
          connection: "secure",
          cookieCount: 4,
          origin: "https://design.example",
          permissions: [
            { permission: "camera", state: "block" },
            { permission: "clipboard-sanitized-write", state: "allow" },
          ],
        };
      }
      if (channel === "browser-credentials-list") return [];
      if (channel === "browser-contact-info-list") return [];
      if (channel === "browser-profile-import-profiles") {
        return [{
          source: "chrome",
          appName: "Google Chrome",
          profileName: "Default",
          profileDirectoryName: "Default",
          profilePath: "/Users/example/Library/Application Support/Google/Chrome/Default",
          rootPath: "/Users/example/Library/Application Support/Google/Chrome",
          hasCookies: true,
          hasPasswords: true,
          sourceBrowserOpen: false,
          userName: "design@example.com",
        }];
      }
      if (channel === "browser-profile-capabilities") {
        const available = {
          available: true,
          provider: "product-owned",
        };
        return {
          contactInfo: available,
          credentialVault: available,
          extensions: {
            available: false,
            provider: "unavailable",
            reason: "Extensions are unavailable in this build.",
          },
          history: {
            available: true,
            provider: "electron-public-api",
          },
          profileImport: available,
          siteInfo: {
            available: true,
            provider: "electron-public-api",
          },
        };
      }
      if (channel === "browser-local-server-thumbnail") {
        return {
          status: "ready",
          dataUrl: LOCAL_SERVER_THUMBNAIL,
          capturedAt: 100,
        };
      }
      return { ok: true };
    },
    on: (
      channel: string,
      listener: (payload: unknown) => void,
    ) => {
      let disposed = false;
      queueMicrotask(() => {
        if (disposed) return;
        if (channel === "browser-sidebar-state") {
          listener({
            tabs: [...browserStoryFixtures.values()].map(
              (fixture) => fixture.snapshot,
            ),
          });
          return;
        }
        if (channel === "browser-sidebar-local-servers") {
          for (const fixture of browserStoryFixtures.values()) {
            if (fixture.localServers) listener(fixture.localServers);
          }
          return;
        }
        if (channel === "browser-sidebar-browser-use-state") {
          for (const fixture of browserStoryFixtures.values()) {
            if (fixture.browserUseState) listener(fixture.browserUseState);
          }
          return;
        }
        if (channel === "browser-sidebar-browser-use-cursor-state") {
          for (const fixture of browserStoryFixtures.values()) {
            if (fixture.cursor) listener(fixture.cursor);
          }
          return;
        }
        if (channel === "browser-sidebar-browser-use-viewport") {
          for (const fixture of browserStoryFixtures.values()) {
            if (fixture.viewport) listener(fixture.viewport);
          }
          return;
        }
        if (channel === "browser-downloads-state") {
          listener(storyProfileDownloads);
        }
      });
      return () => {
        disposed = true;
      };
    },
  };
  Object.defineProperty(window, "api", {
    configurable: true,
    value: api as unknown as typeof window.api,
  });
}

installBrowserStoryApi();

export const BlankLocalServers: Story = {
  render: () => (
    <BrowserStoryFrame>
      <BrowserNewTabState
        projectId="alpha"
        localServers={localServersFixture}
        onRefresh={() => undefined}
        onOpen={() => undefined}
        onRequestThumbnail={async () => ({
          status: "ready",
          dataUrl: LOCAL_SERVER_THUMBNAIL,
          capturedAt: 100,
        })}
        onHideServer={() => undefined}
        onUnhideServer={() => undefined}
        onRemoveRoute={() => undefined}
      />
    </BrowserStoryFrame>
  ),
};

export const LoadedRightPanel: Story = {
  render: () => (
    <BrowserPanelStory fixtureId="loaded-right" />
  ),
};

export const LoadedBottomPanel: Story = {
  render: () => (
    <BrowserPanelStory
      fixtureId="loaded-bottom"
      panelKind="bottom"
      width={980}
      height={420}
    />
  ),
};

export const LoadedNarrowRightPanel: Story = {
  render: () => (
    <BrowserPanelStory
      fixtureId="loaded-narrow"
      width={390}
    />
  ),
};

export const LoadedDark: Story = {
  render: () => (
    <BrowserPanelStory
      fixtureId="loaded-dark"
      theme="dark"
    />
  ),
};

export const ClosingPanelHost: Story = {
  render: () => (
    <BrowserPanelStory
      fixtureId="closing-panel-host"
      isVisible={false}
    />
  ),
};

export const LoadingLongUrl: Story = {
  render: () => (
    <BrowserPanelStory
      fixtureId="loading"
      snapshotOverrides={{
        isLoading: true,
        pendingUrl:
          "https://design.example/research/browser-platform?mode=full-parity&source=runtime-evidence",
        url:
          "https://design.example/research/browser-platform?mode=full-parity&source=runtime-evidence",
      }}
    />
  ),
};

export const WaitingForFirstResponse: Story = {
  render: () => (
    <BrowserPanelStory
      fixtureId="waiting-for-response"
      snapshotOverrides={{
        isLoading: true,
        isWaitingForResponse: true,
        pendingUrl: "https://design.example/research/loading-motion",
      }}
    />
  ),
};

export const FindOpen: Story = {
  render: () => (
    <BrowserPanelStory
      fixtureId="find-open"
      snapshotOverrides={{
        findState: {
          open: true,
          query: "browser",
          activeMatchOrdinal: 3,
          matchCount: 14,
          caseSensitive: false,
        },
      }}
    />
  ),
};

export const OptionsOpen: Story = {
  render: () => (
    <BrowserPanelStory fixtureId="options-open" />
  ),
  play: async ({ canvasElement }) => {
    const trigger = getByRole(canvasElement, "button", {
      name: "Browser options",
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    await waitFor(() =>
      getByRole(document.body, "menuitem", { name: "Force reload" })
    );
  },
};

export const SiteInfoOpen: Story = {
  render: () => (
    <BrowserPanelStory fixtureId="site-info-open" />
  ),
  play: async ({ canvasElement }) => {
    const trigger = getByRole(canvasElement, "button", {
      name: "Site information",
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    await waitFor(() =>
      getByRole(document.body, "menuitem", { name: "Clear site data" })
    );
  },
};

export const DeviceResponsive: Story = {
  render: () => (
    <BrowserPanelStory
      fixtureId="device-responsive"
      snapshotOverrides={{
        deviceToolbarVisible: true,
        viewport: {
          width: 0,
          height: 0,
          zoomPercent: 100,
          presetId: "responsive",
        },
      }}
    />
  ),
};

export const DeviceFixed: Story = {
  render: () => (
    <BrowserPanelStory
      fixtureId="device-fixed"
      snapshotOverrides={{
        deviceToolbarVisible: true,
        viewport: {
          width: 393,
          height: 852,
          zoomPercent: 75,
          presetId: "iphone-15-pro",
        },
      }}
    />
  ),
};

export const AgentCursor: Story = {
  render: () => (
    <BrowserPanelStory fixtureId="agent-cursor" showAgentCursor />
  ),
};

export const ActiveDownloadIndicator: Story = {
  render: () => (
    <BrowserPanelStory
      fixtureId="active-download"
      downloads={downloadsFixture}
    />
  ),
};

export const DownloadsHistory: Story = {
  render: () => (
    <BrowserStoryFrame>
      <BrowserDownloadsPage
        snapshot={downloadsFixture}
        onClose={() => undefined}
        onAction={async () => undefined}
        onClearHistory={async () => undefined}
      />
    </BrowserStoryFrame>
  ),
};

export const ErrorDns: Story = failureStory({
  kind: "dns",
  failedUrl: "https://missing.example.test/",
  code: -105,
});

export const ErrorOffline: Story = failureStory({
  kind: "offline",
  failedUrl: "https://offline.example.test/",
  code: -106,
});

export const ErrorRefused: Story = failureStory({
  kind: "refused",
  failedUrl: "http://localhost:4567/",
  code: -102,
});

export const ErrorTimeout: Story = failureStory({
  kind: "timeout",
  failedUrl: "https://slow.example.test/",
  code: -118,
});

export const ErrorCertificate: Story = failureStory({
  kind: "certificate",
  failedUrl: "https://expired.example.test/",
  code: -202,
});

export const ErrorBlocked: Story = failureStory({
  kind: "blocked",
  failedUrl: "file:///Users/example/private.txt",
  policy: "navigation-policy",
});

export const ErrorGeneric: Story = failureStory({
  kind: "generic",
  failedUrl: "https://broken.example.test/",
  code: -2,
  description: "Chromium could not complete the request.",
});

export const ErrorCrashed: Story = failureStory({
  kind: "crashed",
  failedUrl: "https://crashed.example.test/",
  reason: "crashed",
});

export const AnnotationQuick: Story = {
  render: () => (
    <AnnotationStory intent="comment" anchors={[]} />
  ),
};

export const AnnotationBatch: Story = {
  render: () => (
    <AnnotationStory intent="comment" anchors={annotationAnchorsFixture} />
  ),
};

export const AnnotationDesign: Story = {
  render: () => (
    <AnnotationStory
      intent="designChange"
      anchors={annotationAnchorsFixture}
    />
  ),
};

export const AnnotationOriginalView: Story = {
  render: () => (
    <AnnotationStory
      intent="designChange"
      anchors={annotationAnchorsFixture}
      originalView
    />
  ),
};

export const ProfileImportDialog: Story = {
  render: () => (
    <BrowserStoryFrame width={720}>
      <BrowserProfileImportDialog
        open
        onOpenChange={() => undefined}
      />
    </BrowserStoryFrame>
  ),
};

export const NonElectronUnavailable: Story = {
  render: () => (
    <BrowserStoryFrame>
      <BrowserUnavailableState />
    </BrowserStoryFrame>
  ),
};

function BrowserPanelStory({
  downloads,
  fixtureId,
  height = 720,
  isVisible = true,
  panelKind = "right",
  showAgentCursor = false,
  snapshotOverrides = {},
  theme = "light",
  width = 520,
}: {
  downloads?: BrowserDownloadsSnapshot;
  fixtureId: string;
  height?: number;
  isVisible?: boolean;
  panelKind?: PanelKind;
  showAgentCursor?: boolean;
  snapshotOverrides?: Partial<BrowserSidebarTabSnapshot>;
  theme?: StoryTheme;
  width?: number;
}) {
  const browserConversationId = `storybook-session-${fixtureId}`;
  const browserViewScopeId = `storybook-window-${fixtureId}`;
  const browserTabId = `storybook-browser-${fixtureId}`;
  const snapshot = makeBrowserSnapshot({
    browserConversationId,
    browserViewScopeId,
    browserTabId,
    overrides: snapshotOverrides,
  });
  const fixture: BrowserStoryFixture = {
    snapshot,
    downloads,
    localServers: localServersFixture,
    ...(showAgentCursor
      ? makeBrowserUseFixture(snapshot)
      : {}),
  };
  browserStoryFixtures.set(storyFixtureKey(snapshot), fixture);
  if (downloads) storyProfileDownloads = downloads;
  const tab = makeBrowserTab(snapshot, panelKind);
  const activeSession = makeBrowserSession(snapshot, tab, panelKind);
  return (
    <BrowserStoryFrame
      height={height}
      theme={theme}
      width={width}
    >
      <BrowserSidebarPanel
        tab={tab}
        activeSession={activeSession}
        browserViewScopeId={browserViewScopeId}
        isVisible={isVisible}
        onRefreshSessions={async () => [activeSession]}
      />
    </BrowserStoryFrame>
  );
}

function makeBrowserSnapshot({
  browserConversationId,
  browserViewScopeId,
  browserTabId,
  overrides,
}: {
  browserConversationId: string;
  browserViewScopeId: string;
  browserTabId: string;
  overrides: Partial<BrowserSidebarTabSnapshot>;
}): BrowserSidebarTabSnapshot {
  return {
    browserConversationId,
    browserViewScopeId,
    browserTabId,
    browserStorageId: `storage:${browserTabId}`,
    projectId: "alpha",
    webContentsId: 42,
    mountGeneration: 1,
    url: "https://design.example/browser-platform",
    title: "Browser platform",
    isLoading: false,
    isWaitingForResponse: false,
    canGoBack: true,
    canGoForward: true,
    zoomPercent: 100,
    deviceToolbarVisible: false,
    viewport: {
      width: 390,
      height: 844,
      zoomPercent: 100,
      presetId: "responsive",
    },
    deviceToolbarState: {
      responsiveViewportSize: null,
      toolbarState: {
        isEnabled: false,
        presetId: "responsive",
        width: 390,
        height: 844,
      },
    },
    interactionMode: "browse",
    findState: {
      open: false,
      query: "",
      activeMatchOrdinal: null,
      matchCount: null,
      caseSensitive: false,
    },
    hasBrowserPage: true,
    pageActionsDisabled: false,
    presented: true,
    visible: true,
    lifecycleState: "live-attached",
    updatedAt: 100,
    ...overrides,
  };
}

function makeBrowserTab(
  snapshot: BrowserSidebarTabSnapshot,
  panelKind: PanelKind,
): WorkbenchTabProjection {
  return {
    id: snapshot.browserTabId,
    sessionId: snapshot.browserConversationId,
    browserTabId: snapshot.browserTabId,
    projectId: "alpha",
    panelId: panelKind,
    kind: "browser",
    title: snapshot.title,
    order: 0,
    config: {
      projectId: "alpha",
      url: snapshot.url,
      title: snapshot.title,
      browserStorageId: snapshot.browserStorageId,
      deviceToolbarVisible: snapshot.deviceToolbarVisible,
      deviceToolbarState: snapshot.deviceToolbarState,
    },
    stateKey: 0,
    state: null,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  };
}

function makeBrowserSession(
  snapshot: BrowserSidebarTabSnapshot,
  tab: WorkbenchTabProjection,
  panelKind: PanelKind,
): WorkbenchSessionRenderProjection {
  const rightTabIds = panelKind === "right" ? [tab.id] : [];
  const bottomTabIds = panelKind === "bottom" ? [tab.id] : [];
  return {
    id: snapshot.browserConversationId,
    projectId: "alpha",
    noThreadFallbackTitle: "Browser",
    displayTitle: "Browser",
    order: 0,
    pinned: false,
    pinnedOrder: null,
    archived: false,
    archivedAt: null,
    unread: false,
    panels: {
      right: {
        collapsed: false,
        layout: {
          version: 2,
          root: {
            type: "leaf",
            id: "right-root",
            tabIds: rightTabIds,
            activeTabId: rightTabIds[0] ?? null,
            mruTabIds: rightTabIds,
          },
          activeLeafId: "right-root",
          mruLeafIds: ["right-root"],
        },
        size: {},
      },
      bottom: {
        collapsed: false,
        layout: {
          version: 2,
          root: {
            type: "leaf",
            id: "bottom-root",
            tabIds: bottomTabIds,
            activeTabId: bottomTabIds[0] ?? null,
            mruTabIds: bottomTabIds,
          },
          activeLeafId: "bottom-root",
          mruLeafIds: ["bottom-root"],
        },
        size: {},
      },
    },
    thread: null,
    tabs: [tab],
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  };
}

function makeBrowserUseFixture(
  snapshot: BrowserSidebarTabSnapshot,
): Pick<
  BrowserStoryFixture,
  "browserUseState" | "cursor" | "viewport"
> {
  const cursor: BrowserUseCursorState = {
    browserConversationId: snapshot.browserConversationId,
    browserViewScopeId: snapshot.browserViewScopeId,
    browserTabId: snapshot.browserTabId,
    moveSequence: 7,
    x: 190,
    y: 160,
    visible: true,
    updatedAt: 100,
  };
  return {
    cursor,
    viewport: {
      browserConversationId: snapshot.browserConversationId,
      browserViewScopeId: snapshot.browserViewScopeId,
      browserTabId: snapshot.browserTabId,
      viewportSize: { width: 390, height: 844 },
    },
    browserUseState: {
      tabs: [{
        browserConversationId: snapshot.browserConversationId,
        browserViewScopeId: snapshot.browserViewScopeId,
        browserTabId: snapshot.browserTabId,
        codexSessionId: "thread-1",
        projectId: "alpha",
        title: "Browser agent",
        url: snapshot.url,
        webContentsId: 42,
        viewport: snapshot.viewport,
        captureActive: false,
        released: false,
        updatedAt: 100,
      }],
      activeBrowserTabIdsByConversationScope: {
        [`${snapshot.browserConversationId}\0${snapshot.browserViewScopeId}`]:
          snapshot.browserTabId,
      },
      cursors: [cursor],
    },
  };
}

function AnnotationStory({
  anchors: initialAnchors,
  intent: initialIntent,
  originalView: initialOriginalView = false,
}: {
  anchors: BrowserAnnotationAnchor[];
  intent: "comment" | "designChange";
  originalView?: boolean;
}) {
  const [anchors, setAnchors] = useState(initialAnchors);
  const [intent, setIntent] = useState(initialIntent);
  const [note, setNote] = useState(
    initialIntent === "designChange"
      ? "Use the product accent for this call to action."
      : "This section should explain the Browser security boundary.",
  );
  const [originalView, setOriginalView] = useState(initialOriginalView);
  const [selectionMode, setSelectionMode] =
    useState<"inspect" | "region">("inspect");
  const [designChange, setDesignChange] =
    useState<BrowserAnnotationDesignChange | null>({
      anchorId: annotationAnchorsFixture[0]?.id ?? "",
      property: "backgroundColor",
      before: "rgb(28, 32, 38)",
      after: "rgb(34, 111, 219)",
    });
  return (
    <BrowserStoryFrame>
      <div className="absolute inset-0 bg-[linear-gradient(145deg,#f8fafc,#dbeafe)] p-8 text-slate-900">
        <h2 className="text-2xl font-semibold">Browser platform</h2>
        <p className="mt-3 max-w-sm text-sm leading-6 text-slate-600">
          A page fixture under the production annotation overlay.
        </p>
        <button
          type="button"
          className="mt-8 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white"
        >
          Inspect this element
        </button>
      </div>
      <BrowserCommentOverlay>
        <BrowserAnnotationComposer
          anchors={anchors}
          designChange={designChange}
          intent={intent}
          note={note}
          originalView={originalView}
          selectionMode={selectionMode}
          onDesignChange={(input) => {
            const anchor = anchors.find(
              (candidate) => candidate.id === input.anchorId,
            );
            setDesignChange({
              ...input,
              before:
                anchor?.computedStyle?.[input.property] ?? "",
            });
          }}
          onIntentChange={setIntent}
          onNoteChange={setNote}
          onOriginalViewChange={setOriginalView}
          onSelectionModeChange={setSelectionMode}
          onRemoveAnchor={(anchorId) => {
            setAnchors((current) =>
              current.filter((anchor) => anchor.id !== anchorId)
            );
          }}
          onDiscard={() => setAnchors([])}
          onAddToComposer={() => undefined}
        />
      </BrowserCommentOverlay>
    </BrowserStoryFrame>
  );
}

function failureStory(failure: BrowserPageFailure): Story {
  return {
    render: () => (
      <BrowserStoryFrame>
        <BrowserPageFailureState
          failure={failure}
          onBack={() => undefined}
          onRetry={() => undefined}
        />
      </BrowserStoryFrame>
    ),
  };
}

function LoadedStageStory() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<BrowserSidebarViewport>({
    width: 0,
    height: 0,
    zoomPercent: 100,
    presetId: "responsive",
  });

  return (
    <BrowserStoryFrame>
      <BrowserWebviewStage
        activeSessionId="storybook-session"
        tabId="browser-tab"
        deviceToolbarVisible={false}
        viewport={viewport}
        webviewHostRef={hostRef}
        onViewportChange={setViewport}
        onCloseDeviceToolbar={() => undefined}
      >
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-white text-sm text-slate-700">
          design.example fixture page
        </div>
      </BrowserWebviewStage>
    </BrowserStoryFrame>
  );
}

export const LoadedPageFlushStage: Story = {
  render: () => <LoadedStageStory />,
};

export const CursorOverlayOnly: Story = {
  render: () => (
    <BrowserStoryFrame>
      <BrowserUseCursorOverlay
        cursor={{
          browserConversationId: "storybook-session",
          browserViewScopeId: "storybook-window",
          browserTabId: "storybook-browser",
          moveSequence: 1,
          x: 180,
          y: 150,
          visible: true,
          updatedAt: 1,
        }}
        turnKey="storybook-session:active"
        viewportSize={{ width: 390, height: 844 }}
      />
    </BrowserStoryFrame>
  ),
};

function BrowserStoryFrame({
  children,
  height = 720,
  theme = "light",
  width = 520,
}: {
  children: ReactNode;
  height?: number;
  theme?: StoryTheme;
  width?: number;
}) {
  return (
    <div
      data-codex-window-type="electron"
      className={
        theme === "dark"
          ? "dark electron-dark h-screen bg-token-main-surface-primary p-8 text-token-foreground"
          : "h-screen bg-token-main-surface-primary p-8 text-token-foreground"
      }
    >
      <div
        className="relative mx-auto overflow-hidden border border-token-border bg-token-main-surface-primary"
        style={{ height, width }}
      >
        {children}
      </div>
    </div>
  );
}

const annotationAnchorsFixture: BrowserAnnotationAnchor[] = [
  {
    id: "annotation-button",
    kind: "element",
    pageUrl: "https://design.example/browser-platform",
    selector: "main > button:nth-of-type(1)",
    elementPath: "main > button:nth-of-type(1)",
    textExcerpt: "Inspect this element",
    nearbyText: "Browser platform Inspect this element",
    computedStyle: {
      color: "rgb(255, 255, 255)",
      backgroundColor: "rgb(28, 32, 38)",
      fontSize: "14px",
      borderRadius: "8px",
      opacity: "1",
    },
    viewportSize: { width: 520, height: 720 },
    rect: { x: 32, y: 145, width: 164, height: 36 },
  },
  {
    id: "annotation-copy",
    kind: "text",
    pageUrl: "https://design.example/browser-platform",
    selector: "main > p",
    elementPath: "main > p",
    textExcerpt: "Browser security boundary",
    nearbyText: "A page fixture under the production annotation overlay.",
    viewportSize: { width: 520, height: 720 },
    rect: { x: 32, y: 78, width: 310, height: 44 },
  },
  {
    id: "annotation-region",
    kind: "region",
    pageUrl: "https://design.example/browser-platform",
    viewportSize: { width: 520, height: 720 },
    rect: { x: 24, y: 24, width: 380, height: 190 },
  },
];

const downloadsFixture: BrowserDownloadsSnapshot = {
  downloads: [
    {
      id: "download-active",
      browserConversationId: "storybook-session",
      browserViewScopeId: "storybook-window",
      browserTabId: "browser-tab",
      fileName: "product-spec.pdf",
      savePath: "/Downloads/product-spec.pdf",
      sourceOrigin: "https://design.example",
      status: "progressing",
      receivedBytes: 2_621_440,
      totalBytes: 8_388_608,
      startedAt: 100,
      updatedAt: 101,
    },
    {
      id: "download-complete",
      browserConversationId: "storybook-session",
      browserViewScopeId: "storybook-window",
      browserTabId: "browser-tab",
      fileName: "reference.png",
      savePath: "/Downloads/reference.png",
      sourceOrigin: "https://assets.example.com",
      status: "completed",
      receivedBytes: 1_048_576,
      totalBytes: 1_048_576,
      startedAt: 90,
      updatedAt: 95,
      completedAt: 95,
    },
  ],
};

const localServersFixture: BrowserSidebarLocalServersSnapshot = {
  projectId: "alpha",
  isLoading: false,
  hiddenServerIds: [],
  hiddenRouteIds: [],
  updatedAt: 100,
  servers: [
    {
      id: "http://localhost:5001",
      origin: "http://localhost:5001",
      host: "localhost",
      port: 5001,
      protocol: "http:",
      lastSeenAt: 100,
      online: true,
      hidden: false,
      routes: [
        {
          id: "http://localhost:5001/",
          path: "/",
          title: "Nodex design preview",
          lastSeenAt: 100,
          hidden: false,
        },
      ],
    },
  ],
};

const LOCAL_SERVER_THUMBNAIL =
  "data:image/svg+xml;charset=utf-8,"
  + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">'
      + '<defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#eff6ff"/><stop offset="1" stop-color="#dbeafe"/></linearGradient></defs>'
      + '<rect width="640" height="360" fill="url(#g)"/>'
      + '<rect x="48" y="48" width="544" height="48" rx="12" fill="#fff" opacity=".95"/>'
      + '<rect x="48" y="120" width="340" height="26" rx="8" fill="#1e293b" opacity=".88"/>'
      + '<rect x="48" y="162" width="440" height="14" rx="7" fill="#64748b" opacity=".45"/>'
      + '<rect x="48" y="192" width="390" height="14" rx="7" fill="#64748b" opacity=".32"/>'
      + '<rect x="48" y="250" width="120" height="42" rx="12" fill="#2563eb"/>'
      + "</svg>",
  );
