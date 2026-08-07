import {
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { WorkbenchTabProjection } from "../../shared/types";
import type { ProjectSessionPreviewTab } from "./workbench-panel-preview";
import {
  closeDurablePanelTabWithRuntime,
  closePreviewPanelTabWithRuntime,
} from "./workbench-panel-runtime-lifecycle";

function makeTab(
  kind: WorkbenchTabProjection["kind"],
  config: WorkbenchTabProjection["config"],
): WorkbenchTabProjection {
  return {
    id: `tab:${kind}`,
    sessionId: "session:one",
    projectId: "project:one",
    panelId: "right",
    title: kind,
    order: 0,
    stateKey: 0,
    state: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    browserTabId: kind === "browser" ? "browser:one" : null,
    kind,
    config,
  } as WorkbenchTabProjection;
}

describe("Workbench panel runtime lifecycle", () => {
  test("Files veto prevents descriptor removal", async () => {
    const removeDescriptor = vi.fn();
    const result = await closeDurablePanelTabWithRuntime(
      makeTab("files", {
        projectId: "project:one",
        workspaceRoot: "/work/one",
        path: "notes.md",
      }),
      {
        flushFile: async () => false,
        releaseTerminal: vi.fn(),
        removeDescriptor,
        closeBrowserRuntime: vi.fn(),
        disposePageEditor: vi.fn(),
        disposeCanvas: async () => true,
      },
    );

    expect(result).toEqual({
      status: "vetoed",
      reason: "file-conflict",
    });
    expect(removeDescriptor).not.toHaveBeenCalled();
  });

  test("Terminal release precedes descriptor removal", async () => {
    const calls: string[] = [];
    await closeDurablePanelTabWithRuntime(
      makeTab("terminal", {
        terminalSessionId: "terminal:one",
      }),
      {
        flushFile: async () => true,
        releaseTerminal: () => calls.push("release"),
        removeDescriptor: () => calls.push("remove"),
        closeBrowserRuntime: vi.fn(),
        disposePageEditor: vi.fn(),
        disposeCanvas: async () => true,
      },
    );

    expect(calls).toEqual(["release", "remove"]);
  });

  test("Page editor is disposed exactly once after descriptor removal", async () => {
    const calls: string[] = [];
    await closeDurablePanelTabWithRuntime(
      makeTab("page_stage", {
        projectId: "project:one",
        pageId: "page:one",
      }),
      {
        flushFile: async () => true,
        releaseTerminal: vi.fn(),
        removeDescriptor: () => calls.push("remove"),
        closeBrowserRuntime: vi.fn(),
        disposePageEditor: async () => {
          calls.push("dispose");
        },
        disposeCanvas: async () => true,
      },
    );

    expect(calls).toEqual(["remove", "dispose"]);
  });

  test("Canvas durability veto prevents descriptor removal", async () => {
    const removeDescriptor = vi.fn();
    const result = await closeDurablePanelTabWithRuntime(
      makeTab("canvas_stage", {
        projectId: "project:one",
        canvasBlockId: "canvas:one",
      }),
      {
        flushFile: async () => true,
        releaseTerminal: vi.fn(),
        removeDescriptor,
        closeBrowserRuntime: vi.fn(),
        disposePageEditor: vi.fn(),
        disposeCanvas: async () => false,
      },
    );

    expect(result).toEqual({
      status: "vetoed",
      reason: "canvas-durability",
    });
    expect(removeDescriptor).not.toHaveBeenCalled();
  });

  test("Browser descriptor removal precedes the idempotent runtime close", async () => {
    const calls: string[] = [];
    const result = await closeDurablePanelTabWithRuntime(
      makeTab("browser", {
        projectId: "project:one",
        url: "https://example.com",
      }),
      {
        flushFile: async () => true,
        releaseTerminal: vi.fn(),
        removeDescriptor: () => calls.push("remove"),
        closeBrowserRuntime: async (browserTabId) => {
          calls.push(`close:${browserTabId}`);
        },
        disposePageEditor: vi.fn(),
        disposeCanvas: async () => true,
      },
    );

    expect(result).toEqual({ status: "closed" });
    expect(calls).toEqual(["remove", "close:browser:one"]);
  });

  test("retained Browser preview does not close the shared runtime", async () => {
    const closeBrowserRuntime = vi.fn();
    const removeDescriptor = vi.fn();
    await closePreviewPanelTabWithRuntime(
      ({
        ...makeTab("browser", {
          projectId: null,
        }),
        kind: "browser",
        config: { projectId: null },
        browserTabId: "browser:one",
        preview: true,
      }) as ProjectSessionPreviewTab,
      {
        flushFile: async () => true,
        isBrowserRuntimeRetained: () => true,
        closeBrowserRuntime,
        removeDescriptor,
      },
    );

    expect(closeBrowserRuntime).not.toHaveBeenCalled();
    expect(removeDescriptor).toHaveBeenCalledOnce();
  });
});
