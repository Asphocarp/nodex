import { describe, expect, test } from "bun:test";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { render, settleAsyncRender, waitForStreamdownCodeHighlight } from "../../../../../test/dom";
import { MarkdownRenderer } from "./markdown-renderer";

describe("MarkdownRenderer", () => {
  test("renders inline code with the shared inline-markdown span contract", async () => {
    const { container } = render(
      <MarkdownRenderer content={"Run `bun test` before shipping."} />,
    );

    await settleAsyncRender();

    const inlineCode = container.querySelector("span.inline-markdown");
    expect(Boolean(inlineCode)).toBeTrue();
    expect(inlineCode?.textContent).toBe("bun test");
    expect(container.querySelector(".codex-markdown code") === null).toBeTrue();
  });

  test("marks heading inline code with the heading-inline-code scope", async () => {
    const { container } = render(
      <MarkdownRenderer content={"## Heading with `inline code`"} />,
    );

    await settleAsyncRender();

    const heading = container.querySelector("h2");
    const inlineCode = heading?.querySelector("span.inline-markdown");
    expect(Boolean(inlineCode)).toBeTrue();
    expect(inlineCode?.textContent).toBe("inline code");
  });

  test("renders paragraph, heading, list, blockquote, table, and details as semantic content", async () => {
    const { container } = render(
      <MarkdownRenderer
        content={[
          "# Heading One",
          "",
          "Paragraph body with a [link](https://example.com).",
          "",
          "- First bullet",
          "- Second bullet",
          "",
          "> Quote block",
          "",
          "| Name | Value |",
          "| --- | --- |",
          "| Foo | Bar |",
          "",
          "<details><summary>More</summary>Body</details>",
        ].join("\n")}
      />,
    );

    await settleAsyncRender();

    const paragraph = container.querySelector("p");
    const heading = container.querySelector("h1");
    const listItem = container.querySelector("li");
    const link = container.querySelector("a");
    const blockquote = container.querySelector("blockquote");
    const table = container.querySelector("table");
    const summary = container.querySelector("summary");
    const tableHeadingCell = container.querySelector("th");
    const tableCell = container.querySelector("td");

    expect(paragraph?.textContent).toBe("Paragraph body with a link.");
    expect(heading?.textContent).toBe("Heading One");
    expect(listItem?.textContent).toBe("First bullet");
    expect(link?.getAttribute("href")).toBe("https://example.com/");
    expect(blockquote?.textContent?.trim()).toBe("Quote block");
    expect(Boolean(table)).toBeTrue();
    expect(summary?.textContent).toBe("More");
    expect(tableHeadingCell?.textContent).toBe("Name");
    expect(tableCell?.textContent).toBe("Foo");
  });

  test("groups ordered lists by digit width like Codex Electron", async () => {
    const { container } = render(
      <MarkdownRenderer
        content={[
          "99. Ninety-nine",
          "100. One hundred",
          "101. One hundred one",
        ].join("\n")}
      />,
    );

    await settleAsyncRender();

    const orderedLists = Array.from(container.querySelectorAll("ol"));
    expect(orderedLists.length).toBe(2);
    expect(orderedLists[0]?.getAttribute("start")).toBe("99");
    expect(orderedLists[1]?.getAttribute("start")).toBe("100");
  });

  test("renders local file links as anchors", async () => {
    const { container } = render(
      <NodexTooltipProvider>
        <MarkdownRenderer content={"- [/tmp/example.ts#L12](/tmp/example.ts#L12)"} />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();

    const link = container.querySelector('a[href="/tmp/example.ts#L12"]');
    expect(Boolean(link)).toBeTrue();
    expect(link?.textContent).toBe("/tmp/example.ts#L12");
  });

  test("keeps fenced code blocks on the code-block renderer path", async () => {
    const { container } = render(
      <MarkdownRenderer content={"```ts\nconst answer = 42\n```"} />,
    );

    await waitForStreamdownCodeHighlight(container);

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
