import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import type { CodexMcpToolCallView, CodexTranscriptEntry, ProtocolMcpResourceReadResponse } from "../../../../../lib/types";
import { NodexTooltipProvider as TooltipProvider } from "../../../../../components/ui/tooltip";
import { installWindowApi } from "../../../../../test/browser-globals";
import { render, settleAsyncRender, textContent } from "../../../../../test/dom";
import { createTestQueryClient, TestQueryProvider } from "../../../../../test/query";
import { queryKeys } from "../../../../../lib/query-keys";
import { buildMcpAppSidePanelInput, McpToolCall } from "./mcp-tool-call";

function renderMcp(ui: ReactElement, client = createTestQueryClient()) {
  return render(<TestQueryProvider client={client}>{ui}</TestQueryProvider>);
}

function hasExactText(container: HTMLElement, value: string): boolean {
  return Array.from(container.querySelectorAll<HTMLElement>("*"))
    .some((element) => textContent(element) === value);
}

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

function buildAutomaticApprovalReviewEntry(overrides?: Partial<CodexTranscriptEntry>): CodexTranscriptEntry {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "review-1",
    entryId: "review-1",
    type: "automaticApprovalReview",
    kind: "systemEvent",
    semanticKind: "automaticApprovalReview",
    status: "completed",
    createdAt: 1,
    updatedAt: 1,
    rawItem: {
      targetItemId: "tool-1",
      review: {
        status: "approved",
        riskScore: 0.12,
        riskLevel: "low",
        rationale: "Only documentation lookup is performed.",
      },
      action: {
        type: "mcpToolCall",
        server: "context7",
        toolName: "resolve-library-id",
        connectorId: null,
        connectorName: "Context 7",
        toolTitle: null,
      },
    },
    ...overrides,
  };
}

