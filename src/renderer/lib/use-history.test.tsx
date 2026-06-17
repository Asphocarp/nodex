import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import {
  __resetNodexToastStoreForTests,
  NodexToastProvider,
} from "@/components/ui/toast";
import { installAsyncRequestAnimationFrame } from "@/test/browser-globals";
import { render, settleAsyncRender } from "@/test/dom";
import { TestQueryProvider } from "@/test/query";
import { useHistory } from "./use-history";

mock.module("./use-history-deps", () => ({
  invoke: async (channel: string) => {
    if (channel === "history:recent") {
      return {
        canUndo: true,
        canRedo: false,
        undoDescription: "Card update",
        redoDescription: null,
      };
    }

    if (channel === "history:undo") {
      return {
        success: true,
        canUndo: false,
        canRedo: true,
        undoDescription: null,
        redoDescription: "Card update",
        entry: {
          operation: "update",
        },
      };
    }

    return null;
  },
}));

function HistoryHarness() {
  const history = useHistory("project-1");

  return (
    <button
      type="button"
      disabled={!history.canUndo}
      onClick={() => {
        void history.undo();
      }}
    >
      Undo action
    </button>
  );
}

describe("useHistory", () => {
  beforeEach(() => {
    installAsyncRequestAnimationFrame();
    __resetNodexToastStoreForTests();
  });

  test("emits a global history toast after a successful undo", async () => {
    const view = render(
      <TestQueryProvider>
        <NodexToastProvider>
          <HistoryHarness />
        </NodexToastProvider>
      </TestQueryProvider>,
    );

    await settleAsyncRender();
    const undoButton = view.getByRole("button", { name: "Undo action" }) as HTMLButtonElement;
    await waitFor(() => {
      if (undoButton.disabled) {
        throw new Error("Expected undo to become available.");
      }
    });
    fireEvent.click(undoButton);
    await settleAsyncRender();

    await waitFor(() => {
      expect(Boolean(view.baseElement.textContent?.includes("Undid card update"))).toBeTrue();
    });
  });
});
