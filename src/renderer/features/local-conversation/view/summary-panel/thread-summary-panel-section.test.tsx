import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render, textContent } from "../../../../test/dom";
import { ThreadSummaryPanelSection } from "./thread-summary-panel-section";

describe("ThreadSummaryPanelSection", () => {
  test("renders the section chevron after the title and only reveals it on hover or focus", () => {
    const view = render(
      <ThreadSummaryPanelSection title="Environment">
        <div>Changes</div>
      </ThreadSummaryPanelSection>,
    );

    const button = view.getByRole("button");
    const label = button.querySelector("span");
    const icon = button.querySelector("svg");
    const labelIndex = Array.from(button.childNodes).indexOf(label as ChildNode);
    const iconIndex = Array.from(button.childNodes).indexOf(icon as ChildNode);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(label?.textContent).toBe("Environment");
    expect(iconIndex > labelIndex).toBeTrue();
    expect(textContent(view.container).includes("Changes")).toBeTrue();

    fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(textContent(view.container).includes("Changes")).toBeFalse();
  });
});
