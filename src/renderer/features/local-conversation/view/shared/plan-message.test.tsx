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
          completed={false}
          content={`# Plan\n\n1. Inspect the codebase.\n2. Implement the change.\n3. Verify the result.`}
          parseIncompleteMarkdown
          defaultCollapsed
        />
      </TooltipProvider>,
    );

    const body = container.querySelector(`#${getByRole("button", { name: "Expand plan summary" }).getAttribute("aria-controls") ?? ""}`);
    expect(Boolean(body)).toBeTrue();
    expect(Boolean(body?.getAttribute("style")?.includes("height: 320px"))).toBeTrue();
    expect(Boolean(textContent(container).includes("Writing plan"))).toBeTrue();
    expect(Boolean(textContent(container).includes("Expand plan"))).toBeTrue();
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBeTrue();

    fireEvent.click(getByRole("button", { name: "Expand plan summary" }));
    await settleAsyncRender();

    expect(Boolean(body?.getAttribute("style")?.includes("height: auto"))).toBeTrue();
  });

  test("renders the completed title without the writing shimmer", () => {
    const { container } = render(
      <TooltipProvider>
        <PlanMessage
          completed
          content={`# Plan\n\n1. Inspect the codebase.`}
        />
      </TooltipProvider>,
    );

    expect(Boolean(textContent(container).includes("Plan"))).toBeTrue();
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBeFalse();
  });

  test("renders plan markdown content", () => {
    const { container } = render(
      <TooltipProvider>
        <PlanMessage
          completed
          content={"## Plan heading\n\nParagraph body.\n\n- First bullet"}
        />
      </TooltipProvider>,
    );

    const heading = container.querySelector("h2");
    const paragraph = container.querySelector("p");
    const list = container.querySelector("ul");

    expect(heading?.textContent).toBe("Plan heading");
    expect(paragraph?.textContent).toBe("Paragraph body.");
    expect(list?.textContent?.trim()).toBe("First bullet");
  });
});
