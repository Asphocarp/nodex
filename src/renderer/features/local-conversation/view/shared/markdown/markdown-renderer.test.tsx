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

  test("renders paragraph, heading, list, blockquote, table, and details with Codex-style element classes", async () => {
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
    const list = container.querySelector("ul");
    const listItem = container.querySelector("li");
    const link = container.querySelector("a");
    const blockquote = container.querySelector("blockquote");
    const table = container.querySelector("table");
    const summary = container.querySelector("summary");
    const tableHead = container.querySelector("thead");
    const tableRow = container.querySelector("tr");
    const tableHeadingCell = container.querySelector("th");
    const tableCell = container.querySelector("td");

    expect(Boolean(paragraph?.className.includes("text-size-chat"))).toBeTrue();
    expect(Boolean(paragraph?.className.includes("leading-relaxed"))).toBeTrue();
    expect(Boolean(paragraph?.className.includes("my-2"))).toBeTrue();
    expect(Boolean(heading?.className.includes("heading-lg"))).toBeTrue();
    expect(Boolean(list?.className.includes("list-disc"))).toBeTrue();
    expect(Boolean(list?.className.includes("pl-4"))).toBeTrue();
    expect(Boolean(listItem?.className.includes("mb-1.5"))).toBeTrue();
    expect(Boolean(link?.className.includes("text-token-text-link-foreground"))).toBeTrue();
    expect(Boolean(blockquote?.className.includes("border-l-2"))).toBeTrue();
    expect(Boolean(table?.className.includes("border-collapse"))).toBeTrue();
    expect(Boolean(summary?.className.includes("cursor-pointer"))).toBeTrue();
    expect(Boolean(tableHead?.className.includes("bg-token-foreground/5"))).toBeTrue();
    expect(Boolean(tableRow?.className.includes("border-b"))).toBeTrue();
    expect(Boolean(tableHeadingCell?.className.includes("font-semibold"))).toBeTrue();
    expect(Boolean(tableCell?.className.includes("p-1"))).toBeTrue();
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
    expect(Boolean(orderedLists[0]?.className.includes("pl-8"))).toBeTrue();
    expect(Boolean(orderedLists[1]?.className.includes("pl-10"))).toBeTrue();
  });

  test("renders local file links with the Codex-style hover-only contract", async () => {
    const { container } = render(
      <NodexTooltipProvider>
        <MarkdownRenderer content={"- [/tmp/example.ts#L12](/tmp/example.ts#L12)"} />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();

    const link = container.querySelector('a[href="/tmp/example.ts#L12"]');
    expect(Boolean(link)).toBeTrue();
    expect(Boolean(link?.className.includes("hover:underline"))).toBeTrue();
    expect(Boolean(link?.className.includes("appearance-none"))).toBeTrue();
    expect(Boolean(link?.className.includes("underline decoration-current"))).toBeFalse();
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
