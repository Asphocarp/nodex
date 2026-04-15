import { describe, expect, test } from "bun:test";

import { copyImageToClipboardWithInvoke } from "./copy-image";

describe("copy image helper", () => {
  test("invokes the native clipboard image channel with the raw source", async () => {
    const invokeCalls: unknown[][] = [];
    const result = await copyImageToClipboardWithInvoke(
      "nodex://assets/diagram.png",
      async (...args: unknown[]) => {
        invokeCalls.push(args);
        return { ok: true };
      },
    );

    expect(result.ok).toBeTrue();
    expect(JSON.stringify(invokeCalls)).toBe(JSON.stringify([
      ["clipboard:write-image", { source: "nodex://assets/diagram.png" }],
    ]));
  });

  test("returns the structured failure result from the native clipboard path", async () => {
    const result = await copyImageToClipboardWithInvoke(
      "https://example.com/image.png",
      async () => ({ ok: false, message: "Could not load the image file." }),
    );

    expect(result.ok).toBeFalse();
    expect("message" in result ? result.message : "").toBe("Could not load the image file.");
  });

  test("normalizes unexpected invoke failures to a user-facing copy error", async () => {
    const result = await copyImageToClipboardWithInvoke(
      "nodex://assets/diagram.png",
      async () => {
        throw new Error("boom");
      },
    );

    expect(result.ok).toBeFalse();
    expect("message" in result ? result.message : "").toBe("boom");
  });
});
