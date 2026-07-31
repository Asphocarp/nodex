import { act } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { render } from "@/test/dom";
import { ThreadComposerExternalFooterSlot } from "./local-conversation-thread-composer-status-strip";

describe("ThreadComposerExternalFooterSlot", () => {
  test("removes stale target controls in the same render that hides the slot", async () => {
    const renderSlot = (visible: boolean) => (
      <ThreadComposerExternalFooterSlot visible={visible}>
        <div data-testid="new-task-target-controls">Project / Work locally / branch</div>
      </ThreadComposerExternalFooterSlot>
    );
    const view = render(renderSlot(true));

    expect(view.queryByTestId("new-task-target-controls")).not.toBeNull();

    await act(async () => {
      view.rerender(renderSlot(false));
      await Promise.resolve();
    });

    expect(view.queryByTestId("new-task-target-controls")).toBeNull();
    expect(view.container.querySelector('[data-composer-external-footer-slot="true"]')).toBeNull();
  });
});
