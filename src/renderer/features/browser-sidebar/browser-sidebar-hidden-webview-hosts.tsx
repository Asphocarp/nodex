import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type {
  BrowserSidebarBrowserUseStateSnapshot,
  BrowserSidebarDestroyWebviewRequest,
  BrowserSidebarStateSnapshot,
  BrowserSidebarTabSnapshot,
  BrowserSidebarWebviewHostCreated,
  BrowserSidebarWebviewHostKind,
} from "../../../shared/browser-sidebar";
import { requireWorkbenchBrowserTabProjectionId } from "../../../shared/browser-sidebar";
import { isBlankBrowserUrl, normalizeBrowserNavigationUrl } from "../../../shared/browser-url";
import type { WorkbenchTabProjection } from "@/lib/types";
import { invoke } from "@/lib/api";
import { browserSidebarRendererWebviewManager } from "./browser-sidebar-webview-manager";
import {
  readBrowserConfigDeviceToolbarVisible,
  readBrowserConfigFavicon,
  readBrowserConfigTitle,
  readBrowserConfigUrl,
} from "./browser-sidebar-tab-config";

interface BrowserSidebarHiddenWebviewHostsProps {
  sessionId: string;
  browserViewScopeId: string;
  tabs: WorkbenchTabProjection[];
  visibleTabIds: ReadonlySet<string>;
}

interface HiddenHostDescriptor {
  browserConversationId: string;
  browserViewScopeId: string;
  browserTabId: string;
  projectId: string | null;
  hostKind: BrowserSidebarWebviewHostKind;
  initialUrl: string;
  title?: string;
  faviconUrl?: string;
  deviceToolbarVisible?: boolean;
}

export function BrowserSidebarHiddenWebviewHosts({
  sessionId,
  browserViewScopeId,
  tabs,
  visibleTabIds,
}: BrowserSidebarHiddenWebviewHostsProps) {
  const [snapshots, setSnapshots] = useState<BrowserSidebarTabSnapshot[]>([]);
  const [browserUseState, setBrowserUseState] = useState<BrowserSidebarBrowserUseStateSnapshot | null>(null);

  useEffect(() => {
    const unsubscribeState = window.api?.on("browser-sidebar-state", (payload) => {
      const state = payload as BrowserSidebarStateSnapshot | undefined;
      setSnapshots(state?.tabs ?? []);
    });
    const unsubscribeBrowserUse = window.api?.on("browser-sidebar-browser-use-state", (payload) => {
      setBrowserUseState(payload as BrowserSidebarBrowserUseStateSnapshot);
    });
    const unsubscribeDestroyWebview = window.api?.on("browser-sidebar-destroy-webview", (payload) => {
      const request = payload as BrowserSidebarDestroyWebviewRequest | undefined;
      if (!request) return;
      browserSidebarRendererWebviewManager.destroyWebviewAtHostRequest(request, (event) => {
        void invoke("browser-sidebar-webview-destroyed", event);
      });
    });
    return () => {
      unsubscribeState?.();
      unsubscribeBrowserUse?.();
      unsubscribeDestroyWebview?.();
    };
  }, []);

  const descriptors = useMemo(() => {
    const snapshotsByTabId = new Map(
      snapshots
        .filter((snapshot) =>
          snapshot.browserConversationId === sessionId
          && snapshot.browserViewScopeId === browserViewScopeId
        )
        .map((snapshot) => [snapshot.browserTabId, snapshot]),
    );
    const browserDescriptors = tabs.flatMap((tab): HiddenHostDescriptor[] => {
      if (tab.kind !== "browser") return [];
      if (visibleTabIds.has(tab.id)) return [];
      const browserTabId = requireWorkbenchBrowserTabProjectionId(tab);
      const snapshot = snapshotsByTabId.get(browserTabId);
      const snapshotUrl = snapshot?.url && !isBlankBrowserUrl(snapshot.url) ? snapshot.url : null;
      const configUrl = readBrowserConfigUrl(tab);
      const initialUrl = snapshotUrl ?? configUrl;
      if (isBlankBrowserUrl(initialUrl)) return [];
      if (snapshot && !snapshot.hasBrowserPage) return [];
      return [{
        browserConversationId: sessionId,
        browserViewScopeId,
        browserTabId,
        projectId: tab.projectId,
        hostKind: "background",
        initialUrl,
        title: snapshot?.title ?? readBrowserConfigTitle(tab) ?? tab.title,
        faviconUrl: snapshot?.faviconUrl ?? readBrowserConfigFavicon(tab),
        deviceToolbarVisible: snapshot?.deviceToolbarVisible ?? readBrowserConfigDeviceToolbarVisible(tab),
      }];
    });

    const activeBrowserUseTabId =
      browserUseState?.activeBrowserTabIdsByConversationScope[
        `${sessionId}\0${browserViewScopeId}`
      ] ?? null;
    const browserUseDescriptors = (browserUseState?.tabs ?? []).flatMap((tab): HiddenHostDescriptor[] => {
      if (tab.browserConversationId !== sessionId) return [];
      if (tab.browserViewScopeId !== browserViewScopeId) return [];
      if (tab.released) return [];
      if (tab.browserTabId === activeBrowserUseTabId) return [];
      if (isBlankBrowserUrl(tab.url)) return [];
      return [{
        browserConversationId: tab.browserConversationId,
        browserViewScopeId: tab.browserViewScopeId,
        browserTabId: tab.browserTabId,
        projectId: tab.projectId,
        hostKind: "retained",
        initialUrl: tab.url,
        title: tab.title,
      }];
    });

    return [...browserDescriptors, ...browserUseDescriptors];
  }, [browserUseState, browserViewScopeId, sessionId, snapshots, tabs, visibleTabIds]);

  return (
    <>
      {descriptors.map((descriptor) => (
        <HiddenBrowserWebviewHost
          key={`${descriptor.hostKind}:${descriptor.browserConversationId}:${descriptor.browserViewScopeId}:${descriptor.browserTabId}`}
          descriptor={descriptor}
        />
      ))}
    </>
  );
}

