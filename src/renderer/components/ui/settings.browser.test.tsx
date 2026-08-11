import { render } from "@testing-library/react";
import type { CSSProperties } from "react";
import { describe, expect, test } from "vitest";

import "@/globals.css";

import { NodexCheckbox } from "./settings";

describe("NodexCheckbox in Chromium", () => {
  test("renders the checked state as a filled 14px control with an inverse checkmark", () => {
    const surfaceStyle = {
      "--color-token-foreground": "rgb(12, 23, 34)",
      "--color-token-dropdown-background": "rgb(241, 242, 243)",
    } as CSSProperties;
    const view = render(
      <div style={surfaceStyle}>
        <NodexCheckbox
          ariaLabel="Selected Page"
          checked
          onCheckedChange={() => undefined}
        />
        <NodexCheckbox
          ariaLabel="Instant List selection"
          checked
          className="transition-none"
          onCheckedChange={() => undefined}
        />
      </div>,
    );
    const checkbox = view.getByRole("checkbox", { name: "Selected Page" });
    const instantCheckbox = view.getByRole("checkbox", {
      name: "Instant List selection",
    });
    const checkmark = checkbox.querySelector("svg");
    if (!checkmark) throw new TypeError("Expected the checked control to render its checkmark");

    const checkboxBounds = checkbox.getBoundingClientRect();
    const checkmarkBounds = checkmark.getBoundingClientRect();
    const style = getComputedStyle(checkbox);
    expect(checkboxBounds.width).toBe(14);
    expect(checkboxBounds.height).toBe(14);
    expect(checkmarkBounds.width).toBe(10);
    expect(checkmarkBounds.height).toBe(9);
    expect(style.backgroundColor).toBe("rgb(12, 23, 34)");
    expect(style.borderColor).toBe("rgb(12, 23, 34)");
    expect(style.color).toBe("rgb(241, 242, 243)");
    expect(style.transitionProperty).toBe("all");
    expect(style.transitionDuration).toBe("0.08s");
    expect(getComputedStyle(instantCheckbox).transitionProperty).toBe("none");
  });
});
