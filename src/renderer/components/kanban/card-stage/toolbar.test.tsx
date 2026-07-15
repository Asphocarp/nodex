import { describe, expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { act, useEffect } from "react";
import {
  NodexTooltipProvider,
  dismissNodexTooltips,
} from "@/components/ui/tooltip";
import { render, settleAsyncRender } from "@/test/dom";
import { CardStageToolbar } from "./toolbar";

describe("card stage toolbar", () => {
  test("history and overflow actions survive capture-phase tooltip dismissal", async () => {
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
            onCopyDeeplink={() => undefined}
            onDelete={() => {
              deleteCalls += 1;
            }}
            onToggleContentWidth={() => undefined}
            onToggleShowRawContent={() => undefined}
            onToggleHistoryPanel={() => {
              historyCalls += 1;
            }}
          />
        </NodexTooltipProvider>
      );
    }

    const view = render(<ToolbarHarness />);
    const historyButton = view.getByRole("button", { name: "History" });
    const cardActionsButton = view.getByRole("button", { name: "Card actions" });

    await act(async () => {
      fireEvent.pointerDown(historyButton);
      fireEvent.click(historyButton);
      fireEvent.pointerDown(cardActionsButton, { button: 0, ctrlKey: false });
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(view.getByRole("menuitem", { name: "Delete" }));
      await Promise.resolve();
    });

    expect(historyCalls).toBe(1);
    expect(deleteCalls).toBe(1);
  });

  test("keeps direct controls concise and groups card actions in the trailing menu", async () => {
    let copyCalls = 0;
    const view = render(
      <NodexTooltipProvider>
        <CardStageToolbar
          saving={false}
          historyPanelActive={false}
          limitMainContentWidth={true}
          showRawContent={false}
          onCopyDeeplink={() => {
            copyCalls += 1;
          }}
          onDelete={() => undefined}
          onToggleContentWidth={() => undefined}
          onToggleShowRawContent={() => undefined}
        />
      </NodexTooltipProvider>,
    );

    const labels = view.getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"))
      .filter(Boolean)
      .join(",");
    expect(labels).toBe("Show raw,Full width,History,Card actions");

    fireEvent.pointerDown(view.getByRole("button", { name: "Card actions" }), {
      button: 0,
      ctrlKey: false,
    });
    await settleAsyncRender();

    expect(view.getByRole("menuitem", { name: "Copy deeplink" })).toBeTruthy();
    expect(view.getByRole("menuitem", { name: "Delete" })).toBeTruthy();

    fireEvent.click(view.getByRole("menuitem", { name: "Copy deeplink" }));
    expect(copyCalls).toBe(1);
  });

  test("renders nested card ancestry as accessible navigation", async () => {
    const openedCards: Array<{ cardId: string; index: number }> = [];
    const view = render(
      <NodexTooltipProvider>
        <CardStageToolbar
          saving={false}
          historyPanelActive={false}
          limitMainContentWidth={true}
          showRawContent={false}
          onCopyDeeplink={() => undefined}
          onDelete={() => undefined}
          onToggleContentWidth={() => undefined}
          onToggleShowRawContent={() => undefined}
          breadcrumb={{
            ancestors: [
              { projectId: "alpha", cardId: "root", title: "Root card" },
              { projectId: "alpha", cardId: "child", title: "Child card" },
            ],
            currentTitle: "Nested card",
            onOpenAncestor: (ancestor, index) => {
              openedCards.push({ cardId: ancestor.cardId, index });
            },
          }}
        />
      </NodexTooltipProvider>,
    );

    const breadcrumb = view.getByRole("navigation", { name: "Card hierarchy" });
    expect(breadcrumb.querySelector('[aria-current="page"]')?.textContent).toBe("Nested card");

    await act(async () => {
      fireEvent.click(within(breadcrumb).getByRole("button", { name: "Child card" }));
      await Promise.resolve();
    });

    expect(openedCards).toEqual([{ cardId: "child", index: 1 }]);
  });

  test("keeps overflowed middle ancestors navigable", async () => {
    const openedCards: string[] = [];
    const view = render(
      <NodexTooltipProvider>
        <CardStageToolbar
          saving={false}
          historyPanelActive={false}
          limitMainContentWidth={true}
          showRawContent={false}
          onCopyDeeplink={() => undefined}
          onDelete={() => undefined}
          onToggleContentWidth={() => undefined}
          onToggleShowRawContent={() => undefined}
          breadcrumb={{
            ancestors: [
              { projectId: "alpha", cardId: "root", title: "Root" },
              { projectId: "alpha", cardId: "middle", title: "Middle" },
              { projectId: "alpha", cardId: "child", title: "Child" },
              { projectId: "alpha", cardId: "parent", title: "Parent" },
            ],
            currentTitle: "Nested",
            onOpenAncestor: (ancestor) => openedCards.push(ancestor.cardId),
          }}
        />
      </NodexTooltipProvider>,
    );

    await act(async () => {
      fireEvent.pointerDown(view.getByRole("button", { name: "More ancestor cards" }), {
        button: 0,
        ctrlKey: false,
      });
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(view.getByRole("menuitem", { name: "Middle" }));
      await Promise.resolve();
    });

    expect(openedCards).toEqual(["middle"]);
  });
});
