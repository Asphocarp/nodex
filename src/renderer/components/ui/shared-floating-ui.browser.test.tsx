import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import "../../globals.css";
import { PropertyOptionPicker } from "@/components/database/property-option-picker";
import { NFM_EDITOR_FLOATING_UI_Z_INDEX } from "@/components/board/editor/nfm-blocknote-floating-ui";
import { Circle } from "@/components/shared/icons/generic-icons";
import {
  NodexDropdownButtonTrigger,
  NodexDropdownChoiceMenu,
} from "./dropdown";
import {
  __resetNodexToastStoreForTests,
  NodexToastProvider,
  toast,
} from "./toast";
import { NodexTooltip, NodexTooltipProvider } from "./tooltip";

const settleFloatingSurface = async (): Promise<void> => {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await Promise.resolve();
};

function ProbeIcon({ testId }: { testId: string }) {
  return <Circle data-testid={testId} className="size-3 fill-current" aria-hidden="true" />;
}

afterEach(async () => {
  await act(async () => {
    __resetNodexToastStoreForTests();
    await Promise.resolve();
  });
});

describe("shared floating UI in Chromium", () => {
  test("keeps actionable toasts outside the window drag region on one visual axis", async () => {
    const view = render(
      <NodexToastProvider>
        <div />
      </NodexToastProvider>,
    );

    await act(async () => {
      toast.info("Page draft closed", {
        duration: 0,
        action: {
          label: "Restore",
          onClick: () => false,
        },
      });
      await settleFloatingSurface();
    });

    const alert = view.getByRole("alert");
    const title = view.getByText("Page draft closed");
    const restore = view.getByRole("button", { name: "Restore" });
    const dismiss = view.getByRole("button", { name: "Dismiss notification" });
    const levelIcon = alert.querySelector("svg");
    if (!levelIcon) throw new Error("Expected a toast level icon.");

    const surfaceCenter = alert.getBoundingClientRect().top + alert.getBoundingClientRect().height / 2;
    for (const element of [title, restore, dismiss, levelIcon]) {
      const rect = element.getBoundingClientRect();
      expect(Math.abs(rect.top + rect.height / 2 - surfaceCenter)).toBeLessThanOrEqual(1);
    }
    expect(getComputedStyle(alert).getPropertyValue("-webkit-app-region")).toBe("no-drag");
  });

  test("renders compact property-chip and menu leading icons at 16 pixels", async () => {
    const view = render(
      <div>
        <PropertyOptionPicker
          label="Status"
          mode="single"
          presentation="chip"
          triggerPrefix={<ProbeIcon testId="property-chip-status-icon" />}
          options={[{ id: "triage", name: "Triage", color: "gray" }]}
          selectedIds={["triage"]}
          onSelectedIdsChange={() => undefined}
        />
        <NodexDropdownChoiceMenu
          value="triage"
          onValueChange={() => undefined}
          options={[
            {
              value: "triage",
              label: "Triage",
              leftSlot: <ProbeIcon testId="menu-status-icon" />,
            },
          ]}
          triggerButton={(
            <NodexDropdownButtonTrigger size="xs" shape="pill" showChevron={false}>
              <ProbeIcon testId="dropdown-chip-status-icon" />
              Triage
            </NodexDropdownButtonTrigger>
          )}
        />
      </div>,
    );

    expect(view.getByTestId("property-chip-status-icon").getBoundingClientRect().width).toBe(16);
    expect(view.getByTestId("dropdown-chip-status-icon").getBoundingClientRect().width).toBe(16);
    const dropdownTrigger = view.getByTestId("dropdown-chip-status-icon").closest("button");
    if (!dropdownTrigger) throw new Error("Expected a compact dropdown trigger.");

    await act(async () => {
      fireEvent.pointerDown(dropdownTrigger, {
        button: 0,
        ctrlKey: false,
      });
      await settleFloatingSurface();
    });

    expect(view.getByTestId("menu-status-icon").getBoundingClientRect().width).toBe(16);
  });

  test("stacks tooltips above editor floating menus", async () => {
    const view = render(
      <NodexTooltipProvider>
        <NodexTooltip defaultOpen tooltipContent="Bold">
          <button type="button">Formatting action</button>
        </NodexTooltip>
      </NodexTooltipProvider>,
    );

    await act(settleFloatingSurface);
    const tooltip = view.getByRole("tooltip").parentElement;
    if (!tooltip) throw new Error("Expected a tooltip content surface.");
    const tooltipZIndex = Number(getComputedStyle(tooltip).zIndex);
    expect(tooltipZIndex).toBeGreaterThan(NFM_EDITOR_FLOATING_UI_Z_INDEX);
  });
});
