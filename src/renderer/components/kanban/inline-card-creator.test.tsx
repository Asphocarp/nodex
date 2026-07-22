import { fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { render, settleAsyncRender } from "@/test/dom";
import type { PageInput } from "@/lib/types";
import { InlineCardCreator } from "./inline-card-creator";

interface PropertySelectionCase {
  readonly triggerName: "Priority" | "Estimate";
  readonly optionName: string;
  readonly expectedInput: PageInput;
}

const PROPERTY_SELECTION_CASES: PropertySelectionCase[] = [
  {
    triggerName: "Priority",
    optionName: "P1 - High",
    expectedInput: {
      title: "Ship reliable inline creation",
      description: "",
      priority: "p1-high",
      tags: [],
    },
  },
  {
    triggerName: "Estimate",
    optionName: "XL",
    expectedInput: {
      title: "Ship reliable inline creation",
      description: "",
      estimate: "xl",
      tags: [],
    },
  },
];

describe("InlineCardCreator", () => {
  test.each(PROPERTY_SELECTION_CASES)(
    "keeps the draft open and saves the selected $triggerName",
    async ({ triggerName, optionName, expectedInput }) => {
      const onSave = vi.fn<(input: PageInput) => Promise<void>>().mockResolvedValue();
      const view = render(
        <InlineCardCreator
          onSave={onSave}
          onCancel={() => undefined}
        />,
      );

      fireEvent.change(view.getByPlaceholderText("Type a name..."), {
        target: { value: expectedInput.title },
      });
      fireEvent.pointerDown(view.getByRole("button", { name: triggerName }), {
        button: 0,
        ctrlKey: false,
      });
      await settleAsyncRender();

      const option = view.getByRole("menuitem", { name: optionName });
      fireEvent.mouseDown(option, { button: 0 });
      fireEvent.click(option);
      await settleAsyncRender();

      expect(onSave).not.toHaveBeenCalled();

      fireEvent.mouseDown(document.body, { button: 0 });
      await settleAsyncRender();

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith(expectedInput);
    },
  );

  test("clears a draft property without submitting the form", async () => {
    const onSave = vi.fn<(input: PageInput) => Promise<void>>().mockResolvedValue();
    const view = render(
      <InlineCardCreator
        onSave={onSave}
        onCancel={() => undefined}
      />,
    );

    fireEvent.change(view.getByPlaceholderText("Type a name..."), {
      target: { value: "Keep editing" },
    });
    fireEvent.pointerDown(view.getByRole("button", { name: "Priority" }), {
      button: 0,
      ctrlKey: false,
    });
    await settleAsyncRender();
    fireEvent.click(view.getByRole("menuitem", { name: "P1 - High" }));
    await settleAsyncRender();

    fireEvent.click(view.getByRole("button", { name: "P1 ×" }));
    await settleAsyncRender();

    expect(onSave).not.toHaveBeenCalled();
    expect(view.getByRole("button", { name: "Priority" })).toBeTruthy();
  });
});
