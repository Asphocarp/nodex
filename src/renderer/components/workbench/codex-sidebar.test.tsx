import { describe, expect, test } from "vitest";
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
    expect(tooltipText.includes("X Plan Codex terminal reverse engineer")).toBe(true);
    expect(tooltipText.includes("2d")).toBe(true);
    expect(tooltipText.includes("nodex")).toBe(true);
    expect(tooltipText.includes("feat/thread-tools")).toBe(true);
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
    expect(tooltipText.includes("Projectless chat")).toBe(true);
    expect(tooltipText.includes("Chat")).toBe(true);
  });
});

describe("codex sidebar thread row", () => {
  test("renders the relative elapsed time in the row", async () => {
    let container!: HTMLElement;

    await act(async () => {
      ({ container } = render(
        <NodexTooltipProvider>
          <CodexSidebarThreadRow
            item={makeThreadItem({ updatedAt: Date.now() - TWO_DAYS_MS - 60_000 })}
            active={false}
            onSelect={() => {}}
          />
        </NodexTooltipProvider>,
      ));
    });

    const elapsed = container.querySelector("[data-app-action-sidebar-thread-elapsed]") as HTMLElement | null;
    expect(elapsed).not.toBeNull();
    expect(textContent(elapsed as HTMLElement).trim()).toBe("2d");
  });

  test("keeps hover actions out of the main title content flow", async () => {
    let container!: HTMLElement;

    await act(async () => {
      ({ container } = render(
        <NodexTooltipProvider>
          <CodexSidebarThreadRow
            item={makeThreadItem()}
            active={false}
            onSelect={() => {}}
            onArchive={() => {}}
            onTogglePinned={() => {}}
          />
        </NodexTooltipProvider>,
      ));
    });

    const row = container.querySelector("[data-app-action-sidebar-thread-row]") as HTMLElement | null;
    expect(row).not.toBeNull();

    const main = (row as HTMLElement).querySelector("[data-app-action-sidebar-thread-main]") as HTMLElement | null;
    const actionRail = (row as HTMLElement).querySelector("[data-app-action-sidebar-thread-action-rail]") as HTMLElement | null;
    expect(main).not.toBeNull();
    expect(actionRail).not.toBeNull();

    expect((main as HTMLElement).querySelector("[data-app-action-sidebar-thread-pin-session]") === null).toBe(true);
    expect((main as HTMLElement).querySelector("[data-app-action-sidebar-thread-archive]") === null).toBe(true);
    expect((actionRail as HTMLElement).querySelector("[data-app-action-sidebar-thread-pin-session]") !== null).toBe(true);
    expect((actionRail as HTMLElement).querySelector("[data-app-action-sidebar-thread-archive]") !== null).toBe(true);
  });

  test("does not reveal hover actions from row focus alone", async () => {
    let container!: HTMLElement;

    await act(async () => {
      ({ container } = render(
        <NodexTooltipProvider>
          <CodexSidebarThreadRow
            item={makeThreadItem()}
            active
            onSelect={() => {}}
            onArchive={() => {}}
            onTogglePinned={() => {}}
          />
        </NodexTooltipProvider>,
      ));
    });

    const actionRail = container.querySelector("[data-app-action-sidebar-thread-action-rail]") as HTMLElement | null;
    expect(actionRail).not.toBeNull();

    const className = (actionRail as HTMLElement).className;
    expect(className.includes("group-hover:opacity-100")).toBe(true);
    expect(className.includes(":has(:focus-visible)")).toBe(true);
    expect(className.includes("group-focus-within")).toBe(false);
  });

  test("keeps the pinned state visible while archive stays in the action rail", async () => {
    let container!: HTMLElement;

    await act(async () => {
      ({ container } = render(
        <NodexTooltipProvider>
          <CodexSidebarThreadRow
            item={makeThreadItem({ pinned: true })}
            active={false}
            onSelect={() => {}}
            onArchive={() => {}}
            onTogglePinned={() => {}}
          />
        </NodexTooltipProvider>,
      ));
    });

    const row = container.querySelector("[data-app-action-sidebar-thread-row]") as HTMLElement | null;
    expect(row).not.toBeNull();

    const main = (row as HTMLElement).querySelector("[data-app-action-sidebar-thread-main]") as HTMLElement | null;
    const actionRail = (row as HTMLElement).querySelector("[data-app-action-sidebar-thread-action-rail]") as HTMLElement | null;
    expect(main).not.toBeNull();
    expect(actionRail).not.toBeNull();

    const restingPin = (main as HTMLElement).querySelector("[data-app-action-sidebar-thread-resting-pin]") as HTMLButtonElement | null;
    expect(restingPin).not.toBeNull();
    expect(restingPin?.getAttribute("aria-label")).toBe("Unpin chat");
    expect((main as HTMLElement).querySelector("[data-app-action-sidebar-thread-archive]") === null).toBe(true);
    expect((actionRail as HTMLElement).querySelector("[data-app-action-sidebar-thread-pin-session]") === null).toBe(true);
    expect((actionRail as HTMLElement).querySelector("[data-app-action-sidebar-thread-archive]") !== null).toBe(true);
  });

  test("omits elapsed metadata when the timestamp is unavailable", async () => {
    let container!: HTMLElement;

    await act(async () => {
      ({ container } = render(
        <NodexTooltipProvider>
          <CodexSidebarThreadRow
            item={makeThreadItem({ updatedAt: Number.NaN })}
            active={false}
            onSelect={() => {}}
          />
        </NodexTooltipProvider>,
      ));
    });

    expect(container.querySelector("[data-app-action-sidebar-thread-elapsed]") === null).toBe(true);
  });
});
