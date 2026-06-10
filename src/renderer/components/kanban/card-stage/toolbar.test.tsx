import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { act, useEffect } from "react";
import { render } from "../../../test/dom";
import {
  NodexTooltipProvider,
  dismissNodexTooltips,
} from "@/components/ui/tooltip";
import { CardStageToolbar } from "./toolbar";

describe("card stage toolbar", () => {
  test("history and delete actions survive capture-phase tooltip dismissal", async () => {
    let historyCalls = 0;
    let deleteCalls = 0;

    function ToolbarHarness() {
      useEffect(() => {
        const dismissOnPointerDown = () => {
          dismissNodexTooltips();
        };

        document.addEventListener("pointerdown", dismissOnPointerDown, true);
        return () => {
          document.removeEventListener("pointerdown", dismissOnPointerDown, true);
        };
      }, []);

      return (
        <NodexTooltipProvider>
          <CardStageToolbar
            saving={false}
            historyPanelActive={false}
            limitMainContentWidth={true}
            showRawContent={false}
            onClose={() => undefined}
            onDelete={() => {
              deleteCalls += 1;
            }}
            onToggleContentWidth={() => undefined}
            onToggleShowRawContent={() => undefined}
            onOpenHistoryPanel={() => {
              historyCalls += 1;
            }}
          />
        </NodexTooltipProvider>
      );
    }

    const view = render(<ToolbarHarness />);
    const historyButton = view.getByRole("button", { name: "History" });
    const deleteButton = view.getByRole("button", { name: "Delete" });

    await act(async () => {
      fireEvent.pointerDown(historyButton);
      fireEvent.click(historyButton);
      fireEvent.pointerDown(deleteButton);
      fireEvent.click(deleteButton);
    });

    expect(historyCalls).toBe(1);
    expect(deleteCalls).toBe(1);
  });
});
