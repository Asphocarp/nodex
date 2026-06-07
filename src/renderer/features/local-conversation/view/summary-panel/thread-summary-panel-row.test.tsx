import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render, textContent } from "../../../../test/dom";

describe("ThreadSummaryPanelRow", () => {
  test("activates click and keyboard interactions for interactive rows", async () => {
    const { ThreadSummaryPanelRow } = await import("./thread-summary-panel-row");
    let count = 0;
    const { getByRole } = render(
      <ThreadSummaryPanelRow
        label="Changes"
        interactive
        onClick={() => {
          count += 1;
        }}
      />,
    );

    const row = getByRole("button");
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });

    expect(String(count)).toBe("3");
  });

  test("does not activate disabled rows", async () => {
    const { ThreadSummaryPanelRow } = await import("./thread-summary-panel-row");
    let count = 0;
    const { getByRole } = render(
      <ThreadSummaryPanelRow
        label="Commit or push"
        interactive
        disabled
        onClick={() => {
          count += 1;
        }}
      />,
    );

    const row = getByRole("button");
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });

    expect(String(count)).toBe("0");
    expect(row.className.includes("opacity-40")).toBeTrue();
  });

  test("shows trailing content when requested", async () => {
    const { ThreadSummaryPanelRow } = await import("./thread-summary-panel-row");
    const { container } = render(
      <ThreadSummaryPanelRow
        label="Changes"
        trailing={<span>+12 -4</span>}
        trailingVisible
      />,
    );

    const content = textContent(container);
    const trailing = container.querySelector(".ms-auto");
    expect(content.includes("+12 -4")).toBeTrue();
    expect(trailing?.className.includes("opacity-100")).toBeTrue();
  });

  test("does not propagate accessory clicks to the row action", async () => {
    const { ThreadSummaryPanelRow } = await import("./thread-summary-panel-row");
    let rowClicks = 0;
    let accessoryClicks = 0;
    const { getByText } = render(
      <ThreadSummaryPanelRow
        label="Branch"
        interactive
        onClick={() => {
          rowClicks += 1;
        }}
        accessory={(
          <span
            role="button"
            tabIndex={0}
            onClick={() => {
              accessoryClicks += 1;
            }}
          >
            select
          </span>
        )}
      />,
    );

    fireEvent.click(getByText("select"));

    expect(String(accessoryClicks)).toBe("1");
    expect(String(rowClicks)).toBe("0");
  });
});
