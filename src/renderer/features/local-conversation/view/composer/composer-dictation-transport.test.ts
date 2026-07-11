import { describe, expect, test } from "vitest";
import {
  buildDictationMultipartPayload,
  encodeDictationBase64,
  sanitizeDictationFilename,
  transcribeDictationBlob,
} from "./composer-dictation-transport";

describe("composer dictation transport", () => {
  test("sanitizes quoted filenames", () => {
    expect(sanitizeDictationFilename('co"dex".webm')).toBe("codex.webm");
  });

  test("builds the Codex multipart payload shape", async () => {
    const payload = await buildDictationMultipartPayload({
      blob: new Blob(["audio-bytes"], { type: "audio/webm" }),
      boundary: "----codex-transcribe-test",
      filename: "codex.webm",
      contentType: "audio/webm",
      language: "en",
    });

    const bodyText = new TextDecoder().decode(payload);
    expect(Boolean(bodyText.includes('Content-Disposition: form-data; name="file"; filename="codex.webm"'))).toBe(true);
    expect(Boolean(bodyText.includes("Content-Type: audio/webm"))).toBe(true);
    expect(Boolean(bodyText.includes('Content-Disposition: form-data; name="language"'))).toBe(true);
    expect(Boolean(bodyText.includes("audio-bytes"))).toBe(true);
  });

  test("posts a base64-wrapped multipart payload to /transcribe", async () => {
    let capturedRequest: RequestInit | null = null;
    const text = await transcribeDictationBlob(
      new Blob(["audio-bytes"], { type: "audio/webm" }),
      {
        fetchImpl: async (_url, init) => {
          capturedRequest = init ?? null;
          return new Response(JSON.stringify({ text: "transcribed text" }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          });
        },
      },
    );

    const request = capturedRequest as unknown as RequestInit;
    expect(text).toBe("transcribed text");
    expect(request.method).toBe("POST");
    expect((request.headers as Record<string, string>)["X-Codex-Base64"]).toBe("1");
    expect(Boolean((request.body as string).length > 0)).toBe(true);

    const decoded = atob(request.body as string);
    expect(Boolean(decoded.includes('Content-Disposition: form-data; name="file"; filename="codex.webm"'))).toBe(true);
  });

  test("encodes bytes using the same chunked base64 strategy", () => {
    const encoded = encodeDictationBase64(new Uint8Array([99, 111, 100, 101, 120]));
    expect(encoded).toBe("Y29kZXg=");
  });
});
