import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { NodexTooltipProvider } from "@/components/ui/tooltip";

import type { LibraryProjectAccessRow } from "../../../shared/library-module";
import {
  buildProjectAccessChanges,
  effectiveProjectAccess,
  inheritedProjectAccess,
  LibraryResourceAccessDialog,
} from "./library-resource-access-dialog";

const project = (overrides: Partial<LibraryProjectAccessRow> = {}): LibraryProjectAccessRow => ({
  projectId: "project-1",
  projectName: "Product",
  appearance: {
    color: "blue",
    marker: { kind: "icon", icon: "folder" },
  },
  lifecycle: "active",
  directGrant: null,
  inheritedSources: [],
  effectiveAccess: null,
  ...overrides,
});

describe("Library Project access drafts", () => {
  test("keeps the strongest inherited access as the effective floor", () => {
    const inherited = project({
      inheritedSources: [
        {
          kind: "ancestor_page",
          pageId: "page-parent",
          pageTitle: "Strategy",
          access: "read_write",
        },
      ],
      effectiveAccess: "read_write",
    });

    expect(inheritedProjectAccess(inherited)).toBe("read_write");
    expect(effectiveProjectAccess(inherited, null)).toBe("read_write");
    expect(effectiveProjectAccess(inherited, "read")).toBe("read_write");
  });

  test("caps effective access for inactive Projects without discarding the grant", () => {
    const inactive = project({
      lifecycle: "inactive",
      directGrant: { access: "read_write", revision: 2 },
      effectiveAccess: "read",
    });

    expect(effectiveProjectAccess(inactive, "read_write")).toBe("read");
  });

  test("emits only changed direct grants with their revision fences", () => {
    const projects = [
      project({
        directGrant: { access: "read", revision: 4 },
        effectiveAccess: "read",
      }),
      project({ projectId: "project-2", projectName: "Research" }),
    ];

    expect(
      buildProjectAccessChanges(projects, {
        "project-1": null,
        "project-2": "read_write",
      }),
    ).toEqual([
      { projectId: "project-1", access: null, expectedRevision: 4 },
      { projectId: "project-2", access: "read_write", expectedRevision: null },
    ]);
  });

  test("preserves an edit when fresh Project data arrives", async () => {
    const onSave = vi.fn();
    const props = {
      open: true,
      title: "Research",
      projects: [project()],
      isLoading: false,
      error: null,
      isSaving: false,
      onOpenChange: vi.fn(),
      onRetry: vi.fn(),
      onSave,
    } as const;
    const { rerender } = render(
      <NodexTooltipProvider>
        <LibraryResourceAccessDialog {...props} />
      </NodexTooltipProvider>,
    );

    await act(async () => {
      fireEvent.pointerDown(screen.getByRole("button", { name: "Access for Product" }), {
        button: 0,
        ctrlKey: false,
      });
      await Promise.resolve();
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Read & write" }));

    rerender(
      <NodexTooltipProvider>
        <LibraryResourceAccessDialog
          {...props}
          projects={[project({ projectName: "Product workspace" })]}
        />
      </NodexTooltipProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith([
      {
        projectId: "project-1",
        access: "read_write",
        expectedRevision: null,
      },
    ]);
  });
});
