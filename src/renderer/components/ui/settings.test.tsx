import { describe, expect, test } from "bun:test";
import { render } from "../../test/dom";
import { NodexSettingsPageSurface } from "./settings";

describe("NodexSettingsPageSurface", () => {
  test("applies Codex settings shell typography variables", () => {
    const view = render(
      <NodexSettingsPageSurface title="Environments">
        <div>Body</div>
      </NodexSettingsPageSurface>,
    );

    const shell = view.container.firstElementChild as HTMLElement | null;
    expect(shell === null).toBeFalse();
    expect(shell?.className.includes("w-full")).toBeTrue();
    expect(shell?.style.getPropertyValue("--text-heading-md")).toBe("23px");
    expect(shell?.style.getPropertyValue("--text-heading-lg")).toBe("28px");
    expect(shell?.style.getPropertyValue("--cursor-interaction")).toBe("pointer");

    const contentColumn = shell?.querySelector(".max-w-2xl");
    expect(contentColumn === null).toBeFalse();
  });
});
