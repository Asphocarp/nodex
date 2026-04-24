import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { render } from "@/test/dom";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { PermissionModeDropdown } from "./permission-mode-dropdown";

describe("permission mode dropdown", () => {
  test("renders Auto-review as the visible automatic reviewer mode", async () => {
    let view!: ReturnType<typeof render>;

    await act(async () => {
      view = render(
        <NodexTooltipProvider>
          <PermissionModeDropdown
            selectedMode="guardian-approvals"
            customDescription={null}
            availableModes={["auto", "guardian-approvals", "full-access", "custom"]}
            guardianApprovalEnabled
            onSelect={() => {}}
          />
        </NodexTooltipProvider>,
      );
    });

    expect(view.getByLabelText("Permission mode").textContent?.includes("Auto-review")).toBeTrue();

    await act(async () => {
      const trigger = view.getByLabelText("Permission mode");
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
      await Promise.resolve();
    });

    const bodyText = view.container.ownerDocument.body.textContent ?? "";
    expect(bodyText.includes("Auto-review")).toBeTrue();
    expect(bodyText.includes("Guardian approvals")).toBeFalse();
  });
});
