import { describe, expect, test } from "bun:test";
import { act, fireEvent } from "@testing-library/react";
import type { CodexMcpServerElicitationRequest } from "@/lib/types";
import { render, settleAsyncRender, textContent } from "@/test/dom";
import { CodexMcpElicitationRequestCard } from "./codex-mcp-elicitation-request-card";

const mcpRequest: CodexMcpServerElicitationRequest = {
  type: "mcpServerElicitation",
  requestId: "mcp_1",
  projectId: "project_1",
  threadId: "thread_1",
  turnId: "turn_1",
  itemId: "item_1",
  kind: "generic",
  serverName: "Context7",
  mode: "openai/form",
  message: "Context7 wants to collect extra arguments.",
  requestedSchema: {
    library: { type: "string" },
  },
  createdAt: 1,
};

describe("CodexMcpElicitationRequestCard", () => {
  test("uses compact request-card chrome and maps cancel/approve actions", async () => {
    const responses: string[] = [];
    const { container, getByText } = render(
      <CodexMcpElicitationRequestCard
        request={mcpRequest}
        onRespond={async (_requestId, action) => {
          responses.push(action);
        }}
      />,
    );
    await settleAsyncRender();

    expect(Boolean(textContent(container).includes("Context7"))).toBeTrue();
    expect(container.querySelector(".rounded-2xl.border.backdrop-blur-sm")).not.toBeNull();

    await act(async () => {
      fireEvent.click(getByText("Cancel"));
      await settleAsyncRender();
    });
    await act(async () => {
      fireEvent.click(getByText("Approve"));
      await settleAsyncRender();
    });

    expect(responses[0]).toBe("decline");
    expect(responses[1]).toBe("accept");
  });
});
