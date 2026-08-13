import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { renderWithMaitai } from "../../../../test/dom";
import { GeneratedImageGallery } from "./generated-image-gallery";
import { getPendingImageAnimationClockSubscriberCount } from "./pending-image-animation-clock";

const originalIntersectionObserver = globalThis.IntersectionObserver;
const originalVisibilityState = Object.getOwnPropertyDescriptor(
  document,
  "visibilityState",
);

class ControlledIntersectionObserver implements IntersectionObserver {
  static instances: ControlledIntersectionObserver[] = [];

  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds = [0];
  private target: Element | null = null;

  constructor(private readonly callback: IntersectionObserverCallback) {
    ControlledIntersectionObserver.instances.push(this);
  }

  disconnect() {
    this.target = null;
  }

  observe(target: Element) {
    this.target = target;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve(target: Element) {
    if (this.target === target) this.target = null;
  }

  emit(isIntersecting: boolean) {
    if (!this.target) return;
    this.callback([{
      isIntersecting,
      target: this.target,
    } as IntersectionObserverEntry], this);
  }
}

function setDocumentVisibility(visibilityState: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  ControlledIntersectionObserver.instances = [];
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: originalIntersectionObserver,
  });
  if (originalVisibilityState) {
    Object.defineProperty(document, "visibilityState", originalVisibilityState);
  } else {
    Reflect.deleteProperty(document, "visibilityState");
  }
  expect(getPendingImageAnimationClockSubscriberCount()).toBe(0);
});

describe("GeneratedImageGallery pending scheduling", () => {
  test("subscribes only visible intersecting cells and pauses with the document", async () => {
    ControlledIntersectionObserver.instances = [];
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: ControlledIntersectionObserver,
    });
    setDocumentVisibility("visible");
    const measurement = vi.spyOn(
      HTMLElement.prototype,
      "getBoundingClientRect",
    ).mockReturnValue({
      bottom: 74,
      height: 74,
      left: 0,
      right: 320,
      top: 0,
      width: 320,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const context = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fill: vi.fn(),
      fillStyle: "",
      globalAlpha: 1,
      moveTo: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      setTransform: vi.fn(),
    };
    const getContext = vi.spyOn(
      HTMLCanvasElement.prototype,
      "getContext",
    ).mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const view = renderWithMaitai(
      <GeneratedImageGallery images={[]} pendingImageCount={6} />,
    );

    try {
      await waitFor(() => {
        expect(ControlledIntersectionObserver.instances).toHaveLength(6);
      });
      expect(getPendingImageAnimationClockSubscriberCount()).toBe(0);

      await act(async () => {
        for (const observer of ControlledIntersectionObserver.instances) {
          observer.emit(true);
        }
        await Promise.resolve();
      });

      expect(view.container.querySelectorAll(
        '[data-generated-image-dot-field="true"][data-animate="true"]',
      )).toHaveLength(4);
      expect(getPendingImageAnimationClockSubscriberCount()).toBe(4);

      await act(async () => {
        setDocumentVisibility("hidden");
        await Promise.resolve();
      });

      expect(view.container.querySelectorAll(
        '[data-generated-image-dot-field="true"][data-animate="true"]',
      )).toHaveLength(0);
      expect(getPendingImageAnimationClockSubscriberCount()).toBe(0);
    } finally {
      view.unmount();
      measurement.mockRestore();
      getContext.mockRestore();
    }
  });
});
