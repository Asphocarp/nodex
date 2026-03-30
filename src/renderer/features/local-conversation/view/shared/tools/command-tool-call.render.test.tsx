import { beforeEach, describe, expect, test } from "bun:test";
import { act, fireEvent } from "@testing-library/react";
import { NodexTooltipProvider as TooltipProvider } from "../../../../../components/ui/tooltip";
import { THREAD_SETTINGS_STORAGE_KEY } from "../../../../../lib/codex-thread-settings";
import { render, settleAsyncRender, textContent } from "../../../../../test/dom";
import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { CodexThreadSettingsProvider } from "../../../../../lib/use-codex-thread-settings";
import { CommandToolCall } from "./command-tool-call";

const LONG_COMMAND = [
  "bun x tsx scripts/collect-long-command-metrics.ts",
  "--project nodex",
  "--scope renderer",
  "--filter command-tool-call",
  "--json",
].join(" ");

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
  beforeEach(() => {
    localStorage.removeItem(THREAD_SETTINGS_STORAGE_KEY);
  });

  test("keeps in-progress commands collapsed on first mount", () => {
    const { container } = render(
      <TooltipProvider>
        <CodexThreadSettingsProvider>
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
        </CodexThreadSettingsProvider>
      </TooltipProvider>,
    );

    expect(Boolean(textContent(container).includes("Running bun test"))).toBeTrue();
    const collapsedBody = container.querySelector('[data-thread-find-skip="true"]');
    expect(Boolean(collapsedBody)).toBeTrue();
    expect((collapsedBody as HTMLElement | null)?.style.height === "0px").toBeTrue();
  });

  test("keeps settled commands collapsed on first mount in steps-with-commands mode", () => {
    const { container } = render(
      <TooltipProvider>
        <CodexThreadSettingsProvider>
          <CommandToolCall item={buildCommandEntry()} />
        </CodexThreadSettingsProvider>
      </TooltipProvider>,
    );
    const collapsedBody = container.querySelector('[data-thread-find-skip="true"]');
    expect(Boolean(collapsedBody)).toBeTrue();
    expect((collapsedBody as HTMLElement | null)?.style.height === "0px").toBeTrue();
  });

  test("keeps settled commands expanded on first mount in steps-with-output mode", () => {
    localStorage.setItem(THREAD_SETTINGS_STORAGE_KEY, JSON.stringify({ detailLevel: "STEPS_EXECUTION" }));

    const { container } = render(
      <TooltipProvider>
        <CodexThreadSettingsProvider>
          <CommandToolCall item={buildCommandEntry()} />
        </CodexThreadSettingsProvider>
      </TooltipProvider>,
    );

    expect(Boolean(container.querySelector('[data-thread-find-skip="true"]'))).toBeFalse();
    expect(Boolean(textContent(container).includes("Shell"))).toBeTrue();
  });

  test("suppresses command cards entirely in steps mode", () => {
    localStorage.setItem(THREAD_SETTINGS_STORAGE_KEY, JSON.stringify({ detailLevel: "STEPS_PROSE" }));

    const { container } = render(
      <TooltipProvider>
        <CodexThreadSettingsProvider>
          <CommandToolCall item={buildCommandEntry()} />
        </CodexThreadSettingsProvider>
      </TooltipProvider>,
    );

    expect(textContent(container)).toBe("");
  });

  test("lets in-progress commands expand but not collapse back while still running", async () => {
    const { container, getByText } = render(
      <TooltipProvider>
        <CodexThreadSettingsProvider>
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
        </CodexThreadSettingsProvider>
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

  test("collapses back after a running execution-detail command settles", async () => {
    localStorage.setItem(THREAD_SETTINGS_STORAGE_KEY, JSON.stringify({ detailLevel: "STEPS_EXECUTION" }));

    const inProgressEntry = buildCommandEntry({
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
    });
    const completedEntry = buildCommandEntry();

    const { container, getByText, rerender } = render(
      <TooltipProvider>
        <CodexThreadSettingsProvider>
          <CommandToolCall item={inProgressEntry} />
        </CodexThreadSettingsProvider>
      </TooltipProvider>,
    );

    fireEvent.click(getByText("Running bun test"));
    await settleAsyncRender();

    rerender(
      <TooltipProvider>
        <CodexThreadSettingsProvider>
          <CommandToolCall item={completedEntry} />
        </CodexThreadSettingsProvider>
      </TooltipProvider>,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    await settleAsyncRender();

    const collapsedBody = container.querySelector('[data-thread-find-skip="true"]');
    expect(Boolean(collapsedBody)).toBeTrue();
  });

  test("expands a long command line when clicked", async () => {
    localStorage.setItem(THREAD_SETTINGS_STORAGE_KEY, JSON.stringify({ detailLevel: "STEPS_EXECUTION" }));

    const { container } = render(
      <TooltipProvider>
        <CodexThreadSettingsProvider>
          <CommandToolCall
            item={buildCommandEntry({
              toolCall: {
                subtype: "command",
                toolName: "bash",
                args: {
                  command: LONG_COMMAND,
                },
                result: "done\nExit code 0\n",
              },
            })}
          />
        </CodexThreadSettingsProvider>
      </TooltipProvider>,
    );

    const commandLine = container.querySelector<HTMLElement>("[data-command-shell-line]");
    expect(Boolean(commandLine?.className.includes("line-clamp-2"))).toBeTrue();

    const toggle = container.querySelector<HTMLElement>("[data-command-shell-line-toggle]");
    expect(Boolean(toggle)).toBeTrue();
    fireEvent.click(toggle as HTMLElement);
    await settleAsyncRender();

    const expandedLine = container.querySelector<HTMLElement>("[data-command-shell-line]");
    expect(Boolean(expandedLine?.className.includes("line-clamp-2"))).toBeFalse();
  });

  test("expands a long command line from keyboard", async () => {
    localStorage.setItem(THREAD_SETTINGS_STORAGE_KEY, JSON.stringify({ detailLevel: "STEPS_EXECUTION" }));

    const { container } = render(
      <TooltipProvider>
        <CodexThreadSettingsProvider>
          <CommandToolCall
            item={buildCommandEntry({
              toolCall: {
                subtype: "command",
                toolName: "bash",
                args: {
                  command: LONG_COMMAND,
                },
                result: "done\nExit code 0\n",
              },
            })}
          />
        </CodexThreadSettingsProvider>
      </TooltipProvider>,
    );

    const toggle = container.querySelector<HTMLElement>("[data-command-shell-line-toggle]");
    expect(Boolean(toggle)).toBeTrue();
    fireEvent.keyDown(toggle as HTMLElement, { key: "Enter" });
    await settleAsyncRender();

    const expandedLine = container.querySelector<HTMLElement>("[data-command-shell-line]");
    expect(Boolean(expandedLine?.className.includes("line-clamp-2"))).toBeFalse();
  });

  test("does not show a no-output placeholder while a command is still running", () => {
    localStorage.setItem(THREAD_SETTINGS_STORAGE_KEY, JSON.stringify({ detailLevel: "STEPS_EXECUTION" }));

    const { container } = render(
      <TooltipProvider>
        <CodexThreadSettingsProvider>
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
                result: "",
              },
            })}
          />
        </CodexThreadSettingsProvider>
      </TooltipProvider>,
    );

    expect(Boolean(textContent(container).includes("No output"))).toBeFalse();
  });
});
