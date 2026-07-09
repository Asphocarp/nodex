import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type {
  BrowserSidebarBrowserUseStateSnapshot,
  BrowserSidebarDestroyWebviewRequest,
  BrowserSidebarStateSnapshot,
  BrowserSidebarTabSnapshot,
  BrowserSidebarWebviewHostCreated,
  BrowserSidebarWebviewHostKind,
} from "../../../shared/browser-sidebar";
import { requireProjectSessionBrowserTabId } from "../../../shared/browser-sidebar";
import { isBlankBrowserUrl, normalizeBrowserNavigationUrl } from "../../../shared/browser-url";
import type { ProjectSessionTab } from "@/lib/types";
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
  tabs: ProjectSessionTab[];
  visibleTabIds: ReadonlySet<string>;
}

interface HiddenHostDescriptor {
  browserConversationId: string;
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
        .filter((snapshot) => snapshot.browserConversationId === sessionId)
        .map((snapshot) => [snapshot.browserTabId, snapshot]),
    );
    const browserDescriptors = tabs.flatMap((tab): HiddenHostDescriptor[] => {
      if (tab.kind !== "browser") return [];
      if (visibleTabIds.has(tab.id)) return [];
      const browserTabId = requireProjectSessionBrowserTabId(tab);
      const snapshot = snapshotsByTabId.get(browserTabId);
      const snapshotUrl = snapshot?.url && !isBlankBrowserUrl(snapshot.url) ? snapshot.url : null;
      const configUrl = readBrowserConfigUrl(tab);
      const initialUrl = snapshotUrl ?? configUrl;
      if (isBlankBrowserUrl(initialUrl)) return [];
      if (snapshot && !snapshot.hasBrowserPage) return [];
      return [{
        browserConversationId: sessionId,
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
      browserUseState?.activeBrowserTabIdsByConversation[sessionId] ?? null;
    const browserUseDescriptors = (browserUseState?.tabs ?? []).flatMap((tab): HiddenHostDescriptor[] => {
      if (tab.browserConversationId !== sessionId) return [];
      if (tab.released) return [];
      if (tab.browserTabId === activeBrowserUseTabId) return [];
      if (isBlankBrowserUrl(tab.url)) return [];
      return [{
        browserConversationId: tab.browserConversationId,
        browserTabId: tab.browserTabId,
        projectId: tab.projectId,
        hostKind: "retained",
        initialUrl: tab.url,
        title: tab.title,
      }];
    });

    return [...browserDescriptors, ...browserUseDescriptors];
  }, [browserUseState, sessionId, snapshots, tabs, visibleTabIds]);

  return (
    <>
      {descriptors.map((descriptor) => (
        <HiddenBrowserWebviewHost
          key={`${descriptor.hostKind}:${descriptor.browserConversationId}:${descriptor.browserTabId}`}
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
      browserTabId: descriptor.browserTabId,
      projectId: descriptor.projectId,
      initialUrl,
      title: descriptor.title,
      faviconUrl: descriptor.faviconUrl,
      deviceToolbarVisible: descriptor.deviceToolbarVisible,
    });
  }, [descriptor.browserConversationId, descriptor.browserTabId, descriptor.deviceToolbarVisible, descriptor.faviconUrl, descriptor.projectId, descriptor.title, initialUrl]);

  useLayoutEffect(() => {
    if (!window.api) return undefined;
    if (isBlankBrowserUrl(initialUrl)) return undefined;
    const mountGeneration = browserSidebarRendererWebviewManager.claimMountGeneration({
      browserConversationId: descriptor.browserConversationId,
      browserTabId: descriptor.browserTabId,
    });
    browserSidebarRendererWebviewManager.syncWebview({
      browserConversationId: descriptor.browserConversationId,
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
        browserTabId: descriptor.browserTabId,
      }, mountGeneration);
    };
  }, [descriptor.browserConversationId, descriptor.browserTabId, descriptor.hostKind, descriptor.projectId, initialUrl]);

  return null;
}