describe("McpToolCall", () => {
  beforeEach(() => {
    installWindowApi({
      invoke: async (channel: string) => {
        if (channel === "codex:mcp-server-statuses:list") return [];
        if (channel === "codex:mcp-resource:read") return { contents: [] };
        throw new Error(`Unexpected channel: ${channel}`);
      },
      on: () => () => {},
    });
  });

  test("renders the Codex-style collapsed summary text", async () => {
    const { container, getByRole } = renderMcp(
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
    await settleAsyncRender();

    const summary = textContent(getByRole("button", { name: /Query docs/i }));
    expect(summary).toBe("Query docs");
    expect(textContent(container).includes("Called")).toBeFalse();
    expect(textContent(container).includes("tool from Context 7")).toBeFalse();
  });

  test("does not mount completed MCP body content while collapsed", async () => {
    const { container, getByRole } = renderMcp(
      <TooltipProvider>
        <McpToolCall item={buildMcpEntry()} />
      </TooltipProvider>,
    );
    await settleAsyncRender();

    expect(textContent(container).includes("Available Libraries:")).toBeFalse();

    fireEvent.click(getByRole("button", { name: /Resolve library id/i }));
    await settleAsyncRender();

    expect(textContent(container).includes("Available Libraries:")).toBeTrue();
  });


  test("renders a source icon in the summary row", async () => {
    const { container } = renderMcp(
      <TooltipProvider>
        <McpToolCall item={buildMcpEntry()} />
      </TooltipProvider>,
    );
    await settleAsyncRender();

    expect(Boolean(container.querySelector("[data-tool-activity-icon='connector']"))).toBeTrue();
  });

  test("keeps in-progress MCP rows collapsed and non-expandable", async () => {
    const { container, queryByRole } = renderMcp(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry({
            status: "inProgress",
            mcpToolCall: buildMcpView({
              completed: false,
              result: null,
            }),
          })}
        />
      </TooltipProvider>,
    );

    await settleAsyncRender();

    expect(Boolean(queryByRole("button", { name: /Resolve library id/i }))).toBeFalse();
    expect(textContent(container).includes("Resolve library ID")).toBeTrue();
    expect(textContent(container).includes("Calling")).toBeFalse();
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text"))).toBeTrue();
    expect(Boolean(container.querySelector(".loading-shimmer-pure-text [data-tool-activity-icon]"))).toBeFalse();
  });

  test("allows in-progress MCP rows with a result to expand", async () => {
    const { container, getByRole } = renderMcp(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry({
            status: "inProgress",
            mcpToolCall: buildMcpView({
              completed: false,
              result: {
                type: "success",
                content: [
                  {
                    type: "text",
                    text: "Partial tool content",
                  },
                ],
                structuredContent: null,
                raw: {
                  content: [
                    {
                      type: "text",
                      text: "Partial tool content",
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

    const summaryButton = getByRole("button", { name: /Resolve library id/i });
    expect(summaryButton.getAttribute("aria-expanded") ?? "").toBe("false");
    expect(Boolean(summaryButton.querySelector(".loading-shimmer-pure-text"))).toBeTrue();

    fireEvent.click(summaryButton);
    await settleAsyncRender();

    expect(summaryButton.getAttribute("aria-expanded") ?? "").toBe("true");
    expect(textContent(container).includes("Partial tool content")).toBeTrue();
  });

  test("uses the node_repl js title as the standalone MCP label", async () => {
    const { getByRole } = renderMcp(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry({
            mcpToolCall: buildMcpView({
              functionName: "node_repl__js",
              invocation: {
                server: "node_repl",
                tool: "js",
                arguments: {
                  title: "Inspect package metadata",
                  code: "JSON.stringify({ ok: true })",
                },
              },
            }),
          })}
        />
      </TooltipProvider>,
    );
    await settleAsyncRender();

    const summary = textContent(getByRole("button", { name: /Inspect package metadata/i }));
    expect(summary).toBe("Inspect package metadata");
  });

  test("preserves MCP acronyms in generic standalone labels", async () => {
    const { getByRole } = renderMcp(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry({
            mcpToolCall: buildMcpView({
              functionName: "codex_apps__list_mcp_resources",
              invocation: {
                server: "codex_apps",
                tool: "list_mcp_resources",
                arguments: {},
              },
            }),
          })}
        />
      </TooltipProvider>,
    );
    await settleAsyncRender();

    const summary = textContent(getByRole("button", { name: /List MCP resources/i }));
    expect(summary).toBe("List MCP resources");
  });

  test("renders plaintext content and opens the raw output dialog", async () => {
    const { container, getByRole, getByText } = renderMcp(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry({
            mcpToolCall: buildMcpView({
              pluginId: "plugin_1",
              mcpAppResourceUri: "ui://context7/docs",
            }),
          })}
        />
      </TooltipProvider>,
    );

    fireEvent.click(getByRole("button", { name: /Resolve library id/i }));
    await settleAsyncRender();

    expect(Boolean(textContent(container).includes("Available Libraries:"))).toBeTrue();
    expect(Boolean(getByText("plaintext"))).toBeTrue();

    fireEvent.click(getByRole("button", { name: "Show raw tool call output" }));
    await settleAsyncRender();

    expect(Boolean(getByText("Raw context7.resolve-library-id tool call output"))).toBeTrue();
    expect(Boolean(getByText(/call_9L9LUlz6nkg1Jp2LA4mrAL8o/))).toBeTrue();
    expect(textContent(container).includes("pluginId")).toBeFalse();
    expect(textContent(container).includes("mcpAppResourceUri")).toBeFalse();
  });

  test("renders attached automatic approval reviews before MCP body content", async () => {
    const { container, getByRole } = renderMcp(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry()}
          automaticApprovalReviews={[buildAutomaticApprovalReviewEntry()]}
        />
      </TooltipProvider>,
    );

    const summaryButton = getByRole("button", { name: /Resolve library id/i });
    expect(summaryButton.getAttribute("aria-expanded") ?? "").toBe("false");

    fireEvent.click(summaryButton);
    await settleAsyncRender();
    expect(summaryButton.getAttribute("aria-expanded") ?? "").toBe("true");

    const reviewButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((element) => textContent(element).includes("Auto-review approved")) ?? null;
    const plaintextLabel = Array.from(container.querySelectorAll<HTMLElement>("div"))
      .find((element) => textContent(element) === "plaintext") ?? null;

    expect(Boolean(reviewButton)).toBeTrue();
    expect(Boolean(plaintextLabel)).toBeTrue();
    expect(Boolean(
      reviewButton && plaintextLabel
        ? reviewButton.compareDocumentPosition(plaintextLabel) & Node.DOCUMENT_POSITION_FOLLOWING
        : false,
    )).toBeTrue();
  });

  test("renders attached automatic approval reviews as title-only rows in MCP app card mode", async () => {
    const mcpAppResourceResponse: ProtocolMcpResourceReadResponse = {
      contents: [{
        uri: "ui://context7/docs",
        mimeType: "text/html;profile=mcp-app",
        text: "<!doctype html><html><body>Docs app</body></html>",
        _meta: {
          "openai/widgetPrefersBorder": true,
        },
      }],
    };
    installWindowApi({
      invoke: async (channel: string) => {
        if (channel === "codex:mcp-server-statuses:list") return [];
        if (channel === "codex:mcp-resource:read") return mcpAppResourceResponse;
        throw new Error(`Unexpected channel: ${channel}`);
      },
      on: () => () => {},
    });
    const client = createTestQueryClient();
    client.setQueryData(queryKeys.mcp.statuses("thread-1"), []);
    client.setQueryData(queryKeys.mcp.resource({
      threadId: "thread-1",
      server: "context7",
      uri: "ui://context7/docs",
    }), mcpAppResourceResponse);

    const { container, getByRole } = renderMcp(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry({
            mcpToolCall: buildMcpView({
              mcpAppResourceUri: "ui://context7/docs",
              result: {
                type: "success",
                content: [],
                structuredContent: null,
                raw: {
                  content: [],
                  structuredContent: null,
                },
              },
            }),
          })}
          automaticApprovalReviews={[buildAutomaticApprovalReviewEntry()]}
        />
      </TooltipProvider>,
      client,
    );

    fireEvent.click(getByRole("button", { name: /Resolve library id/i }));
    await settleAsyncRender();

    expect(Boolean(container.querySelector("[data-mcp-app-frame-mode='inline']"))).toBeTrue();
    expect(textContent(container).includes("Auto-review approved")).toBeTrue();
    const reviewElement = Array.from(container.querySelectorAll<HTMLElement>("div"))
      .find((element) => textContent(element) === "Auto-review approved") ?? null;
    const reviewButton = reviewElement?.closest("button") ?? null;
    expect(Boolean(reviewElement)).toBeTrue();
    expect(Boolean(reviewButton)).toBeFalse();
    expect(textContent(reviewElement as HTMLElement).includes("Only documentation lookup is performed.")).toBeFalse();
  });

  test("renders structured-only successes without the no-content fallback", async () => {
    const { container, getByRole } = renderMcp(
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

    fireEvent.click(getByRole("button", { name: /Query docs/i }));
    await settleAsyncRender();

    expect(Boolean(textContent(container).includes("Tool returned no content"))).toBeFalse();
    expect(Boolean(textContent(container).includes("\"snippetCount\": 3"))).toBeTrue();
  });

  test("deduplicates JSON text content against structuredContent when expanded", async () => {
    const { container, getByRole } = renderMcp(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry({
            mcpToolCall: buildMcpView({
              result: {
                type: "success",
                content: [
                  {
                    type: "text",
                    text: "{\"snippetCount\":3}",
                  },
                ],
                structuredContent: {
                  snippetCount: 3,
                },
                raw: {
                  content: [
                    {
                      type: "text",
                      text: "{\"snippetCount\":3}",
                    },
                  ],
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

    fireEvent.click(getByRole("button", { name: /Resolve library id/i }));
    await settleAsyncRender();

    expect(hasExactText(container, "plaintext")).toBeFalse();
    expect(Boolean(textContent(container).includes("\"snippetCount\": 3"))).toBeTrue();
  });

  test("renders MCP app resources as the body branch instead of appending fallback content", async () => {
    const client = createTestQueryClient();
    const resourceResponse: ProtocolMcpResourceReadResponse = {
      contents: [{
        uri: "ui://context7/docs-app",
        mimeType: "text/html;profile=mcp-app",
        text: "<main>Docs app</main>",
      }],
    };
    client.setQueryData(queryKeys.mcp.resource({
      threadId: "thread-1",
      server: "context7",
      uri: "ui://context7/docs-app",
    }), resourceResponse);

    const { container, getByRole } = renderMcp(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry({
            mcpToolCall: buildMcpView({
              result: {
                type: "success",
                content: [
                  {
                    type: "text",
                    text: "Fallback text should be hidden",
                  },
                ],
                structuredContent: {
                  hidden: true,
                },
                meta: { "openai/outputTemplate": "ui://context7/docs-app" },
                raw: {
                  content: [],
                  structuredContent: {
                    hidden: true,
                  },
                },
              },
            }),
          })}
        />
      </TooltipProvider>,
      client,
    );

    fireEvent.click(getByRole("button", { name: /Resolve library id/i }));
    await settleAsyncRender();

    expect(Boolean(container.querySelector("iframe"))).toBeTrue();
    expect(hasExactText(container, "plaintext")).toBeFalse();
  });

  test("renders protocol errors without the no-content fallback", async () => {
    const { container, getByRole } = renderMcp(
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

    fireEvent.click(getByRole("button", { name: /Resolve library id/i }));
    await settleAsyncRender();

    expect(Boolean(textContent(container).includes("Authentication required"))).toBeTrue();
    expect(Boolean(textContent(container).includes("Tool returned no content"))).toBeFalse();
  });

  test("renders unknown blocks as JSON fallback instead of dropping them", async () => {
    const { container, getByRole } = renderMcp(
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

    fireEvent.click(getByRole("button", { name: /Resolve library id/i }));
    await settleAsyncRender();

    expect(Boolean(textContent(container).includes("\"foo\": \"bar\""))).toBeTrue();
    expect(Boolean(textContent(container).includes("Tool returned no content"))).toBeFalse();
  });

  test("renders resource-link content blocks", async () => {
    const { container, getByRole } = renderMcp(
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
                      audience: ["agent"],
                      priority: 0.75,
                      extra: "ignored",
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

    fireEvent.click(getByRole("button", { name: /Resolve library id/i }));
    await settleAsyncRender();

    expect(Boolean(textContent(container).includes("Read Docs"))).toBeTrue();
    expect(Boolean(textContent(container).includes("audience=agent"))).toBeTrue();
    expect(Boolean(textContent(container).includes("priority=0.75"))).toBeTrue();
    expect(Boolean(textContent(container).includes("extra=ignored"))).toBeFalse();
  });

  test("renders image and audio content blocks with supported annotations", async () => {
    const { container, getByRole } = renderMcp(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry({
            mcpToolCall: buildMcpView({
              result: {
                type: "success",
                content: [
                  {
                    type: "image",
                    data: "AA==",
                    mimeType: "image/png",
                    annotations: {
                      audience: ["user", "assistant"],
                      extra: "ignored",
                    },
                  },
                  {
                    type: "audio",
                    data: "AA==",
                    mimeType: "audio/wav",
                    annotations: {
                      lastModified: "2026-07-06T00:00:00Z",
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

    fireEvent.click(getByRole("button", { name: /Resolve library id/i }));
    await settleAsyncRender();

    expect(container.querySelector("img")?.getAttribute("src") ?? "").toBe("data:image/png;base64,AA==");
    expect(container.querySelector("audio")?.getAttribute("src") ?? "").toBe("data:audio/wav;base64,AA==");
    expect(Boolean(textContent(container).includes("Annotations: audience=user, assistant"))).toBeTrue();
    expect(Boolean(textContent(container).includes("Annotations: lastModified=2026-07-06T00:00:00Z"))).toBeTrue();
    expect(Boolean(textContent(container).includes("extra=ignored"))).toBeFalse();
  });

  test("renders embedded resources with URI, MIME type, annotations, and content", async () => {
    const { container, getByRole } = renderMcp(
      <TooltipProvider>
        <McpToolCall
          item={buildMcpEntry({
            mcpToolCall: buildMcpView({
              result: {
                type: "success",
                content: [
                  {
                    type: "embedded_resource",
                    resource: {
                      uri: "file:///workspace/report.json",
                      mimeType: "application/json",
                      text: "{\"ok\":true}",
                      annotations: {
                        audience: ["agent"],
                        lastModified: "2026-07-06",
                        hidden: "ignored",
                      },
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

    fireEvent.click(getByRole("button", { name: /Resolve library id/i }));
    await settleAsyncRender();

    expect(hasExactText(container, "URI")).toBeTrue();
    expect(hasExactText(container, "MIME type")).toBeTrue();
    expect(hasExactText(container, "Annotations")).toBeTrue();
    expect(hasExactText(container, "Content")).toBeTrue();
    expect(Boolean(textContent(container).includes("file:///workspace/report.json"))).toBeTrue();
    expect(Boolean(textContent(container).includes("application/json"))).toBeTrue();
    expect(Boolean(textContent(container).includes("audience=agent; lastModified=2026-07-06"))).toBeTrue();
    expect(Boolean(textContent(container).includes("{\"ok\":true}"))).toBeTrue();
    expect(Boolean(textContent(container).includes("hidden=ignored"))).toBeFalse();
  });

  test("builds Codex-style MCP app side-panel ids from renderable resources", () => {
    const sidePanelInput = buildMcpAppSidePanelInput({
      threadId: "thread-1",
      payload: buildMcpView({
        mcpAppResourceUri: "ui://context7/docs",
      }),
      resource: {
        uri: "ui://context7/docs",
        mode: "html",
        html: "<!doctype html><html><body>Docs app</body></html>",
        mimeType: "text/html;profile=mcp-app",
        metadata: {
          domain: null,
          csp: null,
          heightHint: 420,
          minFrameHeight: null,
          prefersBorder: false,
          isCollapsible: true,
        },
      },
    });

    expect(sidePanelInput.mcpAppId).toBe("context7:ui://context7/docs");
    expect(sidePanelInput.capabilityId).toBe("mcp-capability:thread-1:context7:resolve-library-id:call_9L9LUlz6nkg1Jp2LA4mrAL8o");
    expect(sidePanelInput.resource.metadata.heightHint).toBe(420);
  });
});
