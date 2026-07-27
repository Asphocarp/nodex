import { beforeAll, beforeEach, describe, expect, vi, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import type { Project } from "../../lib/types";
import { NodexHoverCardProvider } from "@/components/ui/hover-card";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { NodexModalHost } from "@/lib/modal-registry";
import { renderWithMaitai, textContent } from "../../test/dom";
import { TestQueryProvider } from "../../test/query";

let SidebarProjectsSection: typeof import("./left-sidebar-projects-section")["SidebarProjectsSection"];
let CodexProjectRow: typeof import("./codex-sidebar")["CodexProjectRow"];
let CodexProjectSessionList: typeof import("./codex-sidebar")["CodexProjectSessionList"];
let getCodexSidebarSortableStyle: typeof import("./codex-sidebar")["getCodexSidebarSortableStyle"];
let invokeCalls: unknown[][] = [];
let mockInvokeImpl: ((channel: string, ...args: unknown[]) => Promise<unknown>) | null = null;

vi.mock("@/lib/api", () => ({
  invoke: async (channel: string, ...args: unknown[]) => {
    invokeCalls.push([channel, ...args]);
    return mockInvokeImpl?.(channel, ...args) ?? null;
  },
  subscribeBoardChanges: () => () => undefined,
  subscribeProjectSessionChanges: () => () => undefined,
  subscribeProjectChanges: () => () => undefined,
  subscribeCodexHostMessages: () => () => undefined,
  subscribeDesktopNotificationActions: () => () => undefined,
  subscribeGitBranchChanges: () => () => undefined,
  subscribeAppUpdateStatus: () => () => undefined,
  getWindowFocusState: async () => true,
  subscribeWindowFocusChanges: () => () => undefined,
}));

const PROJECTS: Project[] = [
  {
    id: "alpha",
    libraryId: "library:test",
    databaseId: "database:test:primary",
    defaultDatabaseViewId: "view:test:primary",
    lifecycle: "active",
    bindingRevision: 1,
    name: "Alpha",
    description: "",
    appearance: { color: "green", marker: { kind: "icon", icon: "plant" } },
    sources: [],
    primaryWorkspaceRoot: null,
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-03-15T00:00:00.000Z"),
    updated: new Date("2026-03-15T00:00:00.000Z"),
  },
  {
    id: "beta",
    libraryId: "library:test",
    databaseId: "database:test:primary",
    defaultDatabaseViewId: "view:test:primary",
    lifecycle: "active",
    bindingRevision: 1,
    name: "Beta",
    description: "",
    appearance: { color: "blue", marker: { kind: "icon", icon: "function" } },
    sources: [{ root: "/repo/beta", order: 0 }],
    primaryWorkspaceRoot: "/repo/beta",
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-03-15T00:00:00.000Z"),
    updated: new Date("2026-03-15T00:00:00.000Z"),
  },
];

beforeAll(async () => {
  const [sectionModule, sidebarModule] = await Promise.all([
    import("./left-sidebar-projects-section"),
    import("./codex-sidebar"),
  ]);
  SidebarProjectsSection = sectionModule.SidebarProjectsSection;
  CodexProjectRow = sidebarModule.CodexProjectRow;
  CodexProjectSessionList = sidebarModule.CodexProjectSessionList;
  getCodexSidebarSortableStyle = sidebarModule.getCodexSidebarSortableStyle;
});

beforeEach(() => {
  invokeCalls = [];
  mockInvokeImpl = null;
});

function renderProjectsSection(element: Parameters<typeof renderWithMaitai>[0]) {
  return renderWithMaitai(
    <TestQueryProvider>
      <NodexHoverCardProvider>
        <NodexTooltipProvider>
          {element}
          <NodexModalHost />
        </NodexTooltipProvider>
      </NodexHoverCardProvider>
    </TestQueryProvider>,
  );
}

function renderProjectRowWithSessions({
  expanded = true,
  animateChildren = true,
}: {
  expanded?: boolean;
  animateChildren?: boolean;
} = {}) {
  const project = PROJECTS[0] as Project;

  return renderProjectsSection(
    <CodexProjectRow
      project={project}
      active
      expanded={expanded}
      animateChildren={animateChildren}
      onActivate={() => undefined}
      onUpdateProject={async () => null}
      onArchiveProject={async () => ({ kind: "not-found" })}
    >
      <CodexProjectSessionList project={project}>
        <div role="listitem">Alpha session</div>
      </CodexProjectSessionList>
    </CodexProjectRow>,
  );
}

describe("SidebarProjectsSection", () => {
  test("renders project rows in project order with the Codex sidebar contract", () => {
    const { container, getByText, getByLabelText } = renderProjectsSection(
      <SidebarProjectsSection
        projects={PROJECTS}
        projectOrder={["beta", "alpha"]}
        activeProjectId="beta"
        expanded
        onToggleExpanded={() => undefined}
        onSelectProject={() => undefined}
        onCreateProject={async () => null}
        onArchiveProject={async () => ({ kind: "not-found" })}
        onUpdateProject={async () => null}
        projectPickerOpenTick={0}
      />,
    );

    expect(getByText("Projects").textContent).toBe("Projects");
    expect(container.querySelector('[data-app-action-sidebar-projects-collapse-action]') === null).toBe(true);
    expect(getByLabelText("Project sidebar options").getAttribute("aria-disabled")).toBe(null);
    expect(getByLabelText("Add new project").getAttribute("aria-label")).toBe("Add new project");
    expect(textContent(container).indexOf("Beta") < textContent(container).indexOf("Alpha")).toBe(true);
    expect(textContent(container).includes("/repo/beta")).toBe(false);
    expect(textContent(container).includes("/alpha")).toBe(false);

    const section = container.querySelector('[data-app-action-sidebar-section-heading="Projects"]');
    expect(section?.getAttribute("data-app-action-sidebar-section-collapsed")).toBe("false");
    const sectionBody = section?.querySelector("[data-app-action-sidebar-section-body-motion]");
    expect(Boolean(sectionBody)).toBe(true);

    const rows = Array.from(container.querySelectorAll("[data-app-action-sidebar-project-row]"));
    expect(rows.length).toBe(2);
    expect(rows[0]?.getAttribute("data-app-action-sidebar-project-id")).toBe("beta");
    expect(rows[0]?.getAttribute("data-app-action-sidebar-project-label")).toBe("Beta");
    expect(rows[0]?.getAttribute("role")).toBe("button");
    expect(rows[0]?.getAttribute("tabindex")).toBe("0");
  });

  test("opens project creation after the add-project submenu closes", async () => {
    const { getByLabelText, getByRole, getByText, queryByRole } = renderProjectsSection(
      <SidebarProjectsSection
        projects={PROJECTS}
        projectOrder={["alpha", "beta"]}
        activeProjectId="alpha"
        expanded
        onToggleExpanded={() => undefined}
        onSelectProject={() => undefined}
        onCreateProject={async () => null}
        onArchiveProject={async () => ({ kind: "not-found" })}
        onUpdateProject={async () => null}
        projectPickerOpenTick={0}
      />,
    );

    await act(async () => {
      fireEvent.pointerDown(getByLabelText("Add new project"), { button: 0, ctrlKey: false });
      await Promise.resolve();
    });

    expect(getByText("Start from scratch").textContent).toBe("Start from scratch");
    expect(getByText("Use an existing folder").textContent).toBe("Use an existing folder");

    await act(async () => {
      fireEvent.click(getByText("Start from scratch"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(queryByRole("menu")).toBe(null);
      expect(getByRole("heading", { name: "Create project" })).toBeTruthy();
    });
  });

  test("opens the project sidebar options menu and sort flyout", async () => {
    const { getByLabelText, getByText } = renderProjectsSection(
      <SidebarProjectsSection
        projects={PROJECTS}
        projectOrder={["alpha", "beta"]}
        activeProjectId="alpha"
        expanded
        onToggleExpanded={() => undefined}
        onSelectProject={() => undefined}
        onCreateProject={async () => null}
        onArchiveProject={async () => ({ kind: "not-found" })}
        onUpdateProject={async () => null}
        projectPickerOpenTick={0}
      />,
    );

    await act(async () => {
      fireEvent.pointerDown(getByLabelText("Project sidebar options"), { button: 0, ctrlKey: false });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(textContent(document.body).includes("Archive all chats")).toBe(true);
      expect(textContent(document.body).includes("Removed projects…")).toBe(true);
      expect(textContent(document.body).includes("Organize pins")).toBe(false);
      expect(textContent(document.body).includes("Organize sidebar")).toBe(true);
      expect(textContent(document.body).includes("Sort by")).toBe(true);
    });

    const sortByItem = getByText("Sort by").closest('[role="menuitem"]');
    if (!(sortByItem instanceof HTMLElement)) {
      throw new Error("Expected Sort by menu item");
    }

    await act(async () => {
      fireEvent.pointerMove(sortByItem, { pointerType: "mouse" });
      fireEvent.keyDown(sortByItem, { key: "ArrowRight" });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(textContent(document.body).includes("Manual order")).toBe(true);
      expect(textContent(document.body).includes("Created")).toBe(true);
      expect(textContent(document.body).includes("Updated")).toBe(true);
    });
  });

  test("hides project rows when the Projects section is initially collapsed", () => {
    const { container, queryByText } = renderProjectsSection(
      <SidebarProjectsSection
        projects={PROJECTS}
        projectOrder={["beta", "alpha"]}
        activeProjectId="beta"
        expanded={false}
        onToggleExpanded={() => undefined}
        onSelectProject={() => undefined}
        onCreateProject={async () => null}
        onArchiveProject={async () => ({ kind: "not-found" })}
        onUpdateProject={async () => null}
        projectPickerOpenTick={0}
      />,
    );

    const section = container.querySelector('[data-app-action-sidebar-section-heading="Projects"]');
    expect(section?.getAttribute("data-app-action-sidebar-section-collapsed")).toBe("true");
    expect(section?.querySelector("[data-app-action-sidebar-section-body-motion]")).toBe(null);
    expect(queryByText("Beta")).toBe(null);
    expect(queryByText("Alpha")).toBe(null);
  });

  test("edits name and source folders through the Edit project dialog", async () => {
    const updateCalls: unknown[][] = [];
    mockInvokeImpl = async (channel) => {
      if (channel === "projects:pick-source-roots") return ["/repo/selected"];
      return null;
    };

    const { getByLabelText, getByText, queryByRole, queryByText, findByText } = renderProjectsSection(
      <SidebarProjectsSection
        projects={PROJECTS}
        projectOrder={["beta", "alpha"]}
        activeProjectId="beta"
        expanded
        onToggleExpanded={() => undefined}
        onSelectProject={() => undefined}
        onCreateProject={async () => null}
        onArchiveProject={async () => ({ kind: "not-found" })}
        onUpdateProject={async (projectId, updates) => {
          updateCalls.push([projectId, updates]);
          return PROJECTS[1] ?? null;
        }}
        projectPickerOpenTick={0}
      />,
    );

    await act(async () => {
      fireEvent.pointerDown(getByLabelText("Project actions for Beta"), { button: 0, ctrlKey: false });
      await Promise.resolve();
    });

    expect(getByText("Edit project").textContent).toBe("Edit project");
    expect(getByText("Archive chats").textContent).toBe("Archive chats");
    expect(getByText("Remove").textContent).toBe("Remove");
    expect(queryByText("Add source folder")).toBe(null);
    expect(queryByText("Edit sources")).toBe(null);
    expect(queryByText("Rename")).toBe(null);
    expect(queryByText("Choose icon")).toBe(null);

    await act(async () => {
      fireEvent.click(getByText("Edit project"));
      await Promise.resolve();
    });

    await findByText("Source folders");
    expect(queryByRole("menu")).toBe(null);
    expect(getByText("beta").textContent).toBe("beta");
    expect(queryByText("Primary")).toBe(null);

    await act(async () => {
      fireEvent.click(getByText("Add folder"));
      await Promise.resolve();
    });

    expect(invokeCalls.some((call) => call[0] === "projects:pick-source-roots")).toBe(true);
    await findByText("selected");
    expect(getByText("Primary").textContent).toBe("Primary");

    await act(async () => {
      fireEvent.click(getByText("Save"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(JSON.stringify(updateCalls[0])).toBe(JSON.stringify([
        "beta",
        {
          expectedBindingRevision: 1,
          appearance: PROJECTS[1]?.appearance,
          name: "Beta",
          sources: ["/repo/beta", "/repo/selected"],
        },
      ]));
    });
  });

  test("keeps project disclosure stable when the portaled edit dialog is clicked", async () => {
    const onActivate = vi.fn();
    const { getByLabelText, getByRole, getByText, findByText } = renderProjectsSection(
      <CodexProjectRow
        project={PROJECTS[1] as Project}
        active
        expanded
        onActivate={onActivate}
        onUpdateProject={async () => PROJECTS[1] ?? null}
        onArchiveProject={async () => ({ kind: "not-found" })}
      />,
    );

    fireEvent.click(getByRole("button", { name: "Beta" }));
    expect(onActivate).toHaveBeenCalledTimes(1);
    onActivate.mockClear();

    await act(async () => {
      fireEvent.pointerDown(getByLabelText("Project actions for Beta"), {
        button: 0,
        ctrlKey: false,
      });
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(getByText("Edit project"));
      await Promise.resolve();
    });

    await findByText("Source folders");
    const dialogContent = document.body.querySelector(
      '[data-slot="codex-dialog-content"]',
    );
    if (!(dialogContent instanceof HTMLElement)) {
      throw new Error("Expected Edit project dialog content");
    }

    await act(async () => {
      fireEvent.click(dialogContent);
      await Promise.resolve();
    });

    expect(onActivate).not.toHaveBeenCalled();
  });

  test("keeps disclosure stable across the interactive Project card and its Edit action", async () => {
    const onActivate = vi.fn();
    const onHoverCardOpenChange = vi.fn();
    mockInvokeImpl = async (channel) => {
      if (channel === "shell:path-context:get") {
        return { homeDirectory: "/Users/asc", separator: "/" };
      }
      if (channel === "git:repository:identity") {
        return {
          repositoryRoot: "/repo/beta",
          ownerRepo: { owner: "acme", repo: "beta" },
        };
      }
      if (channel === "shell:open-file-link") return true;
      return null;
    };

    renderProjectsSection(
      <CodexProjectRow
        project={PROJECTS[1] as Project}
        activity={{
          projectId: "beta",
          taskCount: 66,
          waitingCount: 1,
          unreadCount: 2,
          activeCount: 3,
        }}
        active
        expanded
        hoverCardOpen
        onHoverCardOpenChange={onHoverCardOpenChange}
        onActivate={onActivate}
        onUpdateProject={async () => PROJECTS[1] ?? null}
        onArchiveProject={async () => ({ kind: "not-found" })}
      />,
    );

    const card = await waitFor(() => {
      const candidate = document.body.querySelector<HTMLElement>(
        "[data-app-action-sidebar-project-hover-card]",
      );
      if (!candidate) throw new Error("Expected Project hover card");
      return candidate;
    });
    expect(within(card).getByText("66 tasks · 1 waiting · 2 unread · 3 active"))
      .toBeTruthy();

    await act(async () => {
      fireEvent.click(card);
      await Promise.resolve();
    });
    expect(onActivate).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(card).getByText("/repo/beta"));
      await Promise.resolve();
    });
    expect(invokeCalls.some(([channel, target, opener]) => (
      channel === "shell:open-file-link"
      && JSON.stringify(target) === JSON.stringify({ path: "/repo/beta" })
      && opener === "fileManager"
    ))).toBe(true);

    await act(async () => {
      fireEvent.click(within(card).getByText("Edit project"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(onHoverCardOpenChange).toHaveBeenCalledWith(false);
      expect(document.body.textContent?.includes("Source folders")).toBe(true);
    });
    expect(onActivate).not.toHaveBeenCalled();
  });

  test("keeps project disclosure stable inside a row-owned confirmation dialog", async () => {
    const onActivate = vi.fn();
    const { container, getByLabelText, getByText, findByRole } = renderProjectsSection(
      <CodexProjectRow
        project={PROJECTS[1] as Project}
        active
        expanded
        onActivate={onActivate}
        onUpdateProject={async () => PROJECTS[1] ?? null}
        onArchiveProject={async () => ({ kind: "not-found" })}
      />,
    );

    await act(async () => {
      fireEvent.pointerDown(getByLabelText("Project actions for Beta"), {
        button: 0,
        ctrlKey: false,
      });
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(getByText("Remove"));
      await Promise.resolve();
    });

    const heading = await findByRole("heading", { name: "Remove Beta?" });
    fireEvent.click(heading);

    expect(
      container
        .querySelector('[data-app-action-sidebar-project-row]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(onActivate).not.toHaveBeenCalled();
  });

  test("hides the reveal action for projects with multiple source folders", async () => {
    const multiRootBeta: Project = {
      ...PROJECTS[1]!,
      sources: [
        { root: "/repo/beta", order: 0 },
        { root: "/repo/beta-docs", order: 1 },
      ],
    };

    const { getByLabelText, getByText, queryByText } = renderProjectsSection(
      <SidebarProjectsSection
        projects={[multiRootBeta]}
        projectOrder={["beta"]}
        activeProjectId="beta"
        expanded
        onToggleExpanded={() => undefined}
        onSelectProject={() => undefined}
        onCreateProject={async () => null}
        onArchiveProject={async () => ({ kind: "not-found" })}
        onUpdateProject={async () => null}
        projectPickerOpenTick={0}
      />,
    );

    await act(async () => {
      fireEvent.pointerDown(getByLabelText("Project actions for Beta"), { button: 0, ctrlKey: false });
      await Promise.resolve();
    });

    expect(getByText("Edit project").textContent).toBe("Edit project");
    expect(queryByText(/Reveal in Finder|Open in Explorer|Open in File Manager/)).toBe(null);
  });

  test("wraps expanded project sessions in the Codex height and opacity motion disclosure", () => {
    const { container, getByText } = renderProjectRowWithSessions();

    const motionDisclosure = container.querySelector("[data-app-action-sidebar-project-list-motion]");
    expect(Boolean(motionDisclosure)).toBe(true);

    const sessionList = container.querySelector("[data-app-action-sidebar-project-list-id='alpha']");
    expect(Boolean(sessionList)).toBe(true);
    expect(sessionList?.getAttribute("data-app-action-sidebar-project-show-all")).toBe("false");
    expect(getByText("Alpha session").textContent).toBe("Alpha session");
  });

  test("renders the project disclosure chevron after the project label", () => {
    const { container, rerender } = renderProjectRowWithSessions();

    const expandedRow = container.querySelector("[data-app-action-sidebar-project-row]");
    const expandedLabel = expandedRow?.querySelector("[data-app-action-sidebar-project-label-text]");
    const expandedChevron = expandedRow?.querySelector("[data-app-action-sidebar-project-toggle-chevron]");

    if (!expandedLabel || !expandedChevron) {
      throw new Error("Expected project label and disclosure chevron");
    }

    expect(Boolean(expandedLabel.compareDocumentPosition(expandedChevron) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    rerender(
      <TestQueryProvider>
        <NodexHoverCardProvider>
          <NodexTooltipProvider>
            <CodexProjectRow
              project={PROJECTS[0] as Project}
              active
              expanded={false}
              onActivate={() => undefined}
              onUpdateProject={async () => null}
              onArchiveProject={async () => ({ kind: "not-found" })}
            >
              <CodexProjectSessionList project={PROJECTS[0] as Project}>
                <div role="listitem">Alpha session</div>
              </CodexProjectSessionList>
            </CodexProjectRow>
          </NodexTooltipProvider>
        </NodexHoverCardProvider>
      </TestQueryProvider>,
    );

    const collapsedChevronIcon = container.querySelector("[data-app-action-sidebar-project-toggle-chevron] svg");
    expect(collapsedChevronIcon !== null).toBe(true);
  });

  test("unmounts project session children when collapsed", () => {
    const { container, queryByText } = renderProjectRowWithSessions({ expanded: false });

    expect(container.querySelector("[data-app-action-sidebar-project-list-motion]")).toBe(null);
    expect(queryByText("Alpha session")).toBe(null);
  });

  test("keeps the Codex non-animated project children fallback available", () => {
    const { container, getByText } = renderProjectRowWithSessions({ animateChildren: false });

    const staticDisclosure = container.querySelector("[data-app-action-sidebar-project-list-static]");
    expect(Boolean(staticDisclosure)).toBe(true);
    expect(container.querySelector("[data-app-action-sidebar-project-list-motion]")).toBe(null);
    expect(getByText("Alpha session").textContent).toBe("Alpha session");
  });

  test("project sortable style translates without scaling to target slot size", () => {
    const style = getCodexSidebarSortableStyle(
      { x: 12, y: 34, scaleX: 3, scaleY: 0.25 },
      "transform 200ms ease",
    );

    expect(style.transform).toBe("translate3d(12px, 34px, 0)");
    expect(String(style.transform).includes("scale")).toBe(false);
    expect(style.transition).toBe("transform 200ms ease");
  });
});
