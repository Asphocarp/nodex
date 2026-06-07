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
    const iconClassName = icon?.getAttribute("class") ?? "";
    const iconClasses = iconClassName.split(/\s+/);
    const labelIndex = Array.from(button.childNodes).indexOf(label as ChildNode);
    const iconIndex = Array.from(button.childNodes).indexOf(icon as ChildNode);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.className.includes("group/section-toggle")).toBeTrue();
    expect(button.className.includes("inline-flex")).toBeTrue();
    expect(label?.textContent).toBe("Environment");
    expect(iconIndex > labelIndex).toBeTrue();
    expect(iconClassName.includes("opacity-0")).toBeTrue();
    expect(iconClassName.includes("group-hover/section-toggle:opacity-100")).toBeTrue();
    expect(iconClassName.includes("group-focus-visible/section-toggle:opacity-100")).toBeTrue();
    expect(iconClasses.some((className) => className === "opacity-100")).toBeFalse();
    expect(iconClassName.includes("rotate-0")).toBeTrue();
    expect(textContent(view.container).includes("Changes")).toBeTrue();

    fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(icon?.getAttribute("class")?.includes("-rotate-90")).toBeTrue();
    expect(textContent(view.container).includes("Changes")).toBeFalse();
  });
});
