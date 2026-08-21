import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { useClippedFocusSafety } from "./use-clipped-focus-safety";

type IntersectionCallback = ConstructorParameters<typeof IntersectionObserver>[0];

class IntersectionObserverMock {
  static instances: IntersectionObserverMock[] = [];

  readonly observed: Element[] = [];

  constructor(private readonly callback: IntersectionCallback) {
    IntersectionObserverMock.instances.push(this);
  }

  disconnect() {}
  unobserve() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  observe(element: Element) {
    this.observed.push(element);
  }

  publish(element: Element, intersectionRatio: number) {
    this.callback(
      [
        {
          intersectionRatio,
          isIntersecting: intersectionRatio > 0,
          target: element,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }
}

function FocusSafetyHarness({ clipped }: { readonly clipped: boolean }) {
  const contentRef = useRef<HTMLDivElement>(null);
  useClippedFocusSafety(contentRef, clipped);
  return (
    <div ref={contentRef}>
      <a href="https://example.com">Link</a>
    </div>
  );
}

describe("useClippedFocusSafety", () => {
  const originalIntersectionObserver = globalThis.IntersectionObserver;

  afterEach(() => {
    globalThis.IntersectionObserver = originalIntersectionObserver;
    IntersectionObserverMock.instances = [];
  });

  test("makes clipped controls inert and restores their prior accessibility state", () => {
    globalThis.IntersectionObserver =
      IntersectionObserverMock as unknown as typeof IntersectionObserver;
    const view = render(<FocusSafetyHarness clipped />);
    const link = view.getByRole("link");
    const observer = IntersectionObserverMock.instances[0];
    if (!observer) throw new Error("Expected focus safety observer");

    observer.publish(link, 0);
    expect(link.inert).toBe(true);
    expect(link.getAttribute("aria-hidden")).toBe("true");

    view.rerender(<FocusSafetyHarness clipped={false} />);
    expect(link.inert).toBe(false);
    expect(link.hasAttribute("inert")).toBe(false);
    expect(link.hasAttribute("aria-hidden")).toBe(false);
  });
});
