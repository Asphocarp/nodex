import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { render, textContent } from "../../../../../test/dom";
import { GenericToolCall } from "./generic-tool-call";

function buildGenericEntry(overrides?: Partial<CodexTranscriptEntry>): CodexTranscriptEntry {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "tool-1",
    entryId: "tool-1",
    type: "tool_call",
    kind: "toolCall",
    semanticKind: "toolCall",
    status: "completed",
    toolCall: {
      subtype: "generic",
      server: "internal_tools",
      toolName: "summarize_stage_shell",
      args: {
        section: "footer",
      },
      result: {
        summary: "The composer hides behind blocking request surfaces.",
      },
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("GenericToolCall", () => {
  test("renders a Codex-style summary row with a humanized detail label", () => {
    const { getByRole } = render(<GenericToolCall item={buildGenericEntry()} />);
    const summary = textContent(getByRole("button", { name: /Called Summarize Stage Shell tool from Internal Tools/i }));
    expect(Boolean(summary.includes("Called"))).toBeTrue();
    expect(Boolean(summary.includes("Summarize Stage Shell tool from Internal Tools"))).toBeTrue();
  });

  test("reveals structured fallback details when expanded", () => {
    const { container, getByRole } = render(<GenericToolCall item={buildGenericEntry()} />);
    fireEvent.click(getByRole("button", { name: /Called Summarize Stage Shell tool from Internal Tools/i }));

    const renderedText = textContent(container);
    expect(Boolean(renderedText.includes("Arguments"))).toBeTrue();
    expect(Boolean(renderedText.includes("Result"))).toBeTrue();
    expect(Boolean(renderedText.includes("composer hides behind blocking request surfaces"))).toBeTrue();
  });

  test("falls back to raw item payloads when no structured tool view exists", () => {
    const { container, getByRole } = render(
      <GenericToolCall
        item={buildGenericEntry({
          toolCall: undefined,
          markdownText: "Unknown tool payload",
          rawItem: {
            type: "opaque_tool_call",
            value: {
              ok: true,
            },
          },
        })}
      />,
    );

    fireEvent.click(getByRole("button", { name: /Called Unknown tool payload/i }));
    expect(Boolean(textContent(container).includes("Raw Item"))).toBeTrue();
  });
});
