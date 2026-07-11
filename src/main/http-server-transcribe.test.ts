import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  __resetHttpServerDependenciesForTests,
  __setHttpServerDependenciesForTests,
  getHttpServerOptions,
} from "./http-server";

describe("/transcribe route", () => {
  beforeEach(() => {
    __resetHttpServerDependenciesForTests();
  });

  afterEach(() => {
    __resetHttpServerDependenciesForTests();
  });

  test("proxies base64 multipart payloads to the dictation service", async () => {
    let capturedInput: { contentType: string; base64Payload: string } | null = null;
    __setHttpServerDependenciesForTests({
      transcribeDictation: async (input) => {
        capturedInput = input;
        return "transcribed text";
      },
    });

    const options = getHttpServerOptions(51283);
    const response = await options.fetch(
      new Request("http://127.0.0.1:51283/transcribe", {
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data; boundary=test",
        },
        body: "YmFzZTY0LXBheWxvYWQ=",
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as { text?: string };
    const receivedInput = capturedInput as unknown as { contentType: string; base64Payload: string };
    expect(payload.text).toBe("transcribed text");
    expect(receivedInput.contentType).toBe("multipart/form-data; boundary=test");
    expect(receivedInput.base64Payload).toBe("YmFzZTY0LXBheWxvYWQ=");
  });

  test("rejects missing content-type headers", async () => {
    const options = getHttpServerOptions(51283);
    const response = await options.fetch(
      new Request("http://127.0.0.1:51283/transcribe", {
        method: "POST",
        body: new TextEncoder().encode("YmFzZTY0LXBheWxvYWQ="),
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json() as { error?: string };
    expect(payload.error).toBe("Missing Content-Type header");
  });

  test("normalizes upstream failures into route errors", async () => {
    __setHttpServerDependenciesForTests({
      transcribeDictation: async () => {
        throw new Error("ChatGPT authentication is required for dictation.");
      },
    });

    const options = getHttpServerOptions(51283);
    const response = await options.fetch(
      new Request("http://127.0.0.1:51283/transcribe", {
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data; boundary=test",
        },
        body: "YmFzZTY0LXBheWxvYWQ=",
      }),
    );

    expect(response.status).toBe(502);
    const payload = await response.json() as { error?: string };
    expect(payload.error).toBe("ChatGPT authentication is required for dictation.");
  });
});
