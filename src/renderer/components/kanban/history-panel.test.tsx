import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";

import type { OwnedDocumentDescriptor } from "../../../shared/block-documents/contracts";
import type { DocumentVersionDetail } from "../../../shared/block-documents/document-history";
import type { CardHistoryEntry, CardHistoryPage } from "../../../shared/card-history";
import { render, textContent } from "../../test/dom";
import { mergeCardHistoryEntries } from "./card-history-view-model";
import { HistoryPanel } from "./history-panel";

type HistoryPanelApiOperation =
  | "listCardHistory"
  | "getDocumentVersion"
  | "getOwnedDocumentDescriptor"
  | "restoreDocumentVersion";

const callHistoryPanelApi = async (
  operation: HistoryPanelApiOperation,
  ...args: unknown[]
): Promise<unknown> => {
  const handler = (globalThis as {
    __historyPanelApi?: (
      operation: HistoryPanelApiOperation,
      ...args: unknown[]
    ) => Promise<unknown> | unknown;
  }).__historyPanelApi;
  if (!handler) throw new Error(`Unhandled HistoryPanel API: ${operation}`);
  return await handler(operation, ...args);
};

vi.mock("./history-panel-deps", () => ({
  listCardHistory: (...args: unknown[]) => callHistoryPanelApi("listCardHistory", ...args),
  getDocumentVersion: (...args: unknown[]) => callHistoryPanelApi("getDocumentVersion", ...args),
  getOwnedDocumentDescriptor: (...args: unknown[]) =>
    callHistoryPanelApi("getOwnedDocumentDescriptor", ...args),
  restoreDocumentVersion: (...args: unknown[]) =>
    callHistoryPanelApi("restoreDocumentVersion", ...args),
}));

afterEach(() => {
  delete (globalThis as { __historyPanelApi?: unknown }).__historyPanelApi;
});

