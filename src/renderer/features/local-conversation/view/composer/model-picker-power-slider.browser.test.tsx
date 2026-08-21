import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test } from "vite-plus/test";
import type { ComposerPowerChoice } from "./composer-intelligence-power-policy";
import { ModelPickerPowerSlider } from "./model-picker-power-slider";
import "../../../../globals.css";

const CHOICES: readonly ComposerPowerChoice[] = [
  {
    id: "terra:low",
    model: "gpt-5.6-terra",
    reasoningEffort: "low",
    modelLabel: "5.6 Terra",
    reasoningLabel: "Light",
    isUltra: false,
  },
  {
    id: "sol:medium",
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    modelLabel: "5.6 Sol",
    reasoningLabel: "Medium",
    isUltra: false,
  },
  {
    id: "sol:xhigh",
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    modelLabel: "5.6 Sol",
    reasoningLabel: "Extra High",
    isUltra: false,
  },
];

describe("ModelPickerPowerSlider", () => {
  test("exposes the selected choice and commits keyboard and wheel steps", () => {
    const selected: number[] = [];
    const view = render(
      <div className="w-56">
        <ModelPickerPowerSlider
          choices={CHOICES}
          selectedIndex={1}
          onSelect={(index) => selected.push(index)}
        />
      </div>,
    );
    const slider = view.getByRole("slider", { name: "Power" });

    expect(slider.getAttribute("aria-valuetext")).toBe("5.6 Sol Medium");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "Home" });
    fireEvent.wheel(slider, { deltaY: -10 });

    expect(selected).toEqual([2, 0, 2]);
    expect(view.getByText("Faster")).not.toBeNull();
    expect(view.getByText("Smarter")).not.toBeNull();
  });

  test("commits a click at the nearest discrete point", () => {
    const selected: number[] = [];
    const view = render(
      <div className="w-56">
        <ModelPickerPowerSlider
          choices={CHOICES}
          selectedIndex={0}
          onSelect={(index) => selected.push(index)}
        />
      </div>,
    );
    const slider = view.getByRole("slider", { name: "Power" });
    const rect = slider.getBoundingClientRect();
    const clientX = rect.left + rect.width;

    fireEvent.pointerDown(slider, { pointerId: 1, clientX });
    fireEvent.pointerUp(slider, { pointerId: 1, clientX });

    expect(selected.at(-1)).toBe(2);
  });

  test("previews without committing, honors the drag threshold, and completes with Enter", () => {
    const selected: number[] = [];
    const view = render(
      <div className="w-56">
        <ModelPickerPowerSlider
          choices={CHOICES}
          selectedIndex={0}
          onSelect={(index) => selected.push(index)}
        />
      </div>,
    );
    const slider = view.getByRole("slider", { name: "Power" });
    const rect = slider.getBoundingClientRect();

    fireEvent.pointerMove(slider, {
      pointerId: 1,
      clientX: rect.right,
    });
    expect(selected).toEqual([]);
    expect(view.getByText("5.6 Sol Extra High")).not.toBeNull();

    fireEvent.keyDown(slider, { key: "Enter" });
    expect(selected).toEqual([2]);

    selected.length = 0;
    fireEvent.pointerDown(slider, {
      pointerId: 2,
      clientX: rect.left,
    });
    fireEvent.pointerMove(slider, {
      pointerId: 2,
      clientX: rect.left + 3,
    });
    expect(selected).toEqual([]);

    fireEvent.pointerMove(slider, {
      pointerId: 2,
      clientX: rect.right,
    });
    expect(selected).toEqual([2]);
    expect(view.container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      "5.6 Terra Light",
    );
  });
});
