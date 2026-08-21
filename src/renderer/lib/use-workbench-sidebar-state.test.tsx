import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Project } from "./types";
import { useWorkbenchSidebarState } from "./use-workbench-sidebar-state";

function makeProject(id: string): Project {
  return {
    id,
    name: id,
    path: `/work/${id}`,
  } as unknown as Project;
}

describe("useWorkbenchSidebarState", () => {
  test("initializes and toggles the expanded project lane", () => {
    const { result } = renderHook(() =>
      useWorkbenchSidebarState({
        projects: [makeProject("one"), makeProject("two")],
        activeProjectId: "two",
      }),
    );

    expect([...result.current.expandedProjectIds]).toEqual(["two"]);
    act(() => result.current.toggleProjectExpanded("one"));
    expect([...result.current.expandedProjectIds]).toEqual(["two", "one"]);
    act(() => result.current.toggleProjectExpanded("two"));
    expect([...result.current.expandedProjectIds]).toEqual(["one"]);
  });

  test("keeps local disclosure state across placement changes", () => {
    const { result, rerender } = renderHook(() =>
      useWorkbenchSidebarState({
        projects: [makeProject("one")],
        activeProjectId: "one",
      }),
    );

    act(() => result.current.toggleProjectsSection());
    expect(result.current.sections.projects).toBe(true);
    rerender();
    expect(result.current.sections.projects).toBe(true);
  });

  test("delegates persisted disclosure changes without a local second writer", () => {
    const setCollapsed = vi.fn();
    const { result } = renderHook(() =>
      useWorkbenchSidebarState({
        projects: [],
        activeProjectId: null,
        collapsibleSections: {
          pinned: false,
          pages: false,
          projects: true,
          chats: false,
        },
        setCollapsibleSectionCollapsed: setCollapsed,
      }),
    );

    act(() => result.current.toggleProjectsSection());
    expect(setCollapsed).toHaveBeenCalledWith("projects", false);
  });

  test("guards archive intents and owns context-menu selection", () => {
    const { result } = renderHook(() =>
      useWorkbenchSidebarState({
        projects: [],
        activeProjectId: null,
      }),
    );

    act(() => {
      expect(result.current.beginArchive("session:one")).toBe(true);
    });
    act(() => {
      expect(result.current.beginArchive("session:one")).toBe(false);
      result.current.beginContextMenu("session:one");
    });
    expect(result.current.archivePendingKeys.has("session:one")).toBe(true);
    expect(result.current.contextMenuSessionId).toBe("session:one");

    act(() => {
      result.current.finishArchive("session:one");
      result.current.finishContextMenu();
    });
    expect(result.current.archivePendingKeys.size).toBe(0);
    expect(result.current.contextMenuSessionId).toBeNull();
  });
});
