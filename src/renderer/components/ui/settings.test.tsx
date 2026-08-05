import { describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { useState } from "react";
import { render } from "../../test/dom";
import { NodexSwitch } from "./button";
import {
  NodexCheckbox,
  NodexSettingsNumberInput,
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

describe("shared settings controls", () => {
  test("keeps number, switch, and checkbox controls semantic and interactive", () => {
    function Controls() {
      const [switchChecked, setSwitchChecked] = useState(false);
      const [checkboxChecked, setCheckboxChecked] = useState(false);

      return (
        <>
          <NodexSettingsNumberInput
            aria-label="Sans font size"
            defaultValue={15}
            min={11}
            max={20}
            step={1}
          />
          <NodexSwitch
            ariaLabel="Safety backup"
            checked={switchChecked}
            onCheckedChange={setSwitchChecked}
          />
          <NodexCheckbox
            ariaLabel="Platform specific"
            checked={checkboxChecked}
            onCheckedChange={setCheckboxChecked}
          />
        </>
      );
    }

    const view = render(<Controls />);
    const numberInput = view.getByRole("spinbutton", { name: "Sans font size" });
    expect(numberInput.getAttribute("type")).toBe("number");
    expect(numberInput.getAttribute("min")).toBe("11");
    expect(numberInput.getAttribute("max")).toBe("20");

    const switchControl = view.getByRole("switch", { name: "Safety backup" });
    expect(switchControl.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(switchControl);
    expect(switchControl.getAttribute("aria-checked")).toBe("true");

    const checkbox = view.getByRole("checkbox", { name: "Platform specific" });
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(checkbox);
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
  });
});
