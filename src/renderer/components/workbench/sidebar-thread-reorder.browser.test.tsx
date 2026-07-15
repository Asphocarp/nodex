import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import type { CodexSidebarThreadItem, Project } from "@/lib/types";
import {
  CodexProjectRow,
  CodexSidebarThreadRow,
} from "./codex-sidebar";
import {
  SidebarThreadReorderRows,
  SidebarThreadSortableContext,
  SidebarThreadSortableItem,
  type SidebarThreadReorderController,
} from "./sidebar-thread-reorder";
import { SidebarReorderDndProvider } from "./sidebar-reorder-dnd";

const PROJECT: Project = {
  id: "project-beta",
  name: "Project beta",
  description: "",
  sources: [],
  primaryWorkspaceRoot: null,
  pinned: false,
  pinnedOrder: null,
  created: new Date("2026-07-15T00:00:00.000Z"),
  updated: new Date("2026-07-15T00:00:00.000Z"),
};

const THREAD: CodexSidebarThreadItem = {
  key: "local:thread-alpha",
  kind: "local",
  hostId: "local",
  threadId: "thread-alpha",
  sessionId: "session-alpha",
  projectId: "project-alpha",
  title: "Drag an open rich tooltip",
  preview: "",
  cwd: null,
  updatedAt: Date.now(),
  createdAt: Date.now(),
  pinned: false,
  pinnedOrder: null,
  unread: false,
  archived: false,
  statusType: "notLoaded",
  statusActiveFlags: [],
  projectless: false,
  disabled: false,
};

function ThreadReorderHarness({
  onCommit,
}: {
  onCommit: (nextThreadKeys: string[]) => void;
}) {
  const [threadKeys, setThreadKeys] = useState(["alpha", "beta"]);
  return (
    <SidebarReorderDndProvider>
      <div
        aria-label="Project chats"
        role="list"
        style={{ display: "flex", flexDirection: "column", width: 240 }}
      >
        <SidebarThreadReorderRows
          containerId="project:alpha"
          visibleThreadKeys={threadKeys}
          sortableThreadKeys={threadKeys}
          onVisibleThreadOrderChange={async ({ nextVisibleThreadKeys }) => {
            onCommit(nextVisibleThreadKeys);
            setThreadKeys(nextVisibleThreadKeys);
          }}
          renderThread={(threadKey) => (
            <div
              data-thread-key={threadKey}
              data-testid={`thread-${threadKey}`}
              style={{ alignItems: "center", display: "flex", height: 40 }}
            >
              {threadKey}
            </div>
          )}
        />
      </div>
    </SidebarReorderDndProvider>
  );
}

function readRenderedThreadKeys(list: HTMLElement): string[] {
  return Array.from(list.querySelectorAll<HTMLElement>("[data-thread-key]"))
    .filter((row) => row.closest("[role='list']") === list)
    .map((row) => row.dataset.threadKey ?? "");
}

