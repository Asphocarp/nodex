import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import {
  projectSourceFolderName,
  SidebarThreadMoveConfirmationDialog,
} from "./sidebar-thread-move-confirmation-dialog";

const confirmation = {
  status: "confirmation-required" as const,
  reason: "target-project-needs-source-access" as const,
  threadId: "thread-1",
  targetProjectId: "project-2",
  targetBindingRevision: 3,
  missingProjectSources: [
    "/Users/example/alpha",
    "/Users/example/a-very-long-source-folder-name",
  ],
  targetProjectName: "Platform",
};

describe("SidebarThreadMoveConfirmationDialog", () => {
  test("projects Unix and Windows source paths to folder names", () => {
    expect(projectSourceFolderName("/repo/alpha/")).toBe("alpha");
    expect(projectSourceFolderName("C:\\repo\\beta\\")).toBe("beta");
  });

  test("explains Project-wide access and closes before continuing", () => {
    const calls: string[] = [];
    const view = render(
      <NodexTooltipProvider>
        <SidebarThreadMoveConfirmationDialog
          confirmation={confirmation}
          onClose={() => calls.push("close")}
          onContinue={() => calls.push("continue")}
        />
      </NodexTooltipProvider>,
    );

    expect(view.getByRole("heading", { name: "Add folders to Platform?" })).toBeTruthy();
    expect(view.getByText(
      "All chats in Platform will gain access to these folders:",
    )).toBeTruthy();
    expect(view.getByText("alpha")).toBeTruthy();
    expect(view.getByText("a-very-long-source-folder-name")).toBeTruthy();
    expect(view.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Close" })).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    expect(calls).toEqual(["close", "continue"]);
  });

  test("Cancel closes without granting access", () => {
    const onClose = vi.fn();
    const onContinue = vi.fn();
    const view = render(
      <NodexTooltipProvider>
        <SidebarThreadMoveConfirmationDialog
          confirmation={confirmation}
          onClose={onClose}
          onContinue={onContinue}
        />
      </NodexTooltipProvider>,
    );

    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onContinue).not.toHaveBeenCalled();
  });
});
