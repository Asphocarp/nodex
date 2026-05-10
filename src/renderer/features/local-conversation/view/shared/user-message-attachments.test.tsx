import { describe, expect, test } from "bun:test";
import { render, settleAsyncRender, textContent } from "../../../../test/dom";
import { installWindowApi } from "../../../../test/browser-globals";
import { UserAttachmentStrip } from "./user-message-attachments";

describe("UserAttachmentStrip", () => {
  test("renders remote thumbnails with contain fit", async () => {
    const view = render(
      <UserAttachmentStrip
        attachments={[
          {
            type: "image",
            id: "remote-image",
            source: "data:image/png;base64,aW1hZ2U=",
            sourceKind: "remote",
          },
        ]}
      />,
    );

    const image = view.container.querySelector("img");
    expect(image?.className.includes("object-contain") ?? false).toBeTrue();
    expect(view.container.querySelector("[data-user-attachment-strip]")?.className.includes("self-end") ?? false).toBeTrue();
  });

  test("hides failed remote thumbnails after the loading state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
    try {
      const view = render(
        <UserAttachmentStrip
          attachments={[
            {
              type: "image",
              id: "remote-image",
              source: "file-service://missing",
              sourceKind: "remote",
            },
          ]}
        />,
      );

      expect(textContent(view.container).includes("...")).toBeTrue();
      await settleAsyncRender();
      expect(Boolean(view.container.querySelector('[aria-label="Open image preview"]'))).toBeFalse();
      expect(textContent(view.container).includes("...")).toBeFalse();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not read arbitrary absolute local paths for previews", async () => {
    let invokeCount = 0;
    installWindowApi({
      invoke: async () => {
        invokeCount += 1;
        return {
          base64: "aW1hZ2U=",
          mimeType: "image/png",
        };
      },
      on: () => () => {},
    });

    const view = render(
      <UserAttachmentStrip
        attachments={[
          {
            type: "image",
            id: "local-image",
            source: "/Users/example/secret.png",
            sourceKind: "local",
          },
        ]}
      />,
    );

    await settleAsyncRender();

    expect(invokeCount).toBe(0);
    expect(Boolean(view.container.querySelector('[aria-label="Image unavailable"]'))).toBeTrue();
    expect(Boolean(view.container.querySelector('[aria-label="Open image preview"]'))).toBeFalse();
  });
});
