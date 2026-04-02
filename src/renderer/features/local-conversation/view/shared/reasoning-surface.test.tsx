import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { settleAsyncRender } from "../../../../test/dom";
import { render, textContent } from "../../../../test/dom";
import {
  extractReasoningSections,
  ReasoningSurface,
  stripReasoningPreviewHeading,
} from "./reasoning-surface";

describe("extractReasoningSections", () => {
  test("extracts a leading bold heading and trims the remaining body", () => {
    const sections = extractReasoningSections("**Investigating**\n\nChecking the failing story state.");
    expect(sections.heading).toBe("Investigating");
    expect(sections.body).toBe("Checking the failing story state.");
  });

  test("extracts a markdown heading line when present", () => {
    const sections = extractReasoningSections("# Investigating\n\nChecking the failing story state.");
    expect(sections.heading).toBe("Investigating");
    expect(sections.body).toBe("Checking the failing story state.");
  });
});

describe("stripReasoningPreviewHeading", () => {
  test("removes a leading bold heading from the streaming preview body", () => {
    expect(stripReasoningPreviewHeading("**Investigating**\n\nChecking the failing story state.").trim()).toBe(
      "Checking the failing story state.",
    );
  });
});

describe("ReasoningSurface", () => {
  test("renders the streaming state as Thinking with the preview body open", () => {
    const { container } = render(
      <ReasoningSurface
        item={{
          markdownText: "**Investigating**\n\nChecking the failing story state.",
          status: "inProgress",
        }}
        parseIncompleteMarkdown
      />,
    );

    const renderedText = textContent(container);
    expect(Boolean(renderedText.includes("Thinking"))).toBeTrue();
    expect(Boolean(renderedText.includes("Checking the failing story state."))).toBeTrue();
  });

  test("starts collapsed once reasoning is completed and toggles the body open", () => {
    const { container, getByRole } = render(
      <ReasoningSurface
        item={{
          markdownText: "**Investigating**\n\nChecking the failing story state.",
          status: "completed",
        }}
      />,
    );

    const toggle = getByRole("button", { name: /Thought/i });
    const body = container.querySelector("[data-thread-find-skip]");
    expect(Boolean(textContent(container).includes("Thought"))).toBeTrue();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(body?.getAttribute("data-thread-find-skip")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(Boolean(textContent(container).includes("Checking the failing story state."))).toBeTrue();
  });

  test("keeps reasoning body markdown on the shared Streamdown class contract", async () => {
    const { container, getByRole } = render(
      <ReasoningSurface
        item={{
          markdownText: "Intro paragraph.\n\n## Details\n\nParagraph body.\n\n- First bullet",
          status: "completed",
        }}
      />,
    );

    fireEvent.click(getByRole("button", { name: /Thought/i }));
    await settleAsyncRender();

    const heading = container.querySelector("h2");
    const paragraph = container.querySelector("p");
    const listItem = container.querySelector("li");

    expect(Boolean(heading?.className.includes("heading-base"))).toBeTrue();
    expect(Boolean(paragraph?.className.includes("text-size-chat"))).toBeTrue();
    expect(Boolean(listItem?.className.includes("mb-1.5"))).toBeTrue();
  });
});
