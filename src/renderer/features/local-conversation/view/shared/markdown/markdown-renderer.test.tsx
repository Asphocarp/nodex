import { describe, expect, test } from "bun:test";
import { render, settleAsyncRender } from "../../../../../test/dom";
import { MarkdownRenderer } from "./markdown-renderer";

describe("MarkdownRenderer", () => {
  test("adds Streamdown word-fade markers for streaming assistant prose", async () => {
    const { container } = render(
      <MarkdownRenderer
        content="Investigating the Storybook regression while comparing the streaming transcript against Codex Electron behavior."
        parseIncompleteMarkdown
        animateStreamingText
      />,
    );

    await settleAsyncRender();

    expect(container.querySelectorAll("[data-sd-animate]").length > 0).toBeTrue();
  });

  test("keeps completed prose static even when animation support is enabled", async () => {
    const { container } = render(
      <MarkdownRenderer
        content="Completed assistant prose should render statically once the turn finishes."
        animateStreamingText
      />,
    );

    await settleAsyncRender();

    expect(container.querySelector("[data-sd-animate]") === null).toBeTrue();
  });
});
