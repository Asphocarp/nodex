import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { render } from "../../test/dom";
import type { ProjectAgentDockModel } from "@/lib/project-agent-dock-model";
import { ProjectAgentDockTargetSelector } from "./project-agent-dock-target-selector";

const newRow = {
  id: "new",
  kind: "new",
  sessionId: null,
  label: "New chat",
  preview: null,
  selected: true,
  attention: "none",
  indicator: "idle",
} as const;
const runningRow = {
  id: "session:running",
  kind: "session",
  sessionId: "running",
  label: "Refine board",
  preview: "Updating the project database",
  selected: false,
  attention: "activity",
  indicator: "running",
} as const;
const unreadRow = {
  id: "session:unread",
  kind: "session",
  sessionId: "unread",
  label: "Review notes",
  preview: "A new response is ready",
  selected: false,
  attention: "none",
  indicator: "unread",
} as const;

function makeModel(
  overrides: Partial<ProjectAgentDockModel> = {},
): ProjectAgentDockModel {
  return {
    trigger: newRow,
    rows: [newRow, runningRow, unreadRow],
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
    const trigger = view.getByLabelText("Connected chat: New chat");
    await act(async () => {
      fireEvent.click(trigger);
    });
    const input = await view.findByRole("combobox", {
      name: "Choose connected chat",
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

  test("does not refocus the search input when result rows refresh", async () => {
    const renderSelector = (model: ProjectAgentDockModel) => (
      <ProjectAgentDockTargetSelector
        model={model}
        query=""
        onQueryChange={() => undefined}
        onSelect={() => undefined}
        onLoadMore={() => undefined}
        onRetry={() => undefined}
      />
    );
    const view = render(renderSelector(makeModel({ hasMore: true })));
    await act(async () => {
      fireEvent.click(view.getByLabelText("Connected chat: New chat"));
    });
    const input = await view.findByRole("combobox", {
      name: "Choose connected chat",
    });
    await waitFor(() => expect(document.activeElement).toBe(input));
    const loadMore = view.getByRole("button", { name: "Load more" });
    loadMore.focus();

    view.rerender(renderSelector(makeModel({
      rows: [newRow, unreadRow, runningRow],
      hasMore: true,
    })));

    await waitFor(() => expect(document.activeElement).toBe(loadMore));
  });

  test("uses the leading indicator for running and unread state without status copy", async () => {
    const view = render(
      <ProjectAgentDockTargetSelector
        model={makeModel()}
        query=""
        onQueryChange={() => undefined}
        onSelect={() => undefined}
        onLoadMore={() => undefined}
        onRetry={() => undefined}
      />,
    );

    await act(async () => {
      fireEvent.click(view.getByLabelText("Connected chat: New chat"));
    });
    const listbox = await view.findByRole("listbox", { name: "Project chats" });
    const runningOption = within(listbox).getByRole("option", {
      name: /Running, Refine board/,
    });
    const unreadOption = within(listbox).getByRole("option", {
      name: /Unread, Review notes/,
    });

    expect(within(runningOption).getByLabelText("Running")).not.toBeNull();
    expect(within(unreadOption).getByLabelText("Unread")).not.toBeNull();
    expect(within(listbox).queryByText("Draft")).toBeNull();
    expect(within(listbox).queryByText("Running")).toBeNull();
    expect(view.getByPlaceholderText("Find a chat")).not.toBeNull();
  });

  test("keeps loading, retry, and pagination actions inside the picker", async () => {
    const onRetry = vi.fn();
    const onLoadMore = vi.fn();
    const view = render(
      <ProjectAgentDockTargetSelector
        model={makeModel({
          collectionMessage: "Couldn’t load chats",
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
      fireEvent.click(view.getByLabelText("Connected chat: New chat"));
    });
    const listbox = await view.findByRole("listbox", {
      name: "Project chats",
    });
    await act(async () => {
      fireEvent.click(within(listbox).getByRole("button", { name: "Retry" }));
      fireEvent.click(within(listbox).getByRole("button", { name: "Load more" }));
    });
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});
