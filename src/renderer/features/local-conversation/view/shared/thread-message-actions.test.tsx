import { describe, expect, mock, test } from "bun:test";
import { createElement, Fragment, type ReactNode } from "react";
import { render } from "../../../../test/dom";
import { ForkMessageIcon, ThreadActionIconButton } from "./thread-message-actions";

mock.module("../../../../components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  Tooltip: ({ children, content }: { children: ReactNode; content: ReactNode }) =>
    createElement("div", { "data-tooltip-content": String(content) }, children),
}));

describe("ThreadActionIconButton", () => {
  test("passes a concise tooltip while preserving the descriptive aria label", () => {
    const { getByRole, container } = render(
      <ThreadActionIconButton label="Fork from this message" tooltip="Fork">
        <ForkMessageIcon />
      </ThreadActionIconButton>,
    );

    const tooltipWrapper = container.querySelector('[data-tooltip-content="Fork"]');
    if (!tooltipWrapper) {
      throw new Error("Expected concise tooltip content to be passed to the shared tooltip.");
    }

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
