import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import { installAsyncRequestAnimationFrame, installElementScrollHeight } from "../../../test/browser-globals";
import { render, settleAsyncRender } from "../../../test/dom";
import type { ThreadUserMessageNavigationItem } from "../thread-stage-types";
import {
  EnsureLocalConversationThreadScrollController,
  LocalConversationThreadScrollLayout,
} from "./local-conversation-thread-scroll-controller";
import {
  collectThreadUserMessageNavigationObservationTargets,
  ensureThreadUserMessageNavigationRowVisible,
  resolveThreadUserMessageNavigationCurrentRangeIds,
  ThreadUserMessageNavigationRail,
  threadUserMessageNavigationMutationsIncludeTurnContainer,
} from "./thread-user-message-navigation-rail";

const originalIntersectionObserver = globalThis.IntersectionObserver;
const intersectionObserverInstances: TestIntersectionObserver[] = [];

class TestIntersectionObserver {
  readonly callback: IntersectionObserverCallback;
  readonly options?: IntersectionObserverInit;
  readonly observedElements: Element[] = [];

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    intersectionObserverInstances.push(this);
  }

  observe(element: Element) {
    if (!this.observedElements.includes(element)) {
      this.observedElements.push(element);
    }
  }

  unobserve(element: Element) {
    const index = this.observedElements.indexOf(element);
    if (index >= 0) {
      this.observedElements.splice(index, 1);
    }
  }

  disconnect() {
    this.observedElements.splice(0);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  trigger(entries: Array<{ target: Element; isIntersecting: boolean }>) {
    this.callback(
      entries.map((entry) => ({
        boundingClientRect: entry.target.getBoundingClientRect(),
        intersectionRatio: entry.isIntersecting ? 1 : 0,
        intersectionRect: entry.target.getBoundingClientRect(),
        isIntersecting: entry.isIntersecting,
        rootBounds: null,
        target: entry.target,
        time: 0,
      }) as IntersectionObserverEntry),
      this as unknown as IntersectionObserver,
    );
  }
}

function installTestIntersectionObserver() {
  intersectionObserverInstances.splice(0);
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: TestIntersectionObserver,
  });
}

