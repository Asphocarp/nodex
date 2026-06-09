import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState, type ReactNode } from "react";
import type { BrowserSidebarLocalServersSnapshot, BrowserSidebarViewport } from "../../../shared/browser-sidebar";
import {
  BrowserCommentOverlay,
  BrowserNewTabState,
  BrowserUnavailableState,
  BrowserUseCursorOverlay,
  BrowserWebviewStage,
} from "./browser-sidebar-panel";

const meta = {
  title: "Browser/Right panel tab",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const BlankLocalServers: Story = {
  render: () => (
    <BrowserStoryFrame>
      <BrowserNewTabState
        projectId="alpha"
        localServers={localServersFixture}
        onRefresh={() => undefined}
        onOpen={() => undefined}
        onHideServer={() => undefined}
        onUnhideServer={() => undefined}
        onRemoveRoute={() => undefined}
      />
    </BrowserStoryFrame>
  ),
};

export const LoadedPageFlushStage: Story = {
  render: () => <LoadedStageStory />,
};

export const DeviceToolbarOpen: Story = {
  render: () => <DeviceToolbarStory />,
};

export const BrowserUseCursor: Story = {
  render: () => (
    <BrowserStoryFrame>
      <BrowserUseCursorOverlay
        x={180}
        y={150}
        label="Browser"
        viewportSize={{ width: 390, height: 844 }}
      />
    </BrowserStoryFrame>
  ),
};

export const AnnotationMode: Story = {
  render: () => (
    <BrowserStoryFrame>
      <BrowserCommentOverlay />
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
        viewportStyle={{ width: "100%", height: "100%" }}
        webviewHostRef={hostRef}
        onViewportChange={setViewport}
        onCloseDeviceToolbar={() => undefined}
      >
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-white text-sm text-slate-700">
          google.com fixture webview area
        </div>
      </BrowserWebviewStage>
    </BrowserStoryFrame>
  );
}

function DeviceToolbarStory() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<BrowserSidebarViewport>({
    width: 393,
    height: 852,
    zoomPercent: 100,
    presetId: "iphone-15-pro",
  });

  return (
    <BrowserStoryFrame>
      <BrowserWebviewStage
        activeSessionId="storybook-session"
        tabId="browser-tab"
        deviceToolbarVisible
        viewport={viewport}
        viewportStyle={{
          width: Math.max(240, viewport.width),
          height: Math.max(160, viewport.height),
          transform: `scale(${Math.max(0.25, Math.min(1, viewport.zoomPercent / 100))})`,
          transformOrigin: "center center",
        }}
        webviewHostRef={hostRef}
        onViewportChange={setViewport}
        onCloseDeviceToolbar={() => undefined}
      >
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-white text-sm text-slate-700">
          fixed viewport
        </div>
      </BrowserWebviewStage>
    </BrowserStoryFrame>
  );
}

function BrowserStoryFrame({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen bg-token-main-surface-primary p-8 text-token-foreground">
      <div className="relative mx-auto h-[720px] w-[520px] overflow-hidden border border-token-border bg-token-main-surface-primary">
        {children}
      </div>
    </div>
  );
}

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
          title: "http://localhost:5001",
          lastSeenAt: 100,
          hidden: false,
        },
      ],
    },
  ],
};
