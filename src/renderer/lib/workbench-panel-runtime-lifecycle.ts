import type { WorkbenchTabProjection } from "../../shared/types";
import { requireWorkbenchBrowserTabProjectionId } from "../../shared/browser-sidebar";
import type { ProjectSessionPreviewTab } from "./workbench-panel-preview";

export type WorkbenchPanelCloseResult =
  | { readonly status: "closed" }
  | {
      readonly status: "vetoed";
      readonly reason: "file-conflict" | "canvas-durability";
    };

export interface DurablePanelTabCloseRuntime {
  readonly flushFile: (tabId: string) => Promise<boolean>;
  readonly releaseTerminal: (terminalSessionId: string) => void;
  readonly removeDescriptor: () => void;
  readonly closeBrowserRuntime: (browserTabId: string) => Promise<void>;
  readonly disposePageEditor: () => Promise<void>;
  readonly disposeCanvas: (tab: WorkbenchTabProjection) => Promise<boolean>;
}

export async function closeDurablePanelTabWithRuntime(
  tab: WorkbenchTabProjection | null,
  runtime: DurablePanelTabCloseRuntime,
): Promise<WorkbenchPanelCloseResult> {
  if (tab?.kind === "files" && !await runtime.flushFile(tab.id)) {
    return {
      status: "vetoed",
      reason: "file-conflict",
    };
  }

  if (tab?.kind === "db_view" && !await runtime.disposeCanvas(tab)) {
    return {
      status: "vetoed",
      reason: "canvas-durability",
    };
  }

  if (
    tab?.kind === "terminal"
    && "terminalSessionId" in tab.config
  ) {
    runtime.releaseTerminal(tab.config.terminalSessionId);
  }

  runtime.removeDescriptor();
  if (tab?.kind === "browser") {
    await runtime.closeBrowserRuntime(
      requireWorkbenchBrowserTabProjectionId(tab),
    );
  }
  if (tab?.kind === "page_stage") {
    await runtime.disposePageEditor();
  }
  return { status: "closed" };
}

export interface PreviewPanelTabCloseRuntime {
  readonly flushFile: (tabId: string) => Promise<boolean>;
  readonly isBrowserRuntimeRetained: (browserTabId: string) => boolean;
  readonly closeBrowserRuntime: (browserTabId: string) => Promise<void>;
  readonly removeDescriptor: () => void;
}

export async function closePreviewPanelTabWithRuntime(
  tab: ProjectSessionPreviewTab | null,
  runtime: PreviewPanelTabCloseRuntime,
): Promise<WorkbenchPanelCloseResult> {
  if (tab?.kind === "files" && !await runtime.flushFile(tab.id)) {
    return {
      status: "vetoed",
      reason: "file-conflict",
    };
  }

  if (tab?.kind === "browser") {
    const browserTabId = tab.browserTabId;
    if (!runtime.isBrowserRuntimeRetained(browserTabId)) {
      await runtime.closeBrowserRuntime(browserTabId);
    }
  }

  runtime.removeDescriptor();
  return { status: "closed" };
}
