import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, fireEvent } from "@testing-library/react";
import type { Project } from "../../lib/types";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { render, textContent } from "../../test/dom";

let SidebarProjectsSection: typeof import("./left-sidebar-projects-section")["SidebarProjectsSection"];
let CodexProjectRow: typeof import("./codex-sidebar")["CodexProjectRow"];
let CodexProjectSessionList: typeof import("./codex-sidebar")["CodexProjectSessionList"];
let invokeCalls: unknown[][] = [];
let mockInvokeImpl: ((channel: string, ...args: unknown[]) => Promise<unknown>) | null = null;

mock.module("@/lib/api", () => ({
  invoke: async (channel: string, ...args: unknown[]) => {
    invokeCalls.push([channel, ...args]);
    return mockInvokeImpl?.(channel, ...args) ?? null;
  },
}));

const PROJECTS: Project[] = [
  {
    id: "alpha",
    name: "Alpha",
    description: "",
    icon: "A",
    workspacePath: "",
    created: new Date("2026-03-15T00:00:00.000Z"),
  },
  {
    id: "beta",
    name: "Beta",
    description: "",
    icon: "B",
    workspacePath: "/repo/beta",
    created: new Date("2026-03-15T00:00:00.000Z"),
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
      onRenameProject={async () => null}
      onManageProject={() => undefined}
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
        onRenameProject={async () => null}
        projectPickerOpenTick={0}
      />,
    );

    expect(getByText("Projects").textContent).toBe("Projects");
    expect(getByLabelText("Manage projects").getAttribute("aria-label")).toBe("Manage projects");
    expect(textContent(container).indexOf("Beta") < textContent(container).indexOf("Alpha")).toBeTrue();
    expect(textContent(container).includes("/repo/beta")).toBeFalse();
    expect(textContent(container).includes("/alpha")).toBeFalse();

    const section = container.querySelector('[data-app-action-sidebar-section-heading="Projects"]');
    expect(section?.getAttribute("data-app-action-sidebar-section-collapsed")).toBe("false");

    const rows = Array.from(container.querySelectorAll("[data-app-action-sidebar-project-row]"));
    expect(rows.length).toBe(2);
    expect(rows[0]?.getAttribute("data-app-action-sidebar-project-id")).toBe("beta");
    expect(rows[0]?.getAttribute("data-app-action-sidebar-project-label")).toBe("Beta");
    expect(rows[0]?.className.includes("group/folder-row")).toBeTrue();
    expect(rows[0]?.className.includes("h-token-nav-row")).toBeTrue();
  });

  test("keeps only the active project row visible when collapsed", () => {
    const { getByText, queryByText } = renderProjectsSection(
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
        onRenameProject={async () => null}
        projectPickerOpenTick={0}
      />,
    );

    expect(getByText("Beta").textContent).toBe("Beta");
    expect(queryByText("Alpha")).toBe(null);
  });

  test("moves project folder selection into the project actions menu", async () => {
    const renameCalls: unknown[][] = [];
    mockInvokeImpl = async (channel) => {
      if (channel === "pty:pick-cwd") return "/repo/selected";
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
        onRenameProject={async (...args) => {
          renameCalls.push(args);
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
    expect(getByText("Choose project folder...").textContent).toBe("Choose project folder...");

    await act(async () => {
      fireEvent.click(getByText("Choose project folder..."));
      await Promise.resolve();
    });

    expect(invokeCalls.some((call) => call[0] === "pty:pick-cwd")).toBeTrue();
    expect(JSON.stringify(renameCalls[0])).toBe(JSON.stringify(["beta", "beta", "Beta", undefined, "/repo/selected"]));
  });

  test("wraps expanded project sessions in the Codex height and opacity motion disclosure", () => {
    const { container, getByText } = renderProjectRowWithSessions();

    const motionDisclosure = container.querySelector("[data-app-action-sidebar-project-list-motion]");
    expect(Boolean(motionDisclosure)).toBeTrue();
    expect((motionDisclosure as HTMLElement).className.includes("overflow-hidden")).toBeTrue();
    expect(Boolean(motionDisclosure?.querySelector(".pt-0\\.5"))).toBeTrue();

    const sessionList = container.querySelector("[data-app-action-sidebar-project-list-id='alpha']");
    expect(Boolean(sessionList)).toBeTrue();
    expect(sessionList?.getAttribute("data-app-action-sidebar-project-show-all")).toBe("false");
    expect(getByText("Alpha session").textContent).toBe("Alpha session");
  });

  test("unmounts project session children when collapsed", () => {
    const { container, queryByText } = renderProjectRowWithSessions({ expanded: false });

    expect(container.querySelector("[data-app-action-sidebar-project-list-motion]")).toBe(null);
    expect(queryByText("Alpha session")).toBe(null);
  });

  test("keeps the Codex non-animated project children fallback available", () => {
    const { container, getByText } = renderProjectRowWithSessions({ animateChildren: false });

    const staticDisclosure = container.querySelector("[data-app-action-sidebar-project-list-static]");
    expect(Boolean(staticDisclosure)).toBeTrue();
    expect((staticDisclosure as HTMLElement).className.includes("mt-0.5")).toBeTrue();
    expect(container.querySelector("[data-app-action-sidebar-project-list-motion]")).toBe(null);
    expect(getByText("Alpha session").textContent).toBe("Alpha session");
  });
});
