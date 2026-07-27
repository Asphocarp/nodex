import { describe, expect, test } from "vitest";
import { render, settleAsyncRender, textContent } from "../../../../test/dom";
import { installWindowApi } from "../../../../test/browser-globals";
import { TestQueryProvider } from "../../../../test/query";
import { UserAttachmentStrip } from "./user-message-attachments";

describe("UserAttachmentStrip", () => {
  test("renders remote thumbnails with preview action", async () => {
    const view = render(
      <TestQueryProvider>
        <UserAttachmentStrip
          attachments={[
            {
              type: "image",
              id: "remote-image",
              source: "data:image/png;base64,aW1hZ2U=",
              sourceKind: "remote",
            },
          ]}
        />
      </TestQueryProvider>,
    );

    const image = view.container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("data:image/png;base64,aW1hZ2U=");
    expect(Boolean(view.container.querySelector('[aria-label="Open image preview"]'))).toBe(true);
  });

  test("hides failed remote thumbnails after the loading state", async () => {
    installWindowApi({
      invoke: async () => ({
        ok: false,
        status: 404,
        message: "Image not found",
      }),
      on: () => () => {},
    });
    const view = render(
      <TestQueryProvider>
        <UserAttachmentStrip
          attachments={[
            {
              type: "image",
              id: "remote-image",
              source: "file-service://missing",
              sourceKind: "remote",
            },
          ]}
        />
      </TestQueryProvider>,
    );

    expect(textContent(view.container).includes("...")).toBe(true);
    await settleAsyncRender();
    expect(Boolean(view.container.querySelector('[aria-label="Open image preview"]'))).toBe(false);
    expect(textContent(view.container).includes("...")).toBe(false);
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
      <TestQueryProvider>
        <UserAttachmentStrip
          attachments={[
            {
              type: "image",
              id: "local-image",
              source: "/Users/example/secret.png",
              sourceKind: "local",
            },
          ]}
        />
      </TestQueryProvider>,
    );

    await settleAsyncRender();

    expect(invokeCount).toBe(0);
    expect(Boolean(view.container.querySelector('[aria-label="Image unavailable"]'))).toBe(true);
    expect(Boolean(view.container.querySelector('[aria-label="Open image preview"]'))).toBe(false);
  });
});
