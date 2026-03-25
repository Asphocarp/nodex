import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { TooltipProvider } from "../../../../../components/ui/tooltip";
import { render, settleAsyncRender, textContent } from "../../../../../test/dom";
import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { CommandToolCall } from "./command-tool-call";

function buildCommandEntry(overrides?: Partial<CodexTranscriptEntry>): CodexTranscriptEntry {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "cmd-1",
    entryId: "cmd-1",
    type: "command_execution",
    kind: "commandExecution",
    semanticKind: "exec",
    status: "completed",
    markdownText: "Ran bun test",
    toolCall: {
      subtype: "command",
      toolName: "bash",
      args: {
        command: "bun test",
      },
      result: "3 pass\nExit code 0\n",
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("CommandToolCall render state", () => {
  test("keeps in-progress commands collapsed on first mount", () => {
    const { container } = render(
      <TooltipProvider>
        <CommandToolCall
          item={buildCommandEntry({
            status: "inProgress",
            markdownText: "Running bun test",
            toolCall: {
              subtype: "command",
              toolName: "bash",
              args: {
                command: "bun test",
              },
              result: "running...\n",
            },
          })}
        />
      </TooltipProvider>,
    );

    expect(Boolean(textContent(container).includes("Running bun test"))).toBeTrue();
    const collapsedBody = container.querySelector('[data-thread-find-skip="true"]');
    expect(Boolean(collapsedBody)).toBeTrue();
    expect((collapsedBody as HTMLElement | null)?.style.height === "0px").toBeTrue();
  });

  test("keeps settled commands expanded on first mount", () => {
    const { container } = render(
      <TooltipProvider>
        <CommandToolCall item={buildCommandEntry()} />
      </TooltipProvider>,
    );
    expect(Boolean(textContent(container).includes("Shell"))).toBeTrue();
    expect(Boolean(textContent(container).includes("Success"))).toBeTrue();
  });

  test("lets in-progress commands expand but not collapse back while still running", async () => {
    const { container, getByText } = render(
      <TooltipProvider>
        <CommandToolCall
          item={buildCommandEntry({
            status: "inProgress",
            markdownText: "Running bun test",
            toolCall: {
              subtype: "command",
              toolName: "bash",
              args: {
                command: "bun test",
              },
              result: "running...\n",
            },
          })}
        />
      </TooltipProvider>,
    );

    fireEvent.click(getByText("Running bun test"));
    await settleAsyncRender();

    const expandedBody = container.querySelector('[data-thread-find-skip]');
    expect(Boolean(expandedBody)).toBeFalse();
    expect(Boolean(textContent(container).includes("Shell"))).toBeTrue();

    fireEvent.click(getByText("Running bun test"));
    await settleAsyncRender();

    expect(Boolean(textContent(container).includes("Shell"))).toBeTrue();
  });
});
