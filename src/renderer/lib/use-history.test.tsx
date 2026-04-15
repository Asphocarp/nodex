import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import {
  __resetNodexToastStoreForTests,
  NodexToastProvider,
} from "@/components/ui/toast";
import { installAsyncRequestAnimationFrame, installWindowApi } from "@/test/browser-globals";
import { render, settleAsyncRender } from "@/test/dom";
import { useHistory } from "./use-history";

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
    installWindowApi({
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
      on: () => () => { },
    });
  });

  test("emits a global history toast after a successful undo", async () => {
    const view = render(
      <NodexToastProvider>
        <HistoryHarness />
      </NodexToastProvider>,
    );

    await settleAsyncRender();
    fireEvent.click(view.getByRole("button", { name: "Undo action" }));
    await settleAsyncRender();

    expect(Boolean(view.baseElement.textContent?.includes("Undid card update"))).toBeTrue();
  });
});