describe("sidebar thread reorder in Chromium", () => {
  test("keeps the visible insertion intent current while moving across one row midpoint", async () => {
    const committedOrders: string[][] = [];
    const view = render(
      <ThreadReorderHarness onCommit={(nextThreadKeys) => committedOrders.push(nextThreadKeys)} />,
    );
    const list = view.getByRole("list", { name: "Project chats" });
    const beta = view.getByTestId("thread-beta");
    const alpha = view.getByTestId("thread-alpha");
    const betaRect = beta.getBoundingClientRect();
    const alphaRect = alpha.getBoundingClientRect();
    const pointerId = 7;
    const pointerX = alphaRect.left + alphaRect.width / 2;

    try {
      await act(async () => {
        fireEvent.pointerDown(beta, {
          button: 0,
          clientX: betaRect.left + betaRect.width / 2,
          clientY: betaRect.top + betaRect.height / 2,
          isPrimary: true,
          pointerId,
          pointerType: "mouse",
        });
        fireEvent.pointerMove(document, {
          buttons: 1,
          clientX: pointerX,
          clientY: betaRect.top + betaRect.height / 2 - 8,
          isPrimary: true,
          pointerId,
          pointerType: "mouse",
        });
        fireEvent.pointerMove(document, {
          buttons: 1,
          clientX: pointerX,
          clientY: alphaRect.top + 4,
          isPrimary: true,
          pointerId,
          pointerType: "mouse",
        });
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(list.children).toHaveLength(3);
      });

      await act(async () => {
        fireEvent.pointerMove(document, {
          buttons: 1,
          clientX: pointerX,
          clientY: alphaRect.bottom - 4,
          isPrimary: true,
          pointerId,
          pointerType: "mouse",
        });
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(list.children).toHaveLength(2);
      });
      expect(committedOrders).toHaveLength(0);
    } finally {
      await act(async () => {
        fireEvent.pointerUp(document, {
          button: 0,
          clientX: pointerX,
          clientY: alphaRect.bottom - 4,
          isPrimary: true,
          pointerId,
          pointerType: "mouse",
        });
        await Promise.resolve();
      });
      view.unmount();
    }
  });

  test("commits and renders a changed order after pointer release", async () => {
    const committedOrders: string[][] = [];
    const errors: ErrorEvent[] = [];
    const consoleErrors: unknown[][] = [];
    const handleError = (event: ErrorEvent) => errors.push(event);
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args);
    });
    window.addEventListener("error", handleError);

    const view = render(
      <ThreadReorderHarness onCommit={(nextThreadKeys) => committedOrders.push(nextThreadKeys)} />,
    );
    const list = view.getByRole("list", { name: "Project chats" });
    const beta = view.getByTestId("thread-beta");
    const alpha = view.getByTestId("thread-alpha");
    const betaRect = beta.getBoundingClientRect();
    const alphaRect = alpha.getBoundingClientRect();
    const pointerId = 8;
    const pointerX = alphaRect.left + alphaRect.width / 2;
    const dropY = alphaRect.top + 4;

    try {
      await act(async () => {
        fireEvent.pointerDown(beta, {
          button: 0,
          clientX: betaRect.left + betaRect.width / 2,
          clientY: betaRect.top + betaRect.height / 2,
          isPrimary: true,
          pointerId,
          pointerType: "mouse",
        });
        fireEvent.pointerMove(document, {
          buttons: 1,
          clientX: pointerX,
          clientY: betaRect.top + betaRect.height / 2 - 8,
          isPrimary: true,
          pointerId,
          pointerType: "mouse",
        });
        fireEvent.pointerMove(document, {
          buttons: 1,
          clientX: pointerX,
          clientY: dropY,
          isPrimary: true,
          pointerId,
          pointerType: "mouse",
        });
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(list.children).toHaveLength(3);
      });

      await act(async () => {
        fireEvent.pointerUp(document, {
          button: 0,
          clientX: pointerX,
          clientY: dropY,
          isPrimary: true,
          pointerId,
          pointerType: "mouse",
        });
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(committedOrders).toEqual([["beta", "alpha"]]);
        expect(readRenderedThreadKeys(list)).toEqual(["beta", "alpha"]);
      });
      expect(errors).toHaveLength(0);
      expect(consoleErrors).toHaveLength(0);
    } finally {
      window.removeEventListener("error", handleError);
      consoleError.mockRestore();
      view.unmount();
    }
  });

  test("starts a drag from an open rich tooltip without replacing the sortable host", async () => {
    const errors: ErrorEvent[] = [];
    const controller: SidebarThreadReorderController = {
      handleDragEnd() {},
    };
    const handleError = (event: ErrorEvent) => {
      errors.push(event);
    };
    window.addEventListener("error", handleError);

    const view = render(
      <NodexTooltipProvider>
        <SidebarReorderDndProvider>
          <SidebarThreadSortableContext threadKeys={[THREAD.key]}>
            <div role="list" aria-label="Source project chats">
              <SidebarThreadSortableItem
                containerId="project:project-alpha"
                controller={controller}
                threadId={THREAD.threadId}
                threadKey={THREAD.key}
              >
                <CodexSidebarThreadRow
                  item={THREAD}
                  active={false}
                  hoverCardBranchName="codex/stable-ref"
                  hoverCardProjectLabel="Project alpha"
                  onSelect={() => {}}
                />
              </SidebarThreadSortableItem>
            </div>
          </SidebarThreadSortableContext>
          <div role="list" aria-label="Destination projects">
            <CodexProjectRow
              project={PROJECT}
              active={false}
              expanded={false}
              onActivate={() => {}}
              onUpdateProject={async () => PROJECT}
              onDeleteProject={async () => false}
            />
          </div>
        </SidebarReorderDndProvider>
      </NodexTooltipProvider>,
    );

    try {
      const row = view.container.querySelector<HTMLElement>(
        "[data-app-action-sidebar-thread-row]",
      );
      const sortableHost = row
        ?.closest<HTMLElement>("[aria-roledescription='sortable']")
        ?.parentElement;
      if (!row || !sortableHost) {
        throw new TypeError("Expected a mounted sortable thread row");
      }

      await act(async () => {
        fireEvent.pointerMove(row, { pointerType: "mouse" });
      });
      await waitFor(() => {
        expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();
      });

      await act(async () => {
        fireEvent.pointerDown(row, {
          button: 0,
          clientX: 20,
          clientY: 20,
          isPrimary: true,
          pointerId: 1,
          pointerType: "mouse",
        });
        fireEvent.pointerMove(document, {
          buttons: 1,
          clientX: 20,
          clientY: 40,
          isPrimary: true,
          pointerId: 1,
          pointerType: "mouse",
        });
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(sortableHost.hasAttribute("inert")).toBe(true);
      });
      expect(sortableHost.isConnected).toBe(true);
      expect(errors).toHaveLength(0);
    } finally {
      await act(async () => {
        fireEvent.pointerUp(document, {
          button: 0,
          clientX: 20,
          clientY: 40,
          isPrimary: true,
          pointerId: 1,
          pointerType: "mouse",
        });
        await Promise.resolve();
      });
      window.removeEventListener("error", handleError);
      view.unmount();
    }
  });
});
