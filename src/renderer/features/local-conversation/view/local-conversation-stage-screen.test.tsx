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

    expect(Boolean(container.querySelector("[data-local-conversation-header='true']"))).toBeTrue();
    expect(Boolean(container.querySelector("[data-local-conversation-floating='true']"))).toBeTrue();
    expect(Boolean(container.querySelector("[data-local-conversation-thread-body='true']"))).toBeTrue();
    expect(Boolean(container.querySelector("[data-local-conversation-footer='true']"))).toBeTrue();
  });

  test("keeps an empty sticky header slot when embedded without a header", async () => {
    const { LocalConversationStageScreen } = await import("./local-conversation-stage-screen");
    const { container } = render(
      <LocalConversationStageScreen
        header={null}
        body={createElement("div", { "data-local-conversation-thread-body": "true" })}
        footer={createElement("div", { "data-local-conversation-footer": "true" })}
      />,
    );

    expect(Boolean(container.querySelector("[data-local-conversation-thread-body='true']"))).toBeTrue();
    expect(Boolean(container.querySelector("[data-local-conversation-footer='true']"))).toBeTrue();
  });
});
