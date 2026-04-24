import { describe, expect, test } from "bun:test";
import { render } from "../../../../test/dom";
import { NodexTooltipProvider } from "../../../../components/ui/tooltip";
import { ForkMessageIcon, ThreadActionIconButton } from "./thread-message-actions";

describe("ThreadActionIconButton", () => {
  test("passes a concise tooltip while preserving the descriptive aria label", () => {
    const { getByRole } = render(
      <NodexTooltipProvider>
        <ThreadActionIconButton label="Fork from this message" tooltip="Fork">
          <ForkMessageIcon />
        </ThreadActionIconButton>
      </NodexTooltipProvider>,
    );

    const button = getByRole("button", { name: "Fork from this message" });
    expect(button.getAttribute("title")).toBe(null);
  });

  test("renders a plain button when no tooltip is requested", () => {
    const { getByRole, container } = render(
      <ThreadActionIconButton label="Edit message">
        <ForkMessageIcon />
      </ThreadActionIconButton>,
    );

    expect(Boolean(container.querySelector("[data-tooltip-content]"))).toBeFalse();
    expect(Boolean(getByRole("button", { name: "Edit message" }))).toBeTrue();
  });
});
