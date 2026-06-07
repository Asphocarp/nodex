import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { render } from "../../../test/dom";

describe("LocalConversationStageScreen", () => {
  test("renders the stage header, body, and footer from the local-conversation shell", async () => {
    const { LocalConversationStageScreen } = await import("./local-conversation-stage-screen");
    const { container } = render(
      <LocalConversationStageScreen
        header={createElement("div", { "data-local-conversation-header": "true" })}
        body={createElement("div", { "data-local-conversation-thread-body": "true" })}
        footer={createElement("div", { "data-local-conversation-footer": "true" })}
        floatingContent={createElement("div", { "data-local-conversation-floating": "true" })}
      />,
    );
    const hasAbsoluteFooterOverlay = Array.from(container.querySelectorAll("div")).some(
      (element) =>
        typeof element.className === "string" &&
        element.className.includes("absolute inset-x-0 bottom-0 z-20"),
    );

    expect(Boolean(container.querySelector("[data-local-conversation-header='true']"))).toBeTrue();
    expect(Boolean(container.querySelector("[data-local-conversation-floating='true']"))).toBeTrue();
    expect(Boolean(container.querySelector("[data-local-conversation-thread-body='true']"))).toBeTrue();
    expect(Boolean(container.querySelector("[data-local-conversation-footer='true']"))).toBeTrue();
    expect(Boolean(container.querySelector(".sticky.top-0.z-10"))).toBeTrue();
    expect(Boolean(container.querySelector(".min-h-0.flex-1"))).toBeTrue();
    expect(Boolean(container.querySelector(".z-10.w-full.pb-2"))).toBeTrue();
    expect(hasAbsoluteFooterOverlay).toBeFalse();
  });
});
