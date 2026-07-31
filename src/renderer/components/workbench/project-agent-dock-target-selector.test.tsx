import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { render } from "../../test/dom";
import type { ProjectAgentDockModel } from "@/lib/project-agent-dock-model";
import { ProjectAgentDockTargetSelector } from "./project-agent-dock-target-selector";

const newRow = {
  id: "new",
  kind: "new",
  sessionId: null,
  label: "New task",
  statusLabel: "Draft",
  preview: null,
  selected: true,
  attention: "none",
} as const;
const runningRow = {
  id: "session:running",
  kind: "session",
  sessionId: "running",
  label: "Refine board",
  statusLabel: "Running",
  preview: "Updating the project database",
  selected: false,
  attention: "activity",
} as const;

function makeModel(
  overrides: Partial<ProjectAgentDockModel> = {},
): ProjectAgentDockModel {
  return {
    trigger: newRow,
    rows: [newRow, runningRow],
    canSend: true,
    collectionMessage: null,
    hasMore: false,
    ...overrides,
  };
}

describe("ProjectAgentDockTargetSelector", () => {
  test("selects the active keyboard row and returns focus to the trigger", async () => {
    const onSelect = vi.fn();
    const view = render(
      <ProjectAgentDockTargetSelector
        model={makeModel()}
        query=""
        onQueryChange={() => undefined}
        onSelect={onSelect}
        onLoadMore={() => undefined}
        onRetry={() => undefined}
      />,
    );
    const trigger = view.getByLabelText("Agent target: New task");
    await act(async () => {
      fireEvent.click(trigger);
    });
    const input = await view.findByRole("combobox", {
      name: "Choose agent target",
    });
    await waitFor(() => expect(document.activeElement).toBe(input));

    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(onSelect).toHaveBeenCalledWith(runningRow);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  test("keeps loading, retry, and pagination actions inside the picker", async () => {
    const onRetry = vi.fn();
    const onLoadMore = vi.fn();
    const view = render(
      <ProjectAgentDockTargetSelector
        model={makeModel({
          collectionMessage: "Couldn’t load tasks",
          hasMore: true,
        })}
        query=""
        onQueryChange={() => undefined}
        onSelect={() => undefined}
        onLoadMore={onLoadMore}
        onRetry={onRetry}
      />,
    );
    await act(async () => {
      fireEvent.click(view.getByLabelText("Agent target: New task"));
    });
    const listbox = await view.findByRole("listbox", {
      name: "Project tasks",
    });
    await act(async () => {
      fireEvent.click(within(listbox).getByRole("button", { name: "Retry" }));
      fireEvent.click(within(listbox).getByRole("button", { name: "Load more" }));
    });
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});
