import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import type { CodexMcpToolCallView, CodexTranscriptEntry } from "../../../../../lib/types";
import { NodexTooltipProvider as TooltipProvider } from "../../../../../components/ui/tooltip";
import { render, settleAsyncRender, textContent } from "../../../../../test/dom";
import { McpToolCall } from "./mcp-tool-call";

function buildMcpView(overrides?: Partial<CodexMcpToolCallView>): CodexMcpToolCallView {
  return {
    callId: "call_9L9LUlz6nkg1Jp2LA4mrAL8o",
    functionName: "context7__resolve-library-id",
    invocation: {
      server: "context7",
      tool: "resolve-library-id",
      arguments: {
        libraryName: "storybook",
        query: "storybook docs",
      },
    },
    durationMs: 2957,
    completed: true,
    result: {
      type: "success",
      content: [
        {
          type: "text",
          text: "Available Libraries:\n\n- Title: Storybook",
        },
      ],
      structuredContent: null,
      raw: {
        content: [
          {
            type: "text",
            text: "Available Libraries:\n\n- Title: Storybook",
          },
        ],
        structuredContent: null,
      },
    },
    ...overrides,
  };
}

function buildMcpEntry(overrides?: Partial<CodexTranscriptEntry>): CodexTranscriptEntry {
  const mcpToolCall = buildMcpView(overrides?.mcpToolCall);

  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "tool-1",
    entryId: "tool-1",
    type: "mcp_tool_call",
    kind: "toolCall",
    semanticKind: "mcpToolCall",
    status: mcpToolCall.completed ? "completed" : "inProgress",
    toolCall: {
      subtype: "mcp",
      server: mcpToolCall.invocation.server,
      toolName: mcpToolCall.invocation.tool,
      args: mcpToolCall.invocation.arguments,
      result: mcpToolCall.result,
      error: mcpToolCall.result?.type === "error" ? mcpToolCall.result.error : undefined,
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
    mcpToolCall: overrides?.mcpToolCall ?? mcpToolCall,
  };
}

