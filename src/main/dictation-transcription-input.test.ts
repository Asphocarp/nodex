import { describe, expect, test } from "vitest";
import { validateDictationTranscriptionInput } from "./dictation-transcription-input";

describe("validateDictationTranscriptionInput", () => {
  test("accepts a bounded base64 multipart envelope and trims its content type", () => {
    expect(
      validateDictationTranscriptionInput({
        contentType: " multipart/form-data; boundary=nodex-test ",
        base64Payload: "YXVkaW8=",
      }),
    ).toEqual({
      contentType: "multipart/form-data; boundary=nodex-test",
      base64Payload: "YXVkaW8=",
    });
  });

  test.each([
    null,
    {},
    { contentType: "audio/webm", base64Payload: "YXVkaW8=" },
    { contentType: "multipart/form-data", base64Payload: "YXVkaW8=" },
    { contentType: "multipart/form-data; boundary=x", base64Payload: "" },
    { contentType: "multipart/form-data; boundary=x", base64Payload: "not base64" },
    { contentType: "multipart/form-data; boundary=x", base64Payload: "abc" },
  ])("rejects an invalid envelope: %o", (input) => {
    expect(() => validateDictationTranscriptionInput(input)).toThrow();
  });

  test("enforces the encoded payload byte budget", () => {
    expect(() =>
      validateDictationTranscriptionInput(
        {
          contentType: "multipart/form-data; boundary=x",
          base64Payload: "YXVkaW8=",
        },
        7,
      ),
    ).toThrow("oversized");
  });
});