describe("canonical Card history panel", () => {
  test("previews and forward-restores a Document checkpoint", async () => {
    const checkpoint = makeCheckpointEntry();
    const calls: HistoryPanelApiOperation[] = [];
    const restoreRequests: Record<string, unknown>[] = [];
    let mutationCount = 0;

    setHistoryPanelApi((operation, ...args) => {
      calls.push(operation);
      if (operation === "listCardHistory") {
        return { ok: true, value: makePage([checkpoint]) };
      }
      if (operation === "getDocumentVersion") {
        return { ok: true, value: makeVersionDetail() };
      }
      if (operation === "getOwnedDocumentDescriptor") {
        return makeDescriptor();
      }
      restoreRequests.push(args[2] as Record<string, unknown>);
      if (restoreRequests.length === 1) {
        throw new Error("ACK lost after commit");
      }
      return { ok: true, value: { mutationId: "restore-committed" } };
    });

    const view = render(
      <HistoryPanel
        projectId="project-1"
        cardId="card-1"
        cardTitle="Current title"
        projectWorkspacePath="/workspace/project-1"
        open
        onClose={() => undefined}
        onCardMutated={() => {
          mutationCount += 1;
        }}
      />,
    );

    await waitFor(() => {
      if (!textContent(document.body).includes("Checkpoint body")) {
        throw new Error("Checkpoint preview did not load");
      }
    });
    expect(calls.includes("listCardHistory")).toBe(true);
    expect(calls.includes("getDocumentVersion")).toBe(true);
    expect(textContent(document.body).includes("forward change")).toBe(true);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Restore checkpoint" }));
      await Promise.resolve();
    });
    expect(textContent(document.body).includes("new forward change")).toBe(true);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Confirm restore" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      if (mutationCount !== 1) throw new Error("Restore did not commit");
    });

    expect(restoreRequests.length).toBe(2);
    expect(restoreRequests[0]?.mutationId).toBe(restoreRequests[1]?.mutationId);
    expect(restoreRequests[0]?.versionId).toBe("version-1");
    expect(restoreRequests[0]?.expectedHeadSeq).toBe(14);
    expect(
      (restoreRequests[0]?.actor as Record<string, unknown> | undefined)?.kind,
    ).toBe("renderer_history_restore");
  });

  test("submits a successful restore exactly once", async () => {
    const checkpoint = makeCheckpointEntry();
    let restoreCount = 0;

    setHistoryPanelApi((operation) => {
      if (operation === "listCardHistory") {
        return { ok: true, value: makePage([checkpoint]) };
      }
      if (operation === "getDocumentVersion") {
        return { ok: true, value: makeVersionDetail() };
      }
      if (operation === "getOwnedDocumentDescriptor") {
        return makeDescriptor();
      }
      restoreCount += 1;
      return { ok: true, value: { mutationId: "restore-committed" } };
    });

    const view = render(
      <HistoryPanel
        projectId="project-1"
        cardId="card-1"
        open
        onClose={() => undefined}
      />,
    );
    await waitFor(() => {
      if (!textContent(document.body).includes("Checkpoint body")) {
        throw new Error("Checkpoint preview did not load");
      }
    });

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Restore checkpoint" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      if (!view.queryByRole("button", { name: "Confirm restore" })) {
        throw new Error("Restore confirmation did not open");
      }
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Confirm restore" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      if (restoreCount !== 1) throw new Error("Restore did not settle");
    });

    expect(restoreCount).toBe(1);
  });

  test("retains an ambiguously delivered or still-retryable restore request", async () => {
    const checkpoint = makeCheckpointEntry();
    const restoreMutationIds: string[] = [];
    let descriptorCount = 0;

    setHistoryPanelApi((operation, ...args) => {
      if (operation === "listCardHistory") {
        return { ok: true, value: makePage([checkpoint]) };
      }
      if (operation === "getDocumentVersion") {
        return { ok: true, value: makeVersionDetail() };
      }
      if (operation === "getOwnedDocumentDescriptor") {
        descriptorCount += 1;
        return makeDescriptor();
      }
      const request = args[2] as Record<string, unknown>;
      restoreMutationIds.push(String(request.mutationId));
      if (restoreMutationIds.length === 1) {
        throw new Error("delivery outcome unknown");
      }
      if (restoreMutationIds.length === 2) {
        return {
          ok: false,
          error: {
            code: "document_busy",
            message: "exact restore retry is still pending",
            retryable: true,
          },
        };
      }
      return { ok: true, value: { mutationId: request.mutationId } };
    });

    const view = render(
      <HistoryPanel
        projectId="project-1"
        cardId="card-1"
        open
        onClose={() => undefined}
      />,
    );
    await waitFor(() => {
      if (!textContent(document.body).includes("Checkpoint body")) {
        throw new Error("Checkpoint preview did not load");
      }
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Restore checkpoint" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      if (!view.queryByRole("button", { name: "Confirm restore" })) {
        throw new Error("Restore confirmation did not open");
      }
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Confirm restore" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      if (
        !textContent(document.body).includes(
          "exact restore retry is still pending",
        )
      ) {
        throw new Error("Retryable delivery was not surfaced");
      }
    });
    expect(restoreMutationIds.length).toBe(2);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Confirm restore" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      if (restoreMutationIds.length !== 3) {
        throw new Error("Pending restore was not retried");
      }
    });

    expect(descriptorCount).toBe(1);
    expect(restoreMutationIds[0]).toBe(restoreMutationIds[1]);
    expect(restoreMutationIds[1]).toBe(restoreMutationIds[2]);
  });

  test("clears a terminally rejected restore request", async () => {
    const checkpoint = makeCheckpointEntry();
    const restoreMutationIds: string[] = [];
    let descriptorCount = 0;

    setHistoryPanelApi((operation, ...args) => {
      if (operation === "listCardHistory") {
        return { ok: true, value: makePage([checkpoint]) };
      }
      if (operation === "getDocumentVersion") {
        return { ok: true, value: makeVersionDetail() };
      }
      if (operation === "getOwnedDocumentDescriptor") {
        descriptorCount += 1;
        return makeDescriptor();
      }
      const request = args[2] as Record<string, unknown>;
      restoreMutationIds.push(String(request.mutationId));
      if (restoreMutationIds.length === 1) {
        return {
          ok: false,
          error: {
            code: "document_conflict",
            message: "checkpoint head is stale",
            retryable: false,
          },
        };
      }
      return { ok: true, value: { mutationId: request.mutationId } };
    });

    const view = render(
      <HistoryPanel
        projectId="project-1"
        cardId="card-1"
        open
        onClose={() => undefined}
      />,
    );
    await waitFor(() => {
      if (!textContent(document.body).includes("Checkpoint body")) {
        throw new Error("Checkpoint preview did not load");
      }
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Restore checkpoint" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      if (!view.queryByRole("button", { name: "Confirm restore" })) {
        throw new Error("Restore confirmation did not open");
      }
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Confirm restore" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      if (!textContent(document.body).includes("checkpoint head is stale")) {
        throw new Error("Terminal rejection was not surfaced");
      }
    });

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Confirm restore" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      if (restoreMutationIds.length !== 2) {
        throw new Error("Fresh restore was not submitted");
      }
    });

    expect(descriptorCount).toBe(2);
    expect(restoreMutationIds[0] === restoreMutationIds[1]).toBe(false);
  });

  test("paginates merged evidence and never offers an inverse for mutations", async () => {
    const mutation = makeMutationEntry();
    const relocation = makeRelocationEntry();
    let listCount = 0;
    let previewCount = 0;

    setHistoryPanelApi((operation, ...args) => {
      if (operation === "getDocumentVersion") {
        previewCount += 1;
        throw new Error("Mutation evidence must not request a checkpoint preview");
      }
      if (operation !== "listCardHistory") {
        throw new Error(`Unexpected operation: ${operation}`);
      }
      listCount += 1;
      const request = args[0] as { before?: unknown };
      if (!request.before) {
        return {
          ok: true,
          value: makePage([mutation], {
            occurredAt: mutation.occurredAt,
            source: "change_log",
            changeSeq: mutation.changeSeq,
          }),
        };
      }
      return { ok: true, value: makePage([relocation]) };
    });

    const view = render(
      <HistoryPanel
        projectId="project-1"
        cardId="card-1"
        open
        onClose={() => undefined}
      />,
    );
    await waitFor(() => {
      if (!textContent(document.body).includes("Changed Card properties")) {
        throw new Error("Mutation evidence did not render");
      }
    });

    expect(textContent(document.body).includes("no inverse operation")).toBe(true);
    expect(view.queryByRole("button", { name: "Restore checkpoint" }) === null).toBe(true);
    expect(previewCount).toBe(0);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Load earlier" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      if (!textContent(document.body).includes("Moved blocks")) {
        throw new Error("Earlier relocation evidence did not render");
      }
    });
    expect(listCount).toBe(2);
  });

  test("deduplicates an inclusive pagination boundary", () => {
    const mutation = makeMutationEntry();
    const relocation = makeRelocationEntry();

    const merged = mergeCardHistoryEntries(
      [mutation],
      [mutation, relocation],
    );

    expect(merged.length).toBe(2);
    expect(merged[0]?.id).toBe(mutation.id);
    expect(merged[1]?.id).toBe(relocation.id);
  });
});

