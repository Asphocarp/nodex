import { describe, expect, test } from "vitest";
import type {
  AdditionalDocumentCommandResult,
} from "../shared/additional-document-commands";
import type { PublicAdditionalDocumentCommandRequest } from "../shared/additional-document-command-transport";
import {
  ADDITIONAL_DOCUMENT_COMMAND_IPC_CHANNEL,
  registerAdditionalDocumentCommandIpcHandler,
  type AdditionalDocumentCommandIpcHandler,
} from "./additional-document-command-ipc";

const request: PublicAdditionalDocumentCommandRequest = {
  version: 1,
  operationId: "additional-command-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "spoofed-session",
  actor: { kind: "spoofed" },
  coordination: { kind: "fifo_only" },
  operation: {
    kind: "create_template",
    sourceBlockId: "template-1",
    documentId: "document-template-1",
    displayName: "Review template",
    initialBlocks: [],
    placement: { kind: "space" },
  },
};

const committed = (
  bound: PublicAdditionalDocumentCommandRequest,
): AdditionalDocumentCommandResult => ({
  ok: true,
  value: {
    version: 1,
    operationId: bound.operationId,
    projectId: bound.projectId,
    storeEpoch: bound.storeEpoch,
    operationKind: bound.operation.kind,
    semanticHash: "a".repeat(64),
    duplicate: false,
    effect: {
      createdBlockIds: ["template-1"],
      preservedBlockIds: [],
      deletedBlockIds: [],
      documentHeads: [
        { documentId: "document-template-1", generation: 1, headSeq: 1 },
      ],
    },
    commitSeq: 7,
    committedAt: "2026-07-12T00:00:00.000Z",
  },
});

describe("Additional Document command IPC", () => {
  test("Electron IPC binds the trusted main-frame identity", async () => {
    let handler: AdditionalDocumentCommandIpcHandler = async () => {
      throw new Error("IPC handler was not registered");
    };
    const captured: PublicAdditionalDocumentCommandRequest[] = [];
    registerAdditionalDocumentCommandIpcHandler({
      registerHandle: (channel, listener) => {
        expect(channel).toBe(ADDITIONAL_DOCUMENT_COMMAND_IPC_CHANNEL);
        handler = listener;
      },
      resolveTrustedIdentity: () => ({
        clientSessionId: "electron-window-1",
        actor: { kind: "electron_renderer", clientId: "renderer-1" },
      }),
      applyCommand: async (bound) => {
        captured.push(bound);
        return committed(bound);
      },
    });

    const result = await handler({}, "project-1", request);
    expect(result.ok).toBe(true);
    expect(captured.length).toBe(1);
    expect(captured[0]?.clientSessionId).toBe("electron-window-1");
    expect(captured[0]?.actor.kind).toBe("electron_renderer");
  });

  test("Electron IPC rejects untrusted and cross-Project commands", async () => {
    let untrustedHandler: AdditionalDocumentCommandIpcHandler = async () => {
      throw new Error("IPC handler was not registered");
    };
    registerAdditionalDocumentCommandIpcHandler({
      registerHandle: (_channel, listener) => {
        untrustedHandler = listener;
      },
      resolveTrustedIdentity: () => null,
      applyCommand: async (bound) => committed(bound),
    });
    expect((await untrustedHandler({}, "project-1", request)).ok).toBe(false);

    let scopedHandler: AdditionalDocumentCommandIpcHandler = async () => {
      throw new Error("IPC handler was not registered");
    };
    let calls = 0;
    registerAdditionalDocumentCommandIpcHandler({
      registerHandle: (_channel, listener) => {
        scopedHandler = listener;
      },
      resolveTrustedIdentity: () => ({
        clientSessionId: "renderer-1",
        actor: { kind: "electron_renderer" },
      }),
      applyCommand: async (bound) => {
        calls += 1;
        return committed(bound);
      },
    });
    expect((await scopedHandler({}, "project-2", request)).ok).toBe(false);
    expect(calls).toBe(0);
  });

});
