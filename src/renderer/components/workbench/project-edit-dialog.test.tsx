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
  icon: "",
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
        open
        project={PROJECT}
        onOpenChange={() => undefined}
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
    });
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
});