function setHistoryPanelApi(
  handler: (
    operation: HistoryPanelApiOperation,
    ...args: unknown[]
  ) => Promise<unknown> | unknown,
): void {
  (globalThis as { __historyPanelApi?: typeof handler }).__historyPanelApi = handler;
}

const HASH = "a".repeat(64);

function makeCheckpointEntry(): Extract<CardHistoryEntry, { kind: "document_version" }> {
  return {
    id: "document-version:version-1",
    kind: "document_version",
    projectId: "project-1",
    cardBlockId: "card-1",
    documentId: "document-1",
    occurredAt: "2026-07-12T08:00:00.000Z",
    display: {
      category: "checkpoint",
      title: "Manual checkpoint",
      detail: "Saved before restructuring the Card",
      actorLabel: "Local window",
    },
    evidence: { status: "verified" },
    recovery: {
      kind: "restore_document_version",
      documentId: "document-1",
      versionId: "version-1",
    },
    versionMetadata: {
      versionId: "version-1",
      generation: 1,
      baseHeadSeq: 8,
      schemaKey: "nodex.card",
      schemaVersion: 1,
      cause: "manual",
      label: "Before restructure",
      checkpointHash: HASH,
      byteLength: 1_024,
    },
  };
}

function makeMutationEntry(): Extract<CardHistoryEntry, { kind: "block_mutation" }> {
  return {
    id: "change-log:21",
    kind: "block_mutation",
    projectId: "project-1",
    cardBlockId: "card-1",
    documentId: "document-1",
    occurredAt: "2026-07-12T07:00:00.000Z",
    display: {
      category: "property",
      title: "Changed Card properties",
      detail: "Updated two property values",
      actorLabel: "Local window",
    },
    evidence: { status: "verified" },
    recovery: { kind: "unavailable", reason: "no_inverse_contract" },
    changeSeq: 21,
    mutationId: "mutation-21",
    mutationKind: "database_mutation",
    affectedBlockCount: 1,
    fieldIntentCount: 2,
  };
}

