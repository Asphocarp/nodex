import { act, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BlockReferenceRuntimeProvider } from "@/components/block-documents/block-reference-runtime-context";
import { BlockDisclosureStateStore } from "@/lib/block-disclosure-state";
import {
  ReferenceSurfaceActivationBudget,
} from "@/lib/reference-surface-state";
import { render } from "@/test/dom";
import { CardOutlinerBlock } from "./card-outliner-block";

const targetModel = vi.hoisted(() => ({
  status: "available" as const,
  targetBlockId: "nested-card",
  card: {
    blockId: "nested-card",
    projectId: "project-a",
    lifecycle: "active" as const,
    location: { kind: "document" as const, documentId: "document:host" },
    locationRevision: 1,
    metadataRevision: 1,
    documentId: "document:nested-card",
    documentGeneration: 1,
    documentHeadSeq: 1,
    documentAuthority: "ydoc_primary" as const,
    content: {
      projectedSeq: 1,
      title: "Nested Card",
      richTitle: [
        { type: "text" as const, text: "Nested Card", styles: {} },
      ],
      preview: "Body",
      plainText: "Body",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  document: {
    readiness: "ready" as const,
    schemaKey: "nodex.card",
    schemaVersion: 2,
  },
}));

vi.mock("@/lib/block-reference-queries", () => ({
  useCardTargetReadModel: () => ({
    data: targetModel,
    loading: false,
    error: null,
  }),
}));

vi.mock("./expanded-card-outliner-document", () => ({
  ExpandedCardOutlinerDocument: () => (
    <div data-testid="expanded-card-runtime">Target runtime</div>
  ),
}));

class ControlledIntersectionObserver implements IntersectionObserver {
  static latest: ControlledIntersectionObserver | null = null;

  readonly root = null;
  readonly rootMargin: string;
  readonly scrollMargin = "0px";
  readonly thresholds = [0];
  observed: Element | null = null;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.rootMargin = options?.rootMargin ?? "0px";
    ControlledIntersectionObserver.latest = this;
  }

  disconnect(): void {
    this.observed = null;
  }

  observe(target: Element): void {
    this.observed = target;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve(target: Element): void {
    if (this.observed === target) this.observed = null;
  }

  emit(isIntersecting: boolean): void {
    if (!this.observed) throw new Error("No observed Card outliner anchor");
    const rect = this.observed.getBoundingClientRect();
    this.callback([
      {
        boundingClientRect: rect,
        intersectionRatio: isIntersecting ? 1 : 0,
        intersectionRect: rect,
        isIntersecting,
        rootBounds: null,
        target: this.observed,
        time: performance.now(),
      },
    ], this);
  }
}

const originalIntersectionObserver = globalThis.IntersectionObserver;

afterEach(() => {
  ControlledIntersectionObserver.latest = null;
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: originalIntersectionObserver,
  });
});

describe("CardOutlinerBlock", () => {
  test("keeps one observed row mounted while the target runtime activates", async () => {
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: ControlledIntersectionObserver,
    });
    const disclosureStore = new BlockDisclosureStateStore();
    const activationBudget = new ReferenceSurfaceActivationBudget(1);
    const view = render(
      <BlockReferenceRuntimeProvider
        value={{
          projectId: "project-a",
          projectName: "Project A",
          projectWorkspacePath: null,
          hostCardId: "host-card",
          ancestorCardIds: ["host-card"],
          ancestorDocumentOwnerBlockIds: ["host-card"],
          isActiveSurface: true,
        }}
      >
        <CardOutlinerBlock
          relationship="child"
          shellBlockId="nested-card"
          targetBlockId="nested-card"
          displayHint="Nested Card"
          disclosureStore={disclosureStore}
          activationBudget={activationBudget}
        />
      </BlockReferenceRuntimeProvider>,
    );
    const anchor = view.container.querySelector<HTMLElement>(
      "[data-card-outliner-target='nested-card']",
    );
    expect(anchor).toBeTruthy();
    await waitFor(() => expect(ControlledIntersectionObserver.latest).toBeTruthy());

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Expand Nested Card" }));
      ControlledIntersectionObserver.latest?.emit(true);
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByTestId("expanded-card-runtime")).toBeTruthy());

    expect(
      view.container.querySelector("[data-card-outliner-target='nested-card']"),
    ).toBe(anchor);
    expect(ControlledIntersectionObserver.latest?.observed).toBe(anchor);
    expect(activationBudget.getActiveKeys()).toHaveLength(1);
  });

  test("persists disclosure by reference Block identity rather than target Card", async () => {
    const disclosureStore = new BlockDisclosureStateStore();
    const activationBudget = new ReferenceSurfaceActivationBudget(2);
    const view = render(
      <BlockReferenceRuntimeProvider
        value={{
          projectId: "project-a",
          projectName: "Project A",
          projectWorkspacePath: null,
          hostCardId: "host-card",
          ancestorCardIds: ["host-card"],
          ancestorDocumentOwnerBlockIds: ["host-card"],
          isActiveSurface: true,
        }}
      >
        <CardOutlinerBlock
          relationship="reference"
          shellBlockId="card-ref-1"
          targetBlockId="nested-card"
          displayHint="Nested Card"
          disclosureStore={disclosureStore}
          activationBudget={activationBudget}
          visibilityOverride
        />
        <CardOutlinerBlock
          relationship="reference"
          shellBlockId="card-ref-2"
          targetBlockId="nested-card"
          displayHint="Nested Card"
          disclosureStore={disclosureStore}
          activationBudget={activationBudget}
          visibilityOverride
        />
      </BlockReferenceRuntimeProvider>,
    );
    const rows = view.container.querySelectorAll(
      "[data-card-outliner-target='nested-card']",
    );
    const firstDisclosure = view
      .getAllByRole("button", { name: "Expand Nested Card" })
      .at(0);
    if (!firstDisclosure) throw new Error("Missing first Card disclosure");

    await act(async () => {
      fireEvent.click(firstDisclosure);
      await Promise.resolve();
    });

    expect(rows[0]?.getAttribute("data-card-outliner-expanded")).toBe("true");
    expect(rows[1]?.getAttribute("data-card-outliner-expanded")).toBe("false");
    expect(disclosureStore.isExpanded("card-ref-1")).toBe(true);
    expect(disclosureStore.isExpanded("card-ref-2")).toBe(false);
  });
});
