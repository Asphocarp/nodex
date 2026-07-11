import { describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { render } from "@/test/dom";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { PermissionModeDropdown } from "./permission-mode-dropdown";

async function openPermissionMenu(view: ReturnType<typeof render>): Promise<void> {
  await act(async () => {
    const trigger = view.getByLabelText("Permission mode");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    await Promise.resolve();
  });
}

describe("permission mode dropdown", () => {
  test("renders Approve for me as the visible automatic reviewer mode", async () => {
    let view!: ReturnType<typeof render>;

    await act(async () => {
      view = render(
        <NodexTooltipProvider>
          <PermissionModeDropdown
            selectedMode="guardian-approvals"
            customDescription={null}
            availableModes={["auto", "guardian-approvals", "full-access", "custom"]}
            autoReviewAvailable
            onSelect={() => {}}
          />
        </NodexTooltipProvider>,
      );
    });

    expect(view.getByLabelText("Permission mode").textContent?.includes("Approve for me")).toBe(true);

    await openPermissionMenu(view);

    const bodyText = view.container.ownerDocument.body.textContent ?? "";
    expect(bodyText.includes("How should Codex actions be approved?")).toBe(true);
    expect(bodyText.includes("Ask for approval")).toBe(true);
    expect(bodyText.includes("Always ask to edit external files and use the internet")).toBe(true);
    expect(bodyText.includes("Approve for me")).toBe(true);
    expect(bodyText.includes("Only ask for actions detected as potentially unsafe")).toBe(true);
    expect(bodyText.includes("Guardian approvals")).toBe(false);
  });

  test("does not select Approve for me when it is unavailable", async () => {
    let view!: ReturnType<typeof render>;
    let selectedMode: string | null = null;

    await act(async () => {
      view = render(
        <NodexTooltipProvider>
          <PermissionModeDropdown
            selectedMode="auto"
            customDescription={null}
            availableModes={["auto", "full-access"]}
            autoReviewAvailable={false}
            onSelect={(mode) => {
              selectedMode = mode;
            }}
          />
        </NodexTooltipProvider>,
      );
    });

    await openPermissionMenu(view);

    const autoReviewItem = view.getByText("Approve for me");
    expect(autoReviewItem.closest("[data-disabled]") !== null).toBe(true);
    expect((view.container.ownerDocument.body.textContent ?? "").includes("Requires default sandboxed permissions in this workspace")).toBe(true);

    await act(async () => {
      fireEvent.click(autoReviewItem);
      await Promise.resolve();
    });

    expect(selectedMode).toBe(null);
  });

  test("keeps Custom visible but disabled unless it is available or currently selected", async () => {
    let defaultView!: ReturnType<typeof render>;
    let customView!: ReturnType<typeof render>;
    let selectedMode: string | null = null;

    await act(async () => {
      defaultView = render(
        <NodexTooltipProvider>
          <PermissionModeDropdown
            selectedMode="auto"
            customDescription={null}
            availableModes={["auto", "guardian-approvals", "full-access"]}
            autoReviewAvailable
            onSelect={(mode) => {
              selectedMode = mode;
            }}
          />
        </NodexTooltipProvider>,
      );
    });
    await openPermissionMenu(defaultView);

    const unavailableCustomItem = defaultView.getByText("Custom (config.toml)");
    expect(unavailableCustomItem.closest("[data-disabled]") !== null).toBe(true);

    await act(async () => {
      fireEvent.click(unavailableCustomItem);
      await Promise.resolve();
    });

    expect(selectedMode).toBe(null);

    defaultView.unmount();

    await act(async () => {
      customView = render(
        <NodexTooltipProvider>
          <PermissionModeDropdown
            selectedMode="custom"
            customDescription="Project config: sandbox_mode=read-only."
            availableModes={["auto", "full-access"]}
            autoReviewAvailable={false}
            onSelect={() => {}}
          />
        </NodexTooltipProvider>,
      );
    });
    await openPermissionMenu(customView);

    expect((customView.container.ownerDocument.body.textContent ?? "").includes("Custom (config.toml)")).toBe(true);
  });

  test("selects Custom when it is available", async () => {
    let view!: ReturnType<typeof render>;
    let selectedMode: string | null = null;

    await act(async () => {
      view = render(
        <NodexTooltipProvider>
          <PermissionModeDropdown
            selectedMode="auto"
            customDescription="User config: sandbox_mode=workspace-write; approval_policy=on-request."
            availableModes={["auto", "guardian-approvals", "full-access", "custom"]}
            autoReviewAvailable
            onSelect={(mode) => {
              selectedMode = mode;
            }}
          />
        </NodexTooltipProvider>,
      );
    });
    await openPermissionMenu(view);

    const customItem = view.getByText("Custom (config.toml)");
    expect(customItem.closest("[data-disabled]") === null).toBe(true);

    await act(async () => {
      fireEvent.click(customItem);
      await Promise.resolve();
    });

    expect(selectedMode).toBe("custom");
  });

  test("selects Full access directly without confirmation", async () => {
    let view!: ReturnType<typeof render>;
    let selectedMode: string | null = null;
    let confirmCalled = false;
    const originalConfirm = globalThis.confirm;

    globalThis.confirm = (() => {
      confirmCalled = true;
      return false;
    }) as typeof globalThis.confirm;

    try {
      await act(async () => {
        view = render(
          <NodexTooltipProvider>
            <PermissionModeDropdown
              selectedMode="auto"
              customDescription={null}
              availableModes={["auto", "guardian-approvals", "full-access", "custom"]}
              autoReviewAvailable
              onSelect={(mode) => {
                selectedMode = mode;
              }}
            />
          </NodexTooltipProvider>,
        );
      });
      await openPermissionMenu(view);

      const fullAccessItem = view.getByText("Full access");

      await act(async () => {
        fireEvent.click(fullAccessItem);
        await Promise.resolve();
      });

      expect(confirmCalled).toBe(false);
      expect(selectedMode).toBe("full-access");
    } finally {
      globalThis.confirm = originalConfirm;
    }
  });
});