function makeRelocationEntry(): Extract<CardHistoryEntry, { kind: "block_relocation" }> {
  return {
    id: "change-log:20",
    kind: "block_relocation",
    projectId: "project-1",
    cardBlockId: "card-1",
    documentId: "document-1",
    occurredAt: "2026-07-12T06:00:00.000Z",
    display: {
      category: "location",
      title: "Moved blocks",
      detail: "Moved two blocks into this Card",
      actorLabel: null,
    },
    evidence: { status: "verified" },
    recovery: { kind: "unavailable", reason: "no_inverse_contract" },
    changeSeq: 20,
    relocationId: "relocation-20",
    direction: "into_card",
    movedBlockCount: 2,
  };
}

function makePage(
  entries: readonly CardHistoryEntry[],
  nextCursor: CardHistoryPage["nextCursor"] = null,
): CardHistoryPage {
  return {
    version: 1,
    projectId: "project-1",
    cardBlockId: "card-1",
    documentId: "document-1",
    entries,
    nextCursor,
  };
}

function makeVersionDetail(): DocumentVersionDetail {
  return {
    summary: {
      versionId: "version-1",
      documentId: "document-1",
      projectId: "project-1",
      generation: 1,
      baseHeadSeq: 8,
      schemaKey: "nodex.card",
      schemaVersion: 1,
      cause: "manual",
      label: "Before restructure",
      actor: { kind: "renderer" },
      checkpointHash: HASH,
      checkpointMetadata: {
        format: "yjs_update_v1",
        stateVectorHash: HASH,
      },
      materializationHash: HASH,
      byteLength: 1_024,
      materializationKind: "card",
      title: "Checkpoint title",
      preview: "Checkpoint body",
      blockCount: 1,
      createdAt: "2026-07-12T08:00:00.000Z",
    },
    materialization: {
      kind: "card",
      schemaVersion: 1,
      title: "Checkpoint title",
      blockTree: [],
      nfm: "Checkpoint body",
      plainText: "Checkpoint body",
      preview: "Checkpoint body",
      references: [],
      assetRefs: [],
    },
  };
}

function makeDescriptor(): OwnedDocumentDescriptor {
  return {
    projectId: "project-1",
    ownerBlockId: "card-1",
    ownerType: "card",
    ownerLifecycle: "active",
    documentId: "document-1",
    storeEpoch: "epoch-1",
    generation: 1,
    headSeq: 14,
    schemaKey: "nodex.card",
    schemaVersion: 1,
    readiness: "ready",
    sync: { kind: "yjs", stateVector: new Uint8Array() },
  };
}
