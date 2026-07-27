import { beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import type { Project } from "../../lib/types";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { render } from "../../test/dom";
import { ProjectEditDialog, type ProjectDialogSubmitInput } from "./project-edit-dialog";

vi.mock("@/lib/api", () => ({
  invoke: async () => [],
}));

const PROJECT: Project = {
  id: "beta",
  libraryId: "library:test",
  databaseId: "database:test:primary",
  defaultDatabaseViewId: "view:test:primary",
  lifecycle: "active",
  bindingRevision: 1,
  name: "Beta",
  description: "",
  appearance: { color: "blue", marker: { kind: "icon", icon: "terminal" } },
  sources: [
    { root: "/repo/beta", order: 0 },
    { root: "/repo/beta-docs", order: 1 },
  ],
  primaryWorkspaceRoot: "/repo/beta",
  pinned: false,
  pinnedOrder: null,
  created: new Date("2026-03-15T00:00:00.000Z"),
  updated: new Date("2026-03-15T00:00:00.000Z"),
};

function renderEditDialog(onSubmit: (input: ProjectDialogSubmitInput) => Promise<void>) {
  return render(
    <NodexTooltipProvider>
      <ProjectEditDialog
        project={PROJECT}
        onClose={() => undefined}
        onSubmit={onSubmit}
      />
    </NodexTooltipProvider>,
  );
}

describe("ProjectEditDialog", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("make primary moves the folder to the front of the saved sources", async () => {
    const submitted: ProjectDialogSubmitInput[] = [];
    const { getByLabelText, getByText } = renderEditDialog(async (input) => {
      submitted.push(input);
    });

    await act(async () => {
      fireEvent.click(getByLabelText("Make beta-docs primary"));
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(getByText("Save"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(submitted[0]?.sources).toEqual(["/repo/beta-docs", "/repo/beta"]);
      expect(submitted[0]?.name).toBe("Beta");
      expect(submitted[0]?.appearance).toEqual(PROJECT.appearance);
    });
  });

  test("stages marker changes and submits appearance atomically with the form", async () => {
    const submitted: ProjectDialogSubmitInput[] = [];
    const view = renderEditDialog(async (input) => {
      submitted.push(input);
    });

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Change marker for Beta" }));
      await Promise.resolve();
    });
    const editorDialog = view.getByRole("heading", {
      name: "Edit project",
    }).closest('[role="dialog"]');
    const pickerDialog = view.getByRole("dialog", {
      name: "Project marker for Beta",
    });
    expect(editorDialog?.contains(pickerDialog)).toBe(false);
    expect(document.body.contains(pickerDialog)).toBe(true);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Use Red" }));
      await Promise.resolve();
    });

    expect(submitted).toHaveLength(0);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Save" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(submitted).toEqual([{
        appearance: {
          color: "red",
          marker: { kind: "icon", icon: "terminal" },
        },
        name: "Beta",
        sources: ["/repo/beta", "/repo/beta-docs"],
      }]);
    });
  });

  test("Cancel discards a staged marker without submitting", async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn(async () => undefined);
    const view = render(
      <NodexTooltipProvider>
        <ProjectEditDialog
          project={PROJECT}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      </NodexTooltipProvider>,
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button", {
        name: "Change marker for Beta",
      }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Use Red" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Cancel" }));
      await Promise.resolve();
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  test("keeps the dialog and staged marker intact after a rejected Save", async () => {
    const view = renderEditDialog(async () => {
      throw new Error("revision changed");
    });

    await act(async () => {
      fireEvent.click(view.getByRole("button", {
        name: "Change marker for Beta",
      }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Use Red" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Done" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Save" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "Edit project" })).toBeTruthy();
      expect(view.getByRole("button", {
        name: "Change marker for Beta",
      })).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(view.getByRole("button", {
        name: "Change marker for Beta",
      }));
      await Promise.resolve();
    });
    expect(view.getByRole("button", {
      name: "Use Red",
    }).getAttribute("aria-pressed")).toBe("true");
  });

  test("removing a folder drops it from the saved sources", async () => {
    const submitted: ProjectDialogSubmitInput[] = [];
    const { getByLabelText, getByText, queryByText } = renderEditDialog(async (input) => {
      submitted.push(input);
    });

    await act(async () => {
      fireEvent.click(getByLabelText("Remove beta-docs"));
      await Promise.resolve();
    });

    expect(queryByText("beta-docs")).toBe(null);
    expect(queryByText("Primary")).toBe(null);

    await act(async () => {
      fireEvent.click(getByText("Save"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(submitted[0]?.sources).toEqual(["/repo/beta"]);
    });
  });

  test("resets project-scoped confirmation state when retargeted", async () => {
    const renderDialog = (project: Project) => (
      <NodexTooltipProvider>
        <ProjectEditDialog
          project={project}
          onClose={() => undefined}
          onSubmit={async () => undefined}
          onArchiveProject={async () => ({ kind: "not-found" })}
        />
      </NodexTooltipProvider>
    );
    const view = render(renderDialog(PROJECT));

    fireEvent.click(view.getByRole("button", { name: "Remove project" }));
    expect(await view.findByRole("heading", { name: "Remove Beta?" })).toBeTruthy();

    const nextProject: Project = {
      ...PROJECT,
      id: "gamma",
      name: "Gamma",
    };
    view.rerender(renderDialog(nextProject));

    await waitFor(() => {
      expect(view.queryByRole("heading", { name: "Remove Beta?" })).toBe(null);
      expect(
        (view.getByRole("textbox", { name: "Project name" }) as HTMLInputElement).value,
      ).toBe("Gamma");
    });
  });
});
