import { describe, expect, test } from "bun:test";
import { act } from "react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { render, textContent } from "@/test/dom";
import type { CodexSidebarThreadItem } from "@/lib/types";
import { CodexSidebarThreadRow } from "./codex-sidebar";

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1_000;

function makeThreadItem(overrides: Partial<CodexSidebarThreadItem> = {}): CodexSidebarThreadItem {
  return {
    key: "local:test-thread",
    kind: "local",
    hostId: "local",
    threadId: "thread-test",
    sessionId: "session-test",
    projectId: "nodex",
    title: "X Plan Codex terminal reverse engineer",
    preview: "",
    cwd: "/Users/asc/repo/nodex",
    updatedAt: Date.now() - TWO_DAYS_MS,
    createdAt: Date.now() - TWO_DAYS_MS,
    pinned: false,
    pinnedOrder: null,
    unread: false,
    archived: false,
    statusType: "notLoaded",
    statusActiveFlags: [],
    projectless: false,
    disabled: false,
    ...overrides,
  };
}

function renderOpenThreadHoverCard(item: CodexSidebarThreadItem, props: {
  projectLabel?: string | null;
  branchName?: string | null;
} = {}) {
  return render(
    <NodexTooltipProvider>
      <CodexSidebarThreadRow
        item={item}
        active={false}
        hoverCardOpen
        hoverCardProjectLabel={props.projectLabel}
        hoverCardBranchName={props.branchName}
        onSelect={() => {}}
      />
    </NodexTooltipProvider>,
  );
}

describe("codex sidebar thread hover card", () => {
  test("renders title, relative age, project label, and branch metadata", async () => {
    await act(async () => {
      renderOpenThreadHoverCard(makeThreadItem(), {
        projectLabel: "nodex",
        branchName: "feat/thread-tools",
      });
    });

    const tooltip = document.body.querySelector('[role="tooltip"]') as HTMLElement | null;
    expect(tooltip).not.toBeNull();

    const tooltipText = textContent(tooltip as HTMLElement);
    expect(tooltipText.includes("X Plan Codex terminal reverse engineer")).toBeTrue();
    expect(tooltipText.includes("2d")).toBeTrue();
    expect(tooltipText.includes("nodex")).toBeTrue();
    expect(tooltipText.includes("feat/thread-tools")).toBeTrue();
  });

  test("uses Chat as the projectless fallback label", async () => {
    await act(async () => {
      renderOpenThreadHoverCard(makeThreadItem({
        key: "local:projectless",
        threadId: "thread-projectless",
        sessionId: "session-projectless",
        projectId: null,
        cwd: null,
        projectless: true,
        title: "Projectless chat",
      }));
    });

    const tooltip = document.body.querySelector('[role="tooltip"]') as HTMLElement | null;
    expect(tooltip).not.toBeNull();

    const tooltipText = textContent(tooltip as HTMLElement);
    expect(tooltipText.includes("Projectless chat")).toBeTrue();
    expect(tooltipText.includes("Chat")).toBeTrue();
  });
});
