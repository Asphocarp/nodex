import { describe, expect, test } from "vitest";
import type { ConfigReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigReadResponse";
import type { ChatGptDesktopRequestInput } from "./chatgpt-desktop-request";
import { CodexDictationService } from "./dictation-service";

const EMPTY_CONFIG_READ_RESPONSE: ConfigReadResponse = {
  config: {} as ConfigReadResponse["config"],
  origins: {},
  layers: null,
};

describe("CodexDictationService", () => {
  test("delegates /transcribe through the desktop request helper and returns text", async () => {
    let capturedRequest: ChatGptDesktopRequestInput | null = null;

    const service = new CodexDictationService({
      readConfig: async () => EMPTY_CONFIG_READ_RESPONSE,
      readAuthStatus: async () => ({
        authMethod: "chatgpt",
        authToken: "unused",
        requiresOpenaiAuth: false,
      }),
      requestChatGptDesktop: async (input) => {
        capturedRequest = input;
        return new Response(JSON.stringify({ text: "transcribed text" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      },
    });

    const text = await service.transcribe({
      contentType: "multipart/form-data; boundary=test",
      base64Payload: "encoded-payload",
    });

    if (!capturedRequest) {
      throw new Error("Expected request helper to be called");
    }

    const request = capturedRequest as ChatGptDesktopRequestInput;
    expect(text).toBe("transcribed text");
    expect(request.baseUrl).toBe("https://chatgpt.com/backend-api");
    expect(request.path).toBe("/transcribe");
    expect(request.method).toBe("POST");
    expect(request.body).toBe("encoded-payload");

    const headers = new Headers(request.headers);
    expect(headers.get("Content-Type")).toBe("multipart/form-data; boundary=test");
    expect(headers.get("X-Codex-Base64")).toBe("1");
    expect(request.refreshOn401).toBe(true);
    expect(request.missingAuthErrorMessage).toBe(
      "ChatGPT authentication is required for dictation.",
    );
  });

  test("accepts the nested body.text response shape", async () => {
    const service = new CodexDictationService({
      readConfig: async () => EMPTY_CONFIG_READ_RESPONSE,
      readAuthStatus: async () => ({
        authMethod: "chatgpt",
        authToken: "unused",
        requiresOpenaiAuth: false,
      }),
      requestChatGptDesktop: async () =>
        new Response(JSON.stringify({ body: { text: "nested text" } }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
    });

    expect(
      await service.transcribe({
        contentType: "multipart/form-data; boundary=test",
        base64Payload: "payload",
      }),
    ).toBe("nested text");
  });

  test("sanitizes upstream HTML failure logs and throws a generic error", async () => {
    let warningMessage = "";
    let warningFields: Record<string, unknown> | null = null;
    const service = new CodexDictationService({
      readConfig: async () => EMPTY_CONFIG_READ_RESPONSE,
      readAuthStatus: async () => ({
        authMethod: "chatgpt",
        authToken: "unused",
        requiresOpenaiAuth: false,
      }),
      requestChatGptDesktop: async () =>
        new Response("<html><body><h1>Forbidden</h1><p>Try again</p></body></html>", {
          status: 403,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        }),
      logger: {
        warn: (message, fields) => {
          warningMessage = message;
          warningFields = (fields ?? {}) as Record<string, unknown>;
        },
      },
    });

    let didThrow = false;
    try {
      await service.transcribe({
        contentType: "multipart/form-data; boundary=test",
        base64Payload: "payload",
      });
    } catch (error) {
      didThrow = true;
      expect((error as Error).message).toBe("Unable to transcribe audio");
    }

    expect(didThrow).toBe(true);
    const fields = warningFields as unknown as Record<string, unknown>;
    if (!fields) {
      throw new Error("Expected warning fields");
    }
    expect(warningMessage).toBe("Dictation transcribe proxy failed");
    expect(fields.status).toBe(403);
    expect(fields.host).toBe("chatgpt.com");
    expect(fields.path).toBe("/transcribe");
    expect(fields.upstreamContentType).toBe("text/html; charset=utf-8");
    expect(fields.bodyPreview).toBe("Forbidden Try again");
  });
});
