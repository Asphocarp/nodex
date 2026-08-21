import { describe, expect, test } from "vite-plus/test";
import { render } from "@/test/dom";
import { ComposerActionTooltipContent } from "./composer-submit-tooltip";

describe("ComposerActionTooltipContent", () => {
  test("renders exact running-thread steer then queue rows with mac keycaps", () => {
    const view = render(
      <ComposerActionTooltipContent
        action="send"
        primarySubmitAction="steer"
        alternateSubmitAction="queue"
        isThreadRunning
        primaryShortcutKeys={["Enter"]}
        alternateShortcutKeys={["⌘", "Enter"]}
      />,
    );

    const grid = view.container.querySelector("div.grid");
    if (!grid) {
      throw new Error("Expected tooltip grid");
    }

    const labelSpans = Array.from(grid.querySelectorAll(":scope > span.text-token-foreground"));
    const shortcutWrappers = Array.from(grid.querySelectorAll(":scope > span.justify-self-end"));
    expect(labelSpans.length).toBe(2);
    expect(labelSpans[0]?.textContent).toBe("Steer");
    expect(labelSpans[1]?.textContent).toBe("Queue");
    expect(shortcutWrappers.length).toBe(2);
    expect(shortcutWrappers[0]?.textContent).toBe("Enter");
    expect(shortcutWrappers[1]?.textContent).toBe("⌘Enter");
  });

  test("renders stop and idle send as plain text", () => {
    const stopView = render(
      <ComposerActionTooltipContent
        action="stop"
        primarySubmitAction={null}
        alternateSubmitAction={null}
        isThreadRunning
        primaryShortcutKeys={["Enter"]}
        alternateShortcutKeys={["⌘", "Enter"]}
      />,
    );
    const idleView = render(
      <ComposerActionTooltipContent
        action="send"
        primarySubmitAction="send"
        alternateSubmitAction={null}
        isThreadRunning={false}
        primaryShortcutKeys={["Enter"]}
        alternateShortcutKeys={["⌘", "Enter"]}
      />,
    );

    expect(stopView.container.textContent).toBe("Stop");
    expect(idleView.container.textContent).toBe("Send");
  });
});
