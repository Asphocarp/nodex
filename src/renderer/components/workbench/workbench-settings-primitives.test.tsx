import { describe, expect, test } from "bun:test";
import { render } from "../../test/dom";
import {
  SettingsPageSurface,
} from "./workbench-settings-primitives";

describe("SettingsPageSurface", () => {
  test("applies Codex settings shell typography variables", () => {
    const view = render(
      <SettingsPageSurface title="Environments">
        <div>Body</div>
      </SettingsPageSurface>,
    );

    const shell = view.container.firstElementChild as HTMLElement | null;
    expect(shell === null).toBeFalse();
    expect(shell?.style.getPropertyValue("--text-heading-md")).toBe("23px");
    expect(shell?.style.getPropertyValue("--text-heading-lg")).toBe("28px");
    expect(shell?.style.getPropertyValue("--cursor-interaction")).toBe("pointer");
  });
});
