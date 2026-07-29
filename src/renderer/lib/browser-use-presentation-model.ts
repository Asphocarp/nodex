import type {
  BrowserSidebarTabSnapshot,
  BrowserUsePresentationRequest,
} from "../../shared/browser-sidebar";
import type {
  WorkbenchTabCreateInput,
  WorkbenchTabProjection,
} from "./types";

export function findWorkbenchBrowserTabByRuntimeId(
  tabs: readonly WorkbenchTabProjection[],
  browserTabId: string,
): WorkbenchTabProjection | null {
  return tabs.find((tab) =>
    tab.kind === "browser" && tab.browserTabId === browserTabId
  ) ?? null;
}

export function buildBrowserUseWorkbenchTabCreateInput({
  request,
  sessionId,
  snapshot,
  targetLeafId,
}: {
  request: BrowserUsePresentationRequest;
  sessionId: string;
  snapshot: BrowserSidebarTabSnapshot | null;
  targetLeafId?: string;
}): WorkbenchTabCreateInput {
  const title = snapshot?.title.trim()
    || request.browserTabId.replace(/^browser-use:/u, "")
    || "Browser";
  return {
    sessionId,
    panelId: "right",
    ...(targetLeafId ? { targetLeafId } : {}),
    clientTabId: `tab:browser-use:${encodeURIComponent(request.browserTabId)}`,
    kind: "browser",
    browserTabId: request.browserTabId,
    title,
    config: {
      projectId: request.projectId,
      browserStorageId:
        snapshot?.browserStorageId ?? `browser:use:${request.browserTabId}`,
      ...(snapshot?.url ? { url: snapshot.url } : {}),
      ...(snapshot?.title ? { title: snapshot.title } : {}),
      ...(snapshot?.faviconUrl
        ? { faviconUrl: snapshot.faviconUrl }
        : {}),
      ...(snapshot
        ? {
            deviceToolbarVisible: snapshot.deviceToolbarVisible,
            deviceToolbarState: snapshot.deviceToolbarState,
          }
        : {}),
    },
  };
}
