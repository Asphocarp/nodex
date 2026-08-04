import { describe, expect, test } from "vitest";
import { render } from "../../test/dom";
import {
  NodexSettingsPageSurface,
  NodexSettingsRow,
  NodexSettingsSection,
} from "./settings";

describe("NodexSettingsPageSurface", () => {
  test("renders a labelled settings main surface with semantic headings", () => {
    const view = render(
      <NodexSettingsPageSurface title="Environments">
        <NodexSettingsSection title="Local environments">
          <NodexSettingsRow label="Default environment" description="Used for new tasks">
            <button type="button">Choose</button>
          </NodexSettingsRow>
        </NodexSettingsSection>
      </NodexSettingsPageSurface>,
    );

    const main = view.getByRole("main");
    const pageHeading = view.getByRole("heading", { level: 1, name: "Environments" });
    const section = view.getByRole("region", { name: "Local environments" });
    const sectionHeading = view.getByRole("heading", {
      level: 2,
      name: "Local environments",
    });

    expect(main.getAttribute("aria-labelledby")).toBe(pageHeading.id);
    expect(section.getAttribute("aria-labelledby")).toBe(sectionHeading.id);
    expect(view.getByText("Used for new tasks").textContent).toBe("Used for new tasks");
  });
});
