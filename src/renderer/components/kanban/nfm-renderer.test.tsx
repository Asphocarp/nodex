import { describe, expect, test } from "bun:test";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import {
  render,
  settleAsyncRender,
  textContent,
  waitForStreamdownCodeHighlight,
} from "../../test/dom";
import { NfmRenderer } from "./nfm-renderer";

describe("NfmRenderer", () => {
  test("renders inline code with the shared inline-markdown span contract", async () => {
    const { container } = render(
      <NfmRenderer content={"Paragraph with `inline code` and **bold** text."} />,
    );

    await settleAsyncRender();

    const inlineCode = container.querySelector("span.inline-markdown");
    expect(Boolean(inlineCode)).toBeTrue();
    expect(container.querySelector(".nfm-render code") === null).toBeTrue();
    expect(
      Boolean(
        inlineCode?.className.includes("text-size-chat-sm")
        && inlineCode.className.includes("font-mono")
        && inlineCode.className.includes("blend")
        && inlineCode.className.includes("bg-token-text-code-block-background"),
      ),
    ).toBeTrue();
  });

  test("marks heading inline code with the heading-inline-code scope", async () => {
    const { container } = render(
      <NfmRenderer content={"## Heading with `inline code`"} />,
    );

    await settleAsyncRender();

    const heading = container.querySelector("h2");
    const inlineCode = heading?.querySelector("span.inline-markdown");
    expect(Boolean(heading?.className.includes("heading-inline-code"))).toBeTrue();
    expect(Boolean(inlineCode)).toBeTrue();
  });

  test("renders code blocks through Streamdown's code block renderer", async () => {
    const { container } = render(
      <NfmRenderer content={"```ts\nconst answer = 42\n```"} />,
    );
    await waitForStreamdownCodeHighlight(container);

    expect(container.querySelector('[data-streamdown="code-block"]')).not.toBeNull();
    expect(container.querySelector('[data-language="ts"]')).not.toBeNull();
    expect(container.querySelector('pre[style*="--shiki-dark-bg"]')).not.toBeNull();
    expect(textContent(container).includes("const")).toBeTrue();
  });

  test("falls back to plain code rendering for unknown languages without custom shiki HTML", async () => {
    const { container } = render(
      <NfmRenderer content={"```madeuplang\nhello()\n```"} />,
    );
    await settleAsyncRender();

    expect(container.querySelector('[data-streamdown="code-block"]')).not.toBeNull();
    expect(container.querySelector('pre[style*="--shiki-dark-bg"]') === null).toBeTrue();
    expect(textContent(container).includes("hello()")).toBeTrue();
  });

  test("fails closed for unresolved relative file-like links without a project workspace", async () => {
    const { container } = render(
      <NodexTooltipProvider>
        <NfmRenderer content={"[spec](folder/abc/file)"} />
      </NodexTooltipProvider>,
    );

    await settleAsyncRender();

    const link = container.querySelector("a[href='folder/abc/file']");
    expect(Boolean(link)).toBeTrue();
    expect(link?.getAttribute("aria-disabled")).toBe("true");
    expect(link?.getAttribute("title")).toBe("Cannot resolve relative file link without project workspace.");
  });

  test("passes project workspace context to relative file-like links", async () => {
    const { container } = render(
      <NfmRenderer
        content={"[spec](folder/abc/file)"}
        projectWorkspacePath="/workspace/project"
      />,
    );

    await settleAsyncRender();

    const link = container.querySelector("a[href='folder/abc/file']");
    expect(Boolean(link)).toBeTrue();
    expect(link?.getAttribute("aria-disabled") === null).toBeTrue();
    expect(link?.getAttribute("title") === null).toBeTrue();
  });

  test("renders consecutive numbered list items in one ordered list with preserved numbering", async () => {
    const { container } = render(
      <NfmRenderer content={"1. first\n2. second\n3. third"} />,
    );

    await settleAsyncRender();

    const orderedLists = Array.from(container.querySelectorAll("ol"));
    const listItems = Array.from(container.querySelectorAll("li"));

    expect(orderedLists.length).toBe(1);
    expect(orderedLists[0]?.getAttribute("start")).toBe("1");
    expect(listItems.length).toBe(3);
  });

  test("groups numbered lists by digit width and preserves ol start markers", async () => {
    const { container } = render(
      <NfmRenderer content={"99. Ninety-nine\n100. One hundred\n101. One hundred one"} />,
    );

    await settleAsyncRender();

    const orderedLists = Array.from(container.querySelectorAll("ol"));

    expect(orderedLists.length).toBe(2);
    expect(orderedLists[0]?.getAttribute("start")).toBe("99");
    expect(orderedLists[1]?.getAttribute("start")).toBe("100");
    expect(Boolean(orderedLists[0]?.className.includes("pl-8"))).toBeTrue();
    expect(Boolean(orderedLists[1]?.className.includes("pl-10"))).toBeTrue();
  });
});
