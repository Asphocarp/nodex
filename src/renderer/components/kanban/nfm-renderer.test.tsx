import { describe, expect, test } from "bun:test";
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
});
