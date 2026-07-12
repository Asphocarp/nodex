import { describe, expect, test } from "vitest";
import type { CardProjectTransferCommandResult } from "../../shared/card-project-transfer";
import type { PublicCardProjectTransferIntent } from "../../shared/card-project-transfer-transport";
import { browserRendererTransport } from "./browser-renderer-transport";
import {
  createElectronRendererTransport,
  type ElectronRendererBridge,
} from "./electron-renderer-transport";

const intent: PublicCardProjectTransferIntent = {
  version: 2,
  operationId: "renderer-transfer-1",
  sourceProjectId: "project-a",
  targetProjectId: "project-b",
  cardId: "card-1",
  target: {
    databaseBlockId: "database-b",
    viewId: "view-b",
    status: "in_progress",
  },
};

const result: CardProjectTransferCommandResult = {
  ok: false,
  error: {
    code: "document_head_conflict",
    message: "reload",
    retryable: true,
    operationId: intent.operationId,
    cardId: intent.cardId,
  },
};

describe("Card Project transfer renderer transports", () => {
  test("browser posts the strict logical intent to the source Project route", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    let capturedBody: unknown;
    globalThis.fetch = (async (input, init) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(result), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const response = await browserRendererTransport.transferCardProject(
        "project-a",
        intent,
      );
      expect(response.ok).toBe(false);
      expect(
        capturedUrl.endsWith("/api/projects/project-a/card-transfers"),
      ).toBe(true);
      expect(
        (capturedBody as PublicCardProjectTransferIntent).operationId,
      ).toBe(intent.operationId);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("Electron invokes the trusted transfer channel", async () => {
    let capturedChannel = "";
    let capturedProjectId = "";
    const bridge = {
      invoke: async (channel: string, projectId: string) => {
        capturedChannel = channel;
        capturedProjectId = projectId;
        return result;
      },
    } as unknown as ElectronRendererBridge;
    const response = await createElectronRendererTransport(
      bridge,
    ).transferCardProject("project-a", intent);
    expect(response.ok).toBe(false);
    expect(capturedChannel).toBe("cards:project-transfer");
    expect(capturedProjectId).toBe("project-a");
  });
});
