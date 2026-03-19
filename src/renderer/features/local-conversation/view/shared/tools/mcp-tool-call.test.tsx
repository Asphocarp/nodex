import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { TooltipProvider } from "../../../../../components/ui/tooltip";
import { render, settleAsyncRender, textContent } from "../../../../../test/dom";
import { McpToolCall } from "./mcp-tool-call";

function buildMcpEntry(overrides?: Partial<CodexTranscriptEntry>): CodexTranscriptEntry {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "tool-1",
    entryId: "tool-1",
    type: "mcp_tool_call",
    kind: "toolCall",
    semanticKind: "mcpToolCall",
    status: "completed",
    toolCall: {
      subtype: "mcp",
      server: "context7",
      toolName: "resolve-library-id",
      args: {
        libraryName: "storybook",
      },
      result: {
        type: "success",
        content: [
          {
            type: "text",
            text: "Available Libraries:\n\n- Title: Storybook",
          },
        ],
        structuredContent: null,
      },
    },
    rawItem: {
      callId: "call_9L9LUlz6nkg1Jp2LA4mrAL8o",
      invocation: {
        server: "context7",
        tool: "resolve-library-id",
        arguments: {
          libraryName: "storybook",
          query: "storybook docs",
        },
      },
      durationMs: 2957,
      result: {
        type: "success",
        content: [
          {
            type: "text",
            text: "Available Libraries:\n\n- Title: Storybook",
          },
        ],
        structuredContent: null,
      },
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("McpToolCall", () => {
  test("renders the Codex-style collapsed summary text", () => {
    const { getByRole } = render(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry({
            toolCall: {
              subtype: "mcp",
              server: "context7",
              toolName: "query_docs",
            },
            rawItem: {
              callId: "call_query_docs",
              invocation: {
                server: "context7",
                tool: "query_docs",
                arguments: {
                  libraryId: "/storybookjs/storybook",
                },
              },
              durationMs: 1284,
              result: {
                type: "success",
                content: [],
                structuredContent: {
                  snippetCount: 3,
                },
              },
            },
          })}
        />
      </TooltipProvider>,
    );

    const summary = textContent(getByRole("button", { name: /Query Docs tool from Context 7 MCP/i }));
    expect(summary.includes("Called")).toBeTrue();
    expect(summary.includes("Query Docs tool from Context 7 MCP")).toBeTrue();
  });

  test("renders plaintext content and opens the raw output dialog", async () => {
    const { container, getByRole, getByText } = render(
      <TooltipProvider>
        <McpToolCall item={buildMcpEntry()} expanded />
      </TooltipProvider>,
    );

    expect(Boolean(textContent(container).includes("Available Libraries:"))).toBeTrue();
    expect(Boolean(getByText("plaintext"))).toBeTrue();

    fireEvent.click(getByRole("button", { name: "Show raw tool call output" }));
    await settleAsyncRender();

    expect(Boolean(getByText("Raw context7.resolve-library-id tool call output"))).toBeTrue();
    expect(Boolean(getByText(/call_9L9LUlz6nkg1Jp2LA4mrAL8o/))).toBeTrue();
  });
});
