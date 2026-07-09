import { beforeAll, beforeEach, describe, expect, vi, test } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import type { Project } from "../../lib/types";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { render, textContent } from "../../test/dom";

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
    name: "Alpha",
    description: "",
    icon: "A",
    sources: [],
    primaryWorkspaceRoot: null,
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-03-15T00:00:00.000Z"),
    updated: new Date("2026-03-15T00:00:00.000Z"),
  },
  {
    id: "beta",
    name: "Beta",
    description: "",
    icon: "B",
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

function renderProjectsSection(element: Parameters<typeof render>[0]) {
  return render(
    <NodexTooltipProvider>
      {element}
    </NodexTooltipProvider>,
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
      onDeleteProject={async () => false}
    >
      <CodexProjectSessionList project={project}>
        <div role="listitem">Alpha session</div>
      </CodexProjectSessionList>
    </CodexProjectRow>,
  );
}

describe("SidebarProjectsSection", () => {
  test("renders project rows in space order with the Codex sidebar contract", () => {
    const { container, getByText, getByLabelText } = renderProjectsSection(
      <SidebarProjectsSection
        projects={PROJECTS}
        spaces={[
          { projectId: "beta", colorToken: "var(--accent-blue)", initial: "B" },
          { projectId: "alpha", colorToken: "var(--accent-green)", initial: "A" },
        ]}
        activeProjectId="beta"
        expanded
        onToggleExpanded={() => undefined}
        onSelectSpace={() => undefined}
        onCreateProject={async () => null}
        onDeleteProject={async () => false}
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

  test("opens the add-project submenu from the section action button", async () => {
    const { getByLabelText, getByText } = renderProjectsSection(
      <SidebarProjectsSection
        projects={PROJECTS}
        spaces={[
          { projectId: "alpha", colorToken: "var(--accent-green)", initial: "A" },
          { projectId: "beta", colorToken: "var(--accent-blue)", initial: "B" },
        ]}
        activeProjectId="alpha"
        expanded
        onToggleExpanded={() => undefined}
        onSelectSpace={() => undefined}
        onCreateProject={async () => null}
        onDeleteProject={async () => false}
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
  });

  test("opens the project sidebar options menu and sort flyout", async () => {
    const { getByLabelText, getByText } = renderProjectsSection(
      <SidebarProjectsSection
        projects={PROJECTS}
        spaces={[
          { projectId: "alpha", colorToken: "var(--accent-green)", initial: "A" },
          { projectId: "beta", colorToken: "var(--accent-blue)", initial: "B" },
        ]}
        activeProjectId="alpha"
        expanded
        onToggleExpanded={() => undefined}
        onSelectSpace={() => undefined}
        onCreateProject={async () => null}
        onDeleteProject={async () => false}
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
        spaces={[
          { projectId: "beta", colorToken: "var(--accent-blue)", initial: "B" },
          { projectId: "alpha", colorToken: "var(--accent-green)", initial: "A" },
        ]}
        activeProjectId="beta"
        expanded={false}
        onToggleExpanded={() => undefined}
        onSelectSpace={() => undefined}
        onCreateProject={async () => null}
        onDeleteProject={async () => false}
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

  test("moves project folder selection into the project actions menu", async () => {
    const updateCalls: unknown[][] = [];
    mockInvokeImpl = async (channel) => {
      if (channel === "projects:pick-source-root") return "/repo/selected";
      return null;
    };

    const { getByLabelText, getByText } = renderProjectsSection(
      <SidebarProjectsSection
        projects={PROJECTS}
        spaces={[
          { projectId: "beta", colorToken: "var(--accent-blue)", initial: "B" },
          { projectId: "alpha", colorToken: "var(--accent-green)", initial: "A" },
        ]}
        activeProjectId="beta"
        expanded
        onToggleExpanded={() => undefined}
        onSelectSpace={() => undefined}
        onCreateProject={async () => null}
        onDeleteProject={async () => false}
        onUpdateProject={async (projectId, updates) => {
          updateCalls.push([projectId, updates]);
          return null;
        }}
        projectPickerOpenTick={0}
      />,
    );

    await act(async () => {
      fireEvent.pointerDown(getByLabelText("Project actions for Beta"), { button: 0, ctrlKey: false });
      await Promise.resolve();
    });

    expect(getByText("Open in Finder").textContent).toBe("Open in Finder");
    expect(getByText("Add source folder").textContent).toBe("Add source folder");

    await act(async () => {
      fireEvent.click(getByText("Add source folder"));
      await Promise.resolve();
    });

    expect(invokeCalls.some((call) => call[0] === "projects:pick-source-root")).toBe(true);
    expect(JSON.stringify(updateCalls[0])).toBe(JSON.stringify([
      "beta",
      { sources: ["/repo/beta", "/repo/selected"] },
    ]));
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
      <NodexTooltipProvider>
        <CodexProjectRow
          project={PROJECTS[0] as Project}
          active
          expanded={false}
          onActivate={() => undefined}
          onUpdateProject={async () => null}
          onDeleteProject={async () => false}
        >
          <CodexProjectSessionList project={PROJECTS[0] as Project}>
            <div role="listitem">Alpha session</div>
          </CodexProjectSessionList>
        </CodexProjectRow>
      </NodexTooltipProvider>,
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
