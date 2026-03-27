import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { render, settleAsyncRender } from "@/test/dom";
import { EnvironmentSelectorPopover } from "./environment-selector-popover";

describe("environment selector popover", () => {
  test("renders as a dropdown menu with the shared local environment layout", async () => {
    let view!: ReturnType<typeof render>;

    await act(async () => {
      view = render(
        <EnvironmentSelectorPopover
          busy={false}
          options={[
            {
              path: ".codex/environments/environment.toml",
              name: "Default",
              hasSetupScript: true,
              hasCleanupScript: false,
              actionCount: 1,
            },
          ]}
          onRefresh={async () => {}}
          onSelect={async () => true}
          onOpenSettings={async () => {}}
        />,
      );
    });

    await act(async () => {
      const trigger = view.getByLabelText("Select worktree environment");
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
      await settleAsyncRender();
    });

    const content = view.container.ownerDocument.body.querySelector('[data-radix-menu-content]');
    const popover = view.container.ownerDocument.body.querySelector('[data-slot="popover-content"]');

    expect(content).not.toBeNull();
    expect(popover === null).toBeTrue();
    expect(view.container.ownerDocument.body.textContent?.includes("Local environment") ?? false).toBeTrue();
    expect(view.container.ownerDocument.body.textContent?.includes("Environment settings") ?? false).toBeTrue();
  });
});
