import { describe, expect, test } from "vite-plus/test";
import { resolveStageSidebarSectionRenderState } from "./left-sidebar-section-state";

function makeSection(itemStates: Array<{ id: string; active?: boolean }>) {
  return {
    id: "pages:status:6-in-progress",
    label: "In Progress",
    collapsible: true,
    items: itemStates.map((item) => ({
      id: item.id,
      label: item.id,
      active: item.active,
      onSelect: () => undefined,
    })),
  };
}

function makeStaticSection(itemStates: Array<{ id: string; active?: boolean }>) {
  return {
    id: "recents:list",
    items: itemStates.map((item) => ({
      id: item.id,
      label: item.id,
      active: item.active,
      onSelect: () => undefined,
    })),
  };
}

describe("resolveStageSidebarSectionRenderState", () => {
  test("keeps only active rows visible when a section is collapsed", () => {
    const state = resolveStageSidebarSectionRenderState(
      makeSection([{ id: "page-1" }, { id: "page-2", active: true }, { id: "page-3" }]),
      { "pages:status:6-in-progress": false },
      {},
    );

    expect(state.expanded).toBe(false);
    expect(state.hasOverflow).toBe(false);
    expect(state.visibleItems.length).toBe(0);
    expect(state.pinnedItems.map((item) => item.id).join(",")).toBe("page-2");
  });

  test("defaults sections to collapsed when no local section state exists", () => {
    const state = resolveStageSidebarSectionRenderState(
      makeSection([{ id: "page-1" }, { id: "page-2", active: true }]),
      {},
      {},
    );

    expect(state.expanded).toBe(false);
    expect(state.visibleItems.length).toBe(0);
    expect(state.pinnedItems.map((item) => item.id).join(",")).toBe("page-2");
  });

  test("preserves overflow slicing while a section stays expanded", () => {
    const state = resolveStageSidebarSectionRenderState(
      makeSection(Array.from({ length: 12 }, (_, index) => ({ id: `page-${index + 1}` }))),
      { "pages:status:6-in-progress": true },
      {},
    );

    expect(state.expanded).toBe(true);
    expect(state.hasOverflow).toBe(true);
    expect(state.visibleItems.length).toBe(10);
    expect(state.overflowItems.length).toBe(2);
    expect(state.pinnedItems.length).toBe(0);
  });

  test("keeps non-collapsible sections visible by default", () => {
    const state = resolveStageSidebarSectionRenderState(
      makeStaticSection([{ id: "session-1" }, { id: "session-2", active: true }]),
      {},
      {},
    );

    expect(state.expanded).toBe(true);
    expect(state.visibleItems.map((item) => item.id).join(",")).toBe("session-1,session-2");
    expect(state.pinnedItems.length).toBe(0);
  });
});
