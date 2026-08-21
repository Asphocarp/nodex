import { describe, expect, test } from "vite-plus/test";
import { PanelTabPresentationRegistry } from "./panel-tab-presentation-registry";

function createRegistry() {
  let nextId = 0;
  return new PanelTabPresentationRegistry({
    createId: () => `presentation-${++nextId}`,
  });
}

describe("PanelTabPresentationRegistry", () => {
  test("transfers a leaf preview presentation to its replacement and pin", () => {
    const registry = createRegistry();
    const first = registry.reconcile("session:right:leaf", [{ id: "preview-a", preview: true }], 0);
    const replacement = registry.reconcile(
      "session:right:leaf",
      [{ id: "preview-b", preview: true }],
      10,
    );
    const pinned = registry.reconcile(
      "session:right:leaf",
      [{ id: "preview-b", preview: false }],
      20,
    );

    expect(replacement[0]?.presentationId).toBe(first[0]?.presentationId);
    expect(pinned[0]?.presentationId).toBe(first[0]?.presentationId);
  });

  test("allocates a new preview presentation after the previous preview was pinned", () => {
    const registry = createRegistry();
    const preview = registry.reconcile(
      "session:right:leaf",
      [{ id: "preview-a", preview: true }],
      0,
    );
    registry.reconcile("session:right:leaf", [{ id: "preview-a", preview: false }], 10);
    const withNewPreview = registry.reconcile(
      "session:right:leaf",
      [
        { id: "preview-a", preview: false },
        { id: "preview-b", preview: true },
      ],
      20,
    );

    expect(withNewPreview[0]?.presentationId).toBe(preview[0]?.presentationId);
    expect(withNewPreview[1]?.presentationId).not.toBe(preview[0]?.presentationId);
  });

  test("does not reuse a transferred preview presentation for the outgoing semantic id", () => {
    const registry = createRegistry();
    const first = registry.reconcile("session:right:leaf", [{ id: "preview-a", preview: true }], 0);
    const replacement = registry.reconcile(
      "session:right:leaf",
      [{ id: "preview-b", preview: true }],
      10,
    );
    const withOutgoingFileDurable = registry.reconcile(
      "session:right:leaf",
      [
        { id: "preview-b", preview: true },
        { id: "preview-a", preview: false },
      ],
      20,
    );

    expect(replacement[0]?.presentationId).toBe(first[0]?.presentationId);
    expect(withOutgoingFileDurable[0]?.presentationId).toBe(first[0]?.presentationId);
    expect(withOutgoingFileDurable[1]?.presentationId).not.toBe(first[0]?.presentationId);
  });

  test("carries durable presentation identity between panel leaves", () => {
    const registry = createRegistry();
    const source = registry.reconcile(
      "session:right:source",
      [{ id: "durable-a", preview: false }],
      0,
    );
    registry.reconcile("session:right:source", [], 10);
    const destination = registry.reconcile(
      "session:bottom:destination",
      [{ id: "durable-a", preview: false }],
      20,
    );

    expect(destination[0]?.presentationId).toBe(source[0]?.presentationId);
  });

  test("allocates a new identity when a closed tab is reopened after exit", () => {
    const registry = createRegistry();
    const first = registry.reconcile(
      "session:right:leaf",
      [{ id: "durable-a", preview: false }],
      0,
    );
    registry.reconcile("session:right:leaf", [], 10);
    const reopened = registry.reconcile(
      "session:right:leaf",
      [{ id: "durable-a", preview: false }],
      161,
    );

    expect(reopened[0]?.presentationId).not.toBe(first[0]?.presentationId);
  });

  test("releases a controller preview slot without leaking it to a later preview", () => {
    const registry = createRegistry();
    const first = registry.reconcile(
      "session:right:old-leaf",
      [{ id: "preview-a", preview: true }],
      0,
    );
    registry.releaseController("session:right:old-leaf", 10);
    const later = registry.reconcile(
      "session:right:new-leaf",
      [{ id: "preview-b", preview: true }],
      20,
    );

    expect(later[0]?.presentationId).not.toBe(first[0]?.presentationId);
  });
});
