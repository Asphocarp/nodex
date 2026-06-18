import { describe, expect, test } from "bun:test";
import { render } from "../../test/dom";
import { NodexSettingsPageSurface } from "./settings";

describe("NodexSettingsPageSurface", () => {
  test("renders the settings page title and body", () => {
    const view = render(
      <NodexSettingsPageSurface title="Environments">
        <div>Body</div>
      </NodexSettingsPageSurface>,
    );

    const shell = view.container.firstElementChild as HTMLElement | null;
    expect(shell === null).toBeFalse();
    expect(view.getByText("Environments").textContent).toBe("Environments");
    expect(view.getByText("Body").textContent).toBe("Body");
  });
});
