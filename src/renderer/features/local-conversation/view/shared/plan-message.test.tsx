import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { NodexTooltipProvider as TooltipProvider } from "../../../../components/ui/tooltip";
import { render, settleAsyncRender, textContent } from "../../../../test/dom";
import { PlanMessage } from "./plan-message";

describe("PlanMessage", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => "blob:plan",
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: () => { },
    });
  });

  test("animates collapsed and expanded height with Motion-style height targets", async () => {
    const { container, getByRole } = render(
      <TooltipProvider>
        <PlanMessage
          content={`# Plan\n\n1. Inspect the codebase.\n2. Implement the change.\n3. Verify the result.`}
        />
      </TooltipProvider>,
    );

    const body = container.querySelector(`#${getByRole("button", { name: "Expand plan summary" }).getAttribute("aria-controls") ?? ""}`);
    expect(Boolean(body)).toBeTrue();
    expect(Boolean(body?.getAttribute("style")?.includes("height: 320px"))).toBeTrue();
    expect(Boolean(textContent(container).includes("Expand plan"))).toBeTrue();

    fireEvent.click(getByRole("button", { name: "Expand plan summary" }));
    await settleAsyncRender();

    expect(Boolean(body?.getAttribute("style")?.includes("height: auto"))).toBeTrue();
  });
});
