import { beforeEach, describe, expect, test } from "bun:test";
import { act, fireEvent } from "@testing-library/react";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import { installAsyncRequestAnimationFrame, installElementScrollHeight } from "../../../test/browser-globals";
import { render, settleAsyncRender } from "../../../test/dom";
import type { ThreadUserMessageNavigationItem } from "../thread-stage-types";
import {
  EnsureLocalConversationThreadScrollController,
  LocalConversationThreadScrollLayout,
} from "./local-conversation-thread-scroll-controller";
import { ThreadUserMessageNavigationRail } from "./thread-user-message-navigation-rail";

function buildItem(index: number, overrides?: Partial<ThreadUserMessageNavigationItem>): ThreadUserMessageNavigationItem {
  return {
    id: `turn_${index}:user:0`,
    turnId: `turn_${index}`,
    turnKey: `turn_${index}`,
    ordinal: index,
    label: `Message ${index}`,
    responsePreview: `Answer ${index}`,
    outputs: [],
    isHeartbeat: false,
    ...overrides,
  };
}

function RailHarness({
  items,
  onRevealItem,
  missingTargetId,
}: {
  items: ThreadUserMessageNavigationItem[];
  missingTargetId?: string;
  onRevealItem?: Parameters<typeof ThreadUserMessageNavigationRail>[0]["onRevealItem"];
}) {
  return (
    <TooltipProvider>
      <EnsureLocalConversationThreadScrollController>
        <LocalConversationThreadScrollLayout>
          <div data-thread-find-target="conversation">
            {items.map((item) =>
              item.id === missingTargetId ? null : (
                <div
                  key={item.id}
                  data-content-search-unit-key={item.id}
                >
                  <div data-user-message-bubble="true">{item.label}</div>
                </div>
              ))}
          </div>
          <ThreadUserMessageNavigationRail
            items={items}
            onRevealItem={onRevealItem}
          />
        </LocalConversationThreadScrollLayout>
      </EnsureLocalConversationThreadScrollController>
    </TooltipProvider>
  );
}

describe("ThreadUserMessageNavigationRail", () => {
  beforeEach(() => {
    installAsyncRequestAnimationFrame();
    installElementScrollHeight(5000);
  });

  test("renders the Codex-compatible rail DOM contract", async () => {
    const items = [1, 2, 3, 4].map((index) => buildItem(index));
    const { container } = render(<RailHarness items={items} />);
    await settleAsyncRender();

    const nav = container.querySelector('nav[aria-label="User messages"]');
    const list = container.querySelector("[data-thread-user-message-navigation-rail-list='true']");
    const rows = container.querySelectorAll("[data-thread-user-message-navigation-item-id]");

    expect(Boolean(nav)).toBeTrue();
    expect(nav?.parentElement?.getAttribute("data-thread-user-message-navigation-portal-target")).toBe("true");
    expect(Boolean(list)).toBeTrue();
    expect(rows.length).toBe(4);
    expect(rows[0]?.getAttribute("aria-label")).toBe("Jump to user message 1");
    expect(rows[3]?.getAttribute("aria-current")).toBe("true");
  });

  test("click navigation uses smooth scrolling", async () => {
    const scrollCalls: ScrollToOptions[] = [];
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value(options: ScrollToOptions) {
        scrollCalls.push(options);
      },
    });

    const items = [1, 2, 3, 4].map((index) => buildItem(index));
    const { getByRole } = render(<RailHarness items={items} />);
    await settleAsyncRender();

    fireEvent.click(getByRole("button", { name: "Jump to user message 1" }));
    await settleAsyncRender();

    expect(scrollCalls[scrollCalls.length - 1]?.behavior).toBe("smooth");
  });

  test("reveals a virtualized missing target before scrolling to it", async () => {
    const revealed: string[] = [];
    const scrollCalls: ScrollToOptions[] = [];
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value(options: ScrollToOptions) {
        scrollCalls.push(options);
      },
    });

    const items = [1, 2, 3, 4].map((index) => buildItem(index));
    const { container, getByRole } = render(
      <RailHarness
        items={items}
        missingTargetId="turn_2:user:0"
        onRevealItem={(item, mode) => {
          revealed.push(`${item.id}:${mode}`);
          const root = container.querySelector("[data-thread-find-target='conversation']");
          const target = document.createElement("div");
          target.setAttribute("data-content-search-unit-key", item.id);
          root?.append(target);
          return target;
        }}
      />,
    );
    await settleAsyncRender();

    fireEvent.click(getByRole("button", { name: "Jump to user message 2" }));
    await settleAsyncRender();

    expect(revealed.join(",")).toBe("turn_2:user:0:smooth");
    expect(scrollCalls[scrollCalls.length - 1]?.behavior).toBe("smooth");
  });

  test("pointer drag scrubs to the row under the rail midpoint instantly", async () => {
    const revealed: string[] = [];
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      writable: true,
      value() {},
    });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      writable: true,
      value() {},
    });
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      writable: true,
      value() {
        return true;
      },
    });

    const items = [1, 2, 3, 4].map((index) => buildItem(index));
    const { container, getByRole } = render(
      <RailHarness
        items={items}
        missingTargetId="turn_2:user:0"
        onRevealItem={(item, mode) => {
          revealed.push(`${item.id}:${mode}`);
          const root = container.querySelector("[data-thread-find-target='conversation']");
          const target = document.createElement("div");
          target.setAttribute("data-content-search-unit-key", item.id);
          root?.append(target);
          return target;
        }}
      />,
    );
    await settleAsyncRender();

    const list = container.querySelector<HTMLElement>("[data-thread-user-message-navigation-rail-list='true']");
    const secondRow = getByRole("button", { name: "Jump to user message 2" });
    Object.defineProperty(list, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top: 0,
        right: 36,
        bottom: 100,
        left: 0,
        width: 36,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => {},
      }),
    });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      writable: true,
      value: () => secondRow,
    });

    const firstRow = getByRole("button", { name: "Jump to user message 1" });
    await act(async () => {
      fireEvent.pointerDown(firstRow, {
        pointerId: 1,
        button: 0,
        isPrimary: true,
        clientX: 0,
        clientY: 0,
      });
      fireEvent.pointerMove(firstRow, {
        pointerId: 1,
        isPrimary: true,
        clientX: 0,
        clientY: 40,
      });
      await Promise.resolve();
    });

    expect(revealed.join(",")).toBe("turn_2:user:0:instant");
    expect(secondRow.getAttribute("data-scrub-target")).toBe("true");
  });
});