function HiddenBrowserWebviewHost({ descriptor }: { descriptor: HiddenHostDescriptor }) {
  const initialUrl = normalizeBrowserNavigationUrl(descriptor.initialUrl);

  useEffect(() => {
    if (!window.api) return;
    void invoke("browser-sidebar-command", {
      type: "register-tab",
      browserConversationId: descriptor.browserConversationId,
      browserViewScopeId: descriptor.browserViewScopeId,
      browserTabId: descriptor.browserTabId,
      projectId: descriptor.projectId,
      initialUrl,
      title: descriptor.title,
      faviconUrl: descriptor.faviconUrl,
      deviceToolbarVisible: descriptor.deviceToolbarVisible,
    });
  }, [descriptor.browserConversationId, descriptor.browserTabId, descriptor.browserViewScopeId, descriptor.deviceToolbarVisible, descriptor.faviconUrl, descriptor.projectId, descriptor.title, initialUrl]);

  useLayoutEffect(() => {
    if (!window.api) return undefined;
    if (isBlankBrowserUrl(initialUrl)) return undefined;
    const mountGeneration = browserSidebarRendererWebviewManager.claimMountGeneration({
      browserConversationId: descriptor.browserConversationId,
      browserViewScopeId: descriptor.browserViewScopeId,
      browserTabId: descriptor.browserTabId,
    });
    browserSidebarRendererWebviewManager.syncWebview({
      browserConversationId: descriptor.browserConversationId,
      browserViewScopeId: descriptor.browserViewScopeId,
      browserTabId: descriptor.browserTabId,
      projectId: descriptor.projectId,
      hostKind: descriptor.hostKind,
      initialUrl,
      bounds: null,
      mountGeneration,
      isVisible: false,
      shouldPaint: false,
      onHostCreated: (event: BrowserSidebarWebviewHostCreated) => {
        void invoke("browser-sidebar-webview-host-created", event);
      },
    });

    return () => {
      browserSidebarRendererWebviewManager.detachWebview({
        browserConversationId: descriptor.browserConversationId,
        browserViewScopeId: descriptor.browserViewScopeId,
        browserTabId: descriptor.browserTabId,
      }, mountGeneration);
    };
  }, [descriptor.browserConversationId, descriptor.browserTabId, descriptor.browserViewScopeId, descriptor.hostKind, descriptor.projectId, initialUrl]);

  return null;
}