describe("McpToolCall", () => {
  test("renders the Codex-style collapsed summary text", () => {
    const { getByRole } = render(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry({
            mcpToolCall: buildMcpView({
              functionName: "context7__query_docs",
              invocation: {
                server: "context7",
                tool: "query_docs",
                arguments: {
                  libraryId: "/storybookjs/storybook",
                },
              },
              result: {
                type: "success",
                content: [],
                structuredContent: {
                  snippetCount: 3,
                },
                raw: {
                  content: [],
                  structuredContent: {
                    snippetCount: 3,
                  },
                },
              },
            }),
          })}
        />
      </TooltipProvider>,
    );

    const summary = textContent(getByRole("button", { name: /Query Docs tool from Context 7/i }));
    expect(summary.includes("Called")).toBeTrue();
    expect(summary.includes("Query Docs tool from Context 7")).toBeTrue();
  });

  test("renders a source icon in the summary row", () => {
    const { container } = render(
      <TooltipProvider>
        <McpToolCall item={buildMcpEntry()} />
      </TooltipProvider>,
    );

    expect(Boolean(container.querySelector("[data-tool-activity-icon='connector']"))).toBeTrue();
  });

  test("keeps in-progress MCP rows collapsed and non-expandable", async () => {
    const { getByRole } = render(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry({
            status: "inProgress",
            mcpToolCall: buildMcpView({
              completed: false,
            }),
          })}
        />
      </TooltipProvider>,
    );

    const summaryButton = getByRole("button", { name: /Calling Resolve Library Id tool from Context 7/i });
    fireEvent.click(summaryButton);
    await settleAsyncRender();

    expect(summaryButton.getAttribute("aria-expanded") ?? "").toBe("false");
    expect(Boolean(textContent(summaryButton).includes("Calling"))).toBeTrue();
    expect(Boolean(summaryButton.querySelector(".loading-shimmer-pure-text"))).toBeTrue();
    expect(Boolean(summaryButton.querySelector(".loading-shimmer-pure-text [data-tool-activity-icon]"))).toBeFalse();
  });

  test("renders plaintext content and opens the raw output dialog", async () => {
    const { container, getByRole, getByText } = render(
      <TooltipProvider>
        <McpToolCall item={buildMcpEntry()} />
      </TooltipProvider>,
    );

    fireEvent.click(getByRole("button", { name: /Called Resolve Library Id tool from Context 7/i }));
    await settleAsyncRender();

    expect(Boolean(textContent(container).includes("Available Libraries:"))).toBeTrue();
    expect(Boolean(getByText("plaintext"))).toBeTrue();

    fireEvent.click(getByRole("button", { name: "Show raw tool call output" }));
    await settleAsyncRender();

    expect(Boolean(getByText("Raw context7.resolve-library-id tool call output"))).toBeTrue();
    expect(Boolean(getByText(/call_9L9LUlz6nkg1Jp2LA4mrAL8o/))).toBeTrue();
  });

  test("shows no-content copy before structuredContent for structured-only successes", async () => {
    const { container, getByRole } = render(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry({
            mcpToolCall: buildMcpView({
              functionName: "context7__query_docs",
              invocation: {
                server: "context7",
                tool: "query_docs",
                arguments: {
                  libraryId: "/storybookjs/storybook",
                },
              },
              result: {
                type: "success",
                content: [],
                structuredContent: {
                  snippetCount: 3,
                },
                raw: {
                  content: [],
                  structuredContent: {
                    snippetCount: 3,
                  },
                },
              },
            }),
          })}
        />
      </TooltipProvider>,
    );

    fireEvent.click(getByRole("button", { name: /Called Query Docs tool from Context 7/i }));
    await settleAsyncRender();

    expect(Boolean(textContent(container).includes("Tool returned no content"))).toBeTrue();
    expect(Boolean(textContent(container).includes("\"snippetCount\": 3"))).toBeTrue();
  });

  test("renders protocol errors without the no-content fallback", async () => {
    const { container, getByRole } = render(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry({
            status: "failed",
            mcpToolCall: buildMcpView({
              completed: true,
              result: {
                type: "error",
                kind: "protocol",
                error: "Authentication required",
                rawError: {
                  message: "Authentication required",
                },
              },
            }),
          })}
        />
      </TooltipProvider>,
    );

    fireEvent.click(getByRole("button", { name: /Called Resolve Library Id tool from Context 7/i }));
    await settleAsyncRender();

    expect(Boolean(textContent(container).includes("Authentication required"))).toBeTrue();
    expect(Boolean(textContent(container).includes("Tool returned no content"))).toBeFalse();
  });

  test("renders unknown blocks as JSON fallback instead of dropping them", async () => {
    const { container, getByRole } = render(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry({
            mcpToolCall: buildMcpView({
              result: {
                type: "success",
                content: [
                  {
                    type: "unknown",
                    raw: {
                      type: "not_real",
                      foo: "bar",
                    },
                  },
                ],
                structuredContent: null,
                raw: {
                  content: [
                    {
                      type: "not_real",
                      foo: "bar",
                    },
                  ],
                  structuredContent: null,
                },
              },
            }),
          })}
        />
      </TooltipProvider>,
    );

    fireEvent.click(getByRole("button", { name: /Called Resolve Library Id tool from Context 7/i }));
    await settleAsyncRender();

    expect(Boolean(textContent(container).includes("\"foo\": \"bar\""))).toBeTrue();
    expect(Boolean(textContent(container).includes("Tool returned no content"))).toBeFalse();
  });

  test("renders resource-link content blocks", async () => {
    const { container, getByRole } = render(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry({
            mcpToolCall: buildMcpView({
              result: {
                type: "success",
                content: [
                  {
                    type: "resource_link",
                    uri: "file:///workspace/docs.md",
                    title: "Docs",
                    annotations: {
                      audience: "agent",
                    },
                  },
                ],
                structuredContent: null,
                raw: {
                  content: [],
                  structuredContent: null,
                },
              },
            }),
          })}
        />
      </TooltipProvider>,
    );

    fireEvent.click(getByRole("button", { name: /Called Resolve Library Id tool from Context 7/i }));
    await settleAsyncRender();

    expect(Boolean(textContent(container).includes("Read Docs"))).toBeTrue();
    expect(Boolean(textContent(container).includes("audience=agent"))).toBeTrue();
  });
});