function restoreIntersectionObserver() {
  intersectionObserverInstances.splice(0);
  if (typeof originalIntersectionObserver === "undefined") {
    Reflect.deleteProperty(globalThis as typeof globalThis & { IntersectionObserver?: typeof IntersectionObserver }, "IntersectionObserver");
    return;
  }

  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: originalIntersectionObserver,
  });
}

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
                  data-turn-key={item.turnKey}
                  data-content-search-turn-key={item.turnKey}
                >
                  <div data-content-search-unit-key={item.id}>
                    <div data-user-message-bubble="true">{item.label}</div>
                  </div>
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
    installTestIntersectionObserver();
    installAsyncRequestAnimationFrame();
    installElementScrollHeight(5000);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value() {},
    });
  });

  afterEach(() => {
    restoreIntersectionObserver();
  });

  test("collects Codex-compatible observer targets from turn containers", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <section data-turn-key="turn_same">
        <div data-content-search-unit-key="turn_same:user:0"></div>
        <div data-content-search-unit-key="turn_same:user:1"></div>
      </section>
      <section data-content-search-turn-key="turn_next">
        <div data-content-search-unit-key="turn_next:user:0"></div>
      </section>
      <div data-content-search-unit-key="turn_skip:user:0"></div>
    `;

    const targets = collectThreadUserMessageNavigationObservationTargets(
      root,
      new Set(["turn_same:user:0", "turn_same:user:1", "turn_next:user:0"]),
    );

    expect(targets.length).toBe(3);
    expect(targets[0]?.element.getAttribute("data-turn-key")).toBe("turn_same");
    expect(targets[0]?.itemId).toBe("turn_same:user:0");
    expect(targets[1]?.element.getAttribute("data-content-search-unit-key")).toBe("turn_same:user:1");
    expect(targets[1]?.itemId).toBe("turn_same:user:1");
    expect(targets[2]?.element.getAttribute("data-content-search-turn-key")).toBe("turn_next");
    expect(targets[2]?.itemId).toBe("turn_next:user:0");
  });

  test("resolves current range from first visible rail item through last visible rail item", () => {
    const items = [1, 2, 3, 4].map((index) => buildItem(index));

    const range = resolveThreadUserMessageNavigationCurrentRangeIds(
      items,
      new Set(["turn_2:user:0", "turn_4:user:0"]),
    );

    expect([...range ?? []].join(",")).toBe("turn_2:user:0,turn_3:user:0,turn_4:user:0");
  });

  test("rescans only when mutations add or remove turn containers", () => {
    const turn = document.createElement("div");
    turn.setAttribute("data-turn-key", "turn_1");
    const nested = document.createElement("div");
    nested.innerHTML = `<section data-content-search-turn-key="turn_2"></section>`;
    const plain = document.createElement("span");

    expect(threadUserMessageNavigationMutationsIncludeTurnContainer([
      { addedNodes: [turn] as unknown as NodeList, removedNodes: [] as unknown as NodeList } as MutationRecord,
    ])).toBeTrue();
    expect(threadUserMessageNavigationMutationsIncludeTurnContainer([
      { addedNodes: [nested] as unknown as NodeList, removedNodes: [] as unknown as NodeList } as MutationRecord,
    ])).toBeTrue();
    expect(threadUserMessageNavigationMutationsIncludeTurnContainer([
      { addedNodes: [plain] as unknown as NodeList, removedNodes: [] as unknown as NodeList } as MutationRecord,
    ])).toBeFalse();
  });

  test("keeps the active rail row visible within the rail list", () => {
    const list = document.createElement("div");
    const row = document.createElement("button");
    row.setAttribute("data-thread-user-message-navigation-item-id", "turn_9:user:0");
    list.append(row);
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 20 });
    Object.defineProperty(row, "offsetHeight", { configurable: true, value: 10 });

    Object.defineProperty(row, "offsetTop", { configurable: true, value: 90 });
    ensureThreadUserMessageNavigationRowVisible(list, "turn_9:user:0");
    expect(list.scrollTop).toBe(81);

    list.scrollTop = 50;
    Object.defineProperty(row, "offsetTop", { configurable: true, value: 10 });
    ensureThreadUserMessageNavigationRowVisible(list, "turn_9:user:0");
    expect(list.scrollTop).toBe(10);

    list.scrollTop = 10;
    Object.defineProperty(row, "offsetTop", { configurable: true, value: 15 });
    ensureThreadUserMessageNavigationRowVisible(list, "turn_9:user:0");
    expect(list.scrollTop).toBe(10);
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

  test("observes turn containers instead of user search-unit leaves", async () => {
    const items = [1, 2, 3, 4].map((index) => buildItem(index));
    const { container } = render(<RailHarness items={items} />);
    await settleAsyncRender();

    const observer = intersectionObserverInstances[0];
    const scrollElement = container.querySelector("[data-local-conversation-thread-body='true']");
    const firstTurn = container.querySelector("[data-turn-key='turn_1']");
    const firstUnit = container.querySelector("[data-content-search-unit-key='turn_1:user:0']");

    expect(observer?.options?.root).toBe(scrollElement);
    expect(observer?.options?.rootMargin).toBe("-16px 0px 0px 0px");
    expect("threshold" in (observer?.options ?? {})).toBeFalse();
    expect(observer?.observedElements.includes(firstTurn as Element)).toBeTrue();
    expect(observer?.observedElements.includes(firstUnit as Element)).toBeFalse();
  });

  test("marks the visible first-to-last user message range as current", async () => {
    const items = [1, 2, 3, 4].map((index) => buildItem(index));
    const { container } = render(<RailHarness items={items} />);
    await settleAsyncRender();

    const observer = intersectionObserverInstances[0];
    const turn2 = container.querySelector("[data-turn-key='turn_2']") as Element;
    const turn4 = container.querySelector("[data-turn-key='turn_4']") as Element;
    await act(async () => {
      observer?.trigger([
        { target: turn2, isIntersecting: true },
        { target: turn4, isIntersecting: true },
      ]);
    });
    await settleAsyncRender();

    const currentRows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-thread-user-message-navigation-item-id][aria-current='true']"),
    ).map((row) => row.dataset.threadUserMessageNavigationItemId);
    expect(currentRows.join(",")).toBe("turn_2:user:0,turn_3:user:0,turn_4:user:0");

    const secondMarker = container.querySelector<HTMLElement>(
      "[data-thread-user-message-navigation-item-id='turn_2:user:0'] .thread-user-message-navigation-marker",
    );
    expect(secondMarker?.className.includes("bg-token-foreground")).toBeTrue();
    expect(secondMarker?.className.includes("opacity-60")).toBeTrue();
  });

  test("auto-scrolls the rail list to the primary current row", async () => {
    const items = Array.from({ length: 10 }, (_, index) => buildItem(index + 1));
    const { container } = render(<RailHarness items={items} />);
    await settleAsyncRender();

    const list = container.querySelector<HTMLElement>("[data-thread-user-message-navigation-rail-list='true']") as HTMLElement;
    const eighthRow = container.querySelector<HTMLElement>(
      "[data-thread-user-message-navigation-item-id='turn_8:user:0']",
    ) as HTMLElement;
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 20 });
    Object.defineProperty(eighthRow, "offsetTop", { configurable: true, value: 90 });
    Object.defineProperty(eighthRow, "offsetHeight", { configurable: true, value: 10 });

    const observer = intersectionObserverInstances[0];
    const turn8 = container.querySelector("[data-turn-key='turn_8']") as Element;
    await act(async () => {
      observer?.trigger([{ target: turn8, isIntersecting: true }]);
    });
    await settleAsyncRender();

    expect(list.scrollTop).toBe(81);
  });

  test("scopes current-marker hover dimming to hovered rail lists", () => {
    const css = readFileSync("src/renderer/styles/theme-utilities.css", "utf8");

    expect(css.includes(
      "[data-thread-user-message-navigation-rail-list]:not([data-scrubbing]):hover [data-thread-user-message-navigation-item-id][aria-current=\"true\"]:not(:hover):not(:focus-visible) .thread-user-message-navigation-marker",
    )).toBeTrue();
    expect(css.includes(
      "\n  [data-thread-user-message-navigation-item-id][aria-current=\"true\"]:not(:hover) .thread-user-message-navigation-marker",
    )).toBeFalse();
  });

  test("click navigation uses smooth scrolling", async () => {
    const scrollCalls: ScrollToOptions[] = [];
    const scrollIntoViewCalls: ScrollIntoViewOptions[] = [];
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value(options: ScrollToOptions) {
        scrollCalls.push(options);
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value(options: ScrollIntoViewOptions) {
        scrollIntoViewCalls.push(options);
      },
    });

    const items = [1, 2, 3, 4].map((index) => buildItem(index));
    const { getByRole } = render(<RailHarness items={items} />);
    await settleAsyncRender();
    const scrollCallCountBeforeClick = scrollCalls.length;

    fireEvent.click(getByRole("button", { name: "Jump to user message 1" }));
    await settleAsyncRender();

    expect(scrollCalls.length).toBe(scrollCallCountBeforeClick);
    expect(scrollIntoViewCalls[scrollIntoViewCalls.length - 1]?.behavior).toBe("smooth");
    expect(scrollIntoViewCalls[scrollIntoViewCalls.length - 1]?.block).toBe("start");
  });

  test("reveals a virtualized missing target before scrolling to it", async () => {
    const revealed: string[] = [];
    const scrollIntoViewCalls: ScrollIntoViewOptions[] = [];
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value(options: ScrollIntoViewOptions) {
        scrollIntoViewCalls.push(options);
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
          const turn = document.createElement("div");
          turn.setAttribute("data-turn-key", item.turnKey);
          const target = document.createElement("div");
          target.setAttribute("data-content-search-unit-key", item.id);
          turn.append(target);
          root?.append(turn);
          return target;
        }}
      />,
    );
    await settleAsyncRender();

    fireEvent.click(getByRole("button", { name: "Jump to user message 2" }));
    await settleAsyncRender();

    expect(revealed.join(",")).toBe("turn_2:user:0:smooth");
    expect(scrollIntoViewCalls[scrollIntoViewCalls.length - 1]?.behavior).toBe("smooth");
    expect(scrollIntoViewCalls[scrollIntoViewCalls.length - 1]?.block).toBe("start");
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
          const turn = document.createElement("div");
          turn.setAttribute("data-turn-key", item.turnKey);
          const target = document.createElement("div");
          target.setAttribute("data-content-search-unit-key", item.id);
          turn.append(target);
          root?.append(turn);
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
    expect(
      secondRow.querySelector<HTMLElement>(".thread-user-message-navigation-marker")?.className.includes("opacity-100"),
    ).toBeTrue();
  });
});
