import { useLayoutEffect, useRef } from "react";
import { act } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, Virtualizer, useVirtualizer } from "@pierre/diffs/react";
import { render } from "../../test/dom";

interface ObservedTarget {
  callback: IntersectionObserverCallback;
  observer: IntersectionObserver;
}

interface VirtualizerObserverHarness {
  emit: (target: Element, isIntersecting: boolean) => void;
  intersectionDisconnect: ReturnType<typeof vi.fn>;
  intersectionOptions: IntersectionObserverInit[];
  isObserved: (target: Element) => boolean;
  observedTargets: () => Element[];
  resizeDisconnect: ReturnType<typeof vi.fn>;
  restore: () => void;
}

function installVirtualizerObserverHarness(): VirtualizerObserverHarness {
  const originalIntersectionObserver = globalThis.IntersectionObserver;
  const originalResizeObserver = globalThis.ResizeObserver;
  const observed = new Map<Element, ObservedTarget>();
  const intersectionOptions: IntersectionObserverInit[] = [];
  const intersectionDisconnect = vi.fn();
  const resizeDisconnect = vi.fn();

  class ControlledIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null;
    readonly rootMargin: string;
    readonly scrollMargin = "0px";
    readonly thresholds: readonly number[];

    constructor(
      private readonly callback: IntersectionObserverCallback,
      options: IntersectionObserverInit = {},
    ) {
      intersectionOptions.push(options);
      this.root = options.root ?? null;
      this.rootMargin = options.rootMargin ?? "0px";
      this.thresholds = Array.isArray(options.threshold)
        ? options.threshold
        : [options.threshold ?? 0];
    }

    disconnect(): void {
      intersectionDisconnect();
      for (const [target, record] of observed) {
        if (record.observer === this) observed.delete(target);
      }
    }

    observe(target: Element): void {
      observed.set(target, {
        callback: this.callback,
        observer: this,
      });
    }

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }

    unobserve(target: Element): void {
      if (observed.get(target)?.observer === this) observed.delete(target);
    }
  }

  class ControlledResizeObserver implements ResizeObserver {
    disconnect(): void {
      resizeDisconnect();
    }

    observe(): void {}

    unobserve(): void {}
  }

  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: ControlledIntersectionObserver,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: ControlledResizeObserver,
  });

  return {
    emit(target, isIntersecting) {
      const record = observed.get(target);
      if (!record) throw new Error("Expected a connected virtualizer target.");
      record.callback(
        [
          {
            target,
            isIntersecting,
            intersectionRatio: isIntersecting ? 1 : 0,
          } as IntersectionObserverEntry,
        ],
        record.observer,
      );
    },
    intersectionDisconnect,
    intersectionOptions,
    isObserved: (target) => observed.has(target),
    observedTargets: () => [...observed.keys()],
    resizeDisconnect,
    restore() {
      Object.defineProperty(globalThis, "IntersectionObserver", {
        configurable: true,
        writable: true,
        value: originalIntersectionObserver,
      });
      Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        writable: true,
        value: originalResizeObserver,
      });
    },
  };
}

function ConnectedVirtualizerItem({
  onRender,
  onVisibilityChange,
  reconcileHeights,
}: {
  onRender: (dirty: boolean) => boolean;
  onVisibilityChange: (visible: boolean) => void;
  reconcileHeights: () => boolean;
}) {
  const virtualizer = useVirtualizer();
  const targetRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const target = targetRef.current;
    if (!target || !virtualizer) return;
    return virtualizer.connect(target, {
      onRender,
      reconcileHeights,
      setVisibility: onVisibilityChange,
    });
  }, [onRender, onVisibilityChange, reconcileHeights, virtualizer]);

  return <div ref={targetRef} data-testid="virtualized-file" />;
}

describe("Review diff Virtualizer contract", () => {
  test("uses the 1000px viewport margin, connects visibility, and releases observers", async () => {
    const observers = installVirtualizerObserverHarness();
    const onRender = vi.fn(() => true);
    const onVisibilityChange = vi.fn();
    const reconcileHeights = vi.fn(() => false);

    try {
      const view = render(
        <Virtualizer config={{ intersectionObserverMargin: 1_000 }}>
          <ConnectedVirtualizerItem
            onRender={onRender}
            onVisibilityChange={onVisibilityChange}
            reconcileHeights={reconcileHeights}
          />
        </Virtualizer>,
      );
      const scrollRoot = view.container.firstElementChild;
      const target = view.getByTestId("virtualized-file");

      expect(observers.intersectionOptions).toHaveLength(1);
      expect(observers.intersectionOptions[0]).toMatchObject({
        root: scrollRoot,
        rootMargin: "1000px 0px 1000px 0px",
        threshold: [0, 0.000001, 0.99999, 1],
      });
      expect(observers.isObserved(target)).toBe(true);

      await act(async () => {
        observers.emit(target, true);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      });

      expect(onVisibilityChange).toHaveBeenCalledWith(true);
      expect(onRender).toHaveBeenCalled();
      expect(reconcileHeights).toHaveBeenCalled();

      await act(async () => {
        view.unmount();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      });

      expect(observers.isObserved(target)).toBe(false);
      expect(observers.intersectionDisconnect).toHaveBeenCalledTimes(1);
      expect(observers.resizeDisconnect).toHaveBeenCalledTimes(1);
    } finally {
      observers.restore();
    }
  });

  test("drives a real FileDiff body through offscreen and visible states", async () => {
    const observers = installVirtualizerObserverHarness();
    const fileDiff = parsePatchFiles([
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -1 +1 @@",
      "-export const beforeNeedle = true;",
      "+export const afterNeedle = true;",
    ].join("\n")).flatMap((patch) => patch.files)[0];
    if (!fileDiff) throw new Error("Expected a parsed file diff.");

    try {
      render(
        <Virtualizer config={{ intersectionObserverMargin: 1_000 }}>
          <FileDiff fileDiff={fileDiff} />
        </Virtualizer>,
      );
      const target = observers.observedTargets()[0];
      if (!target) throw new Error("Expected FileDiff to connect to Virtualizer.");

      expect(target.shadowRoot?.textContent ?? target.textContent)
        .not.toContain("afterNeedle");
      await act(async () => {
        observers.emit(target, true);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      });
      expect(target.shadowRoot?.textContent ?? target.textContent)
        .toContain("afterNeedle");

      await act(async () => {
        observers.emit(target, false);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      });
      expect(target.shadowRoot?.textContent ?? target.textContent)
        .not.toContain("afterNeedle");
    } finally {
      observers.restore();
    }
  });
});
