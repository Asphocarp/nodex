import { describe, expect, test } from "bun:test";
import { render, settleAsyncRender } from "../../../../../test/dom";
import { MarkdownRenderer } from "./markdown-renderer";

describe("MarkdownRenderer", () => {
  test("renders inline code with the shared inline-markdown span contract", async () => {
    const { container } = render(
      <MarkdownRenderer content={"Run `bun test` before shipping."} />,
    );

    await settleAsyncRender();

    const inlineCode = container.querySelector("span.inline-markdown");
    expect(Boolean(inlineCode)).toBeTrue();
    expect(container.querySelector(".codex-markdown code") === null).toBeTrue();
    expect(
      Boolean(
        inlineCode?.className.includes("text-size-chat-sm")
        && inlineCode.className.includes("font-mono")
        && inlineCode.className.includes("blend")
        && inlineCode.className.includes("bg-token-text-code-block-background")
        && inlineCode.className.includes("rounded-sm")
        && inlineCode.className.includes("px-1.5")
        && inlineCode.className.includes("py-0.5")
        && inlineCode.className.includes("leading-none"),
      ),
    ).toBeTrue();
  });

  test("marks heading inline code with the heading-inline-code scope", async () => {
    const { container } = render(
      <MarkdownRenderer content={"## Heading with `inline code`"} />,
    );

    await settleAsyncRender();

    const heading = container.querySelector("h2");
    const inlineCode = heading?.querySelector("span.inline-markdown");
    expect(Boolean(heading?.className.includes("heading-inline-code"))).toBeTrue();
    expect(Boolean(inlineCode)).toBeTrue();
  });

  test("keeps fenced code blocks on the code-block renderer path", async () => {
    const { container } = render(
      <MarkdownRenderer content={"```ts\nconst answer = 42\n```"} />,
    );

    await settleAsyncRender();

    expect(container.querySelector('[data-streamdown="code-block"]') !== null).toBeTrue();
    expect(container.querySelector('[data-streamdown="code-block"] code') !== null).toBeTrue();
    expect(container.querySelector('[data-streamdown="code-block"] .inline-markdown') === null).toBeTrue();
  });

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
