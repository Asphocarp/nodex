import { describe, expect, test, vi } from "vitest";
import type { ConfigReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigReadResponse";
import { CodexConversationImageAssetService } from "./conversation-image-asset-service";

function buildConfig(): ConfigReadResponse {
  return {
    config: {},
    origins: {},
    layers: [],
  } as unknown as ConfigReadResponse;
}

describe("CodexConversationImageAssetService", () => {
  test("resolves a pointer through authenticated metadata and main-process bytes", async () => {
    const requestChatGptDesktop = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          download_url: "https://files.example.test/generated-image.png",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("image-bytes", {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
    const service = new CodexConversationImageAssetService({
      readConfig: vi.fn().mockResolvedValue(buildConfig()),
      requestChatGptDesktop,
      fetchImpl,
    });

    await expect(
      service.resolve({
        hostId: "default",
        pointer: "file-service://asset/id with spaces",
      }),
    ).resolves.toEqual({
      ok: true,
      dataBase64: Buffer.from("image-bytes").toString("base64"),
      mimeType: "image/png",
    });
    expect(requestChatGptDesktop).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/files/download/asset%2Fid%20with%20spaces",
        refreshOn401: true,
      }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://files.example.test/generated-image.png",
      expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer" }),
    );
  });

  test("preserves explicit HTTP status and fails closed for unsupported hosts", async () => {
    const requestChatGptDesktop = vi.fn().mockResolvedValue(
      new Response("expired", {
        status: 425,
      }),
    );
    const readConfig = vi.fn().mockResolvedValue(buildConfig());
    const service = new CodexConversationImageAssetService({
      readConfig,
      requestChatGptDesktop,
      fetchImpl: vi.fn(),
    });

    await expect(
      service.resolve({
        hostId: "default",
        pointer: "sediment://asset-id",
      }),
    ).resolves.toEqual({ ok: false, message: "expired", status: 425 });
    await expect(
      service.resolve({
        hostId: "remote-host",
        pointer: "file-service://asset-id",
      }),
    ).resolves.toEqual({
      ok: false,
      message: "Unsupported Codex image asset host: remote-host",
      status: null,
    });
    expect(readConfig).toHaveBeenCalledTimes(1);
  });
});
