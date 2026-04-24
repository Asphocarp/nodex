import { describe, expect, test } from "bun:test";
import { act } from "@testing-library/react";
import type { WorkspaceRecord } from "@/lib/types";
import { render, settleAsyncRender, textContent } from "@/test/dom";
import { LeftSidebarWorkspaceManager } from "./left-sidebar-workspace-manager";

function makeWorkspace(id: string, name: string, icon?: string): WorkspaceRecord {
  return {
    id,
    name,
    ...(icon ? { icon } : {}),
    createdAt: "2026-03-09T00:00:00.000Z",
    updatedAt: "2026-03-09T00:00:00.000Z",
    layout: {} as WorkspaceRecord["layout"],
  };
}

describe("LeftSidebarWorkspaceManager", () => {
  test("renders workspace switcher labels without project names", () => {
    const { container, getByTitle, queryByTitle } = render(
      <LeftSidebarWorkspaceManager
        workspaces={[
          makeWorkspace("default", "Default"),
          makeWorkspace("review", "Review", "🚀"),
        ]}
        activeWorkspaceId="review"
        onSelectWorkspace={() => undefined}
        onCreateWorkspace={async () => undefined}
        onRenameWorkspace={async () => undefined}
        onDeleteWorkspace={async () => undefined}
        onOpenSettings={() => undefined}
      />,
    );

    expect(queryByTitle("Review") !== null).toBeTrue();
    expect(textContent(getByTitle("Manage workspaces"))).toBe("");
    expect(textContent(container).includes("🚀")).toBeTrue();
    expect(textContent(container).includes("R")).toBeFalse();
    expect(textContent(container).includes("Nodex")).toBeFalse();
  });

  test("renders active fallback dots with subdued color and inactive dots as gray", () => {
    const { container } = render(
      <LeftSidebarWorkspaceManager
        workspaces={[
          makeWorkspace("default", "Default"),
          makeWorkspace("review", "Review"),
          makeWorkspace("ship", "Ship"),
        ]}
        activeWorkspaceId="default"
        onSelectWorkspace={() => undefined}
        onCreateWorkspace={async () => undefined}
        onRenameWorkspace={async () => undefined}
        onDeleteWorkspace={async () => undefined}
        onOpenSettings={() => undefined}
      />,
    );

    const dotStyles = Array.from(container.querySelectorAll<HTMLElement>("[style*='background-color']"))
      .map((element) => element.getAttribute("style") ?? "")
      .filter((style) => style.includes("background-color"));

    expect(dotStyles[0]?.includes("--color-accent-")).toBeTrue();
    expect(dotStyles[1]?.includes("--foreground-disabled")).toBeTrue();
    expect(dotStyles[2]?.includes("--foreground-disabled")).toBeTrue();
  });

  test("disables deleting the only workspace", async () => {
    const { getByTitle, getByText } = render(
      <LeftSidebarWorkspaceManager
        workspaces={[makeWorkspace("default", "Default")]}
        activeWorkspaceId="default"
        onSelectWorkspace={() => undefined}
        onCreateWorkspace={async () => undefined}
        onRenameWorkspace={async () => undefined}
        onDeleteWorkspace={async () => undefined}
        onOpenSettings={() => undefined}
      />,
    );

    await act(async () => {
      getByTitle("Manage workspaces").click();
    });
    await settleAsyncRender();
    const deleteButton = getByTitle("The last workspace cannot be deleted") as HTMLButtonElement;
    expect(deleteButton.disabled).toBeTrue();
    expect(getByText("Default").textContent?.includes("Default")).toBeTrue();
  });
});
