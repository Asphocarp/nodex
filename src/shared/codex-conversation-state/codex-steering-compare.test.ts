import { describe, expect, test } from "vite-plus/test";
import type { UserInput } from "@nodex/codex-app-server-protocol/v2";
import {
  buildCodexSteeringCompareKey,
  serializeCodexSteeringCompareKey,
} from "./codex-steering-compare";

describe("Codex steering compare key", () => {
  test("excludes serialized comment labels and image placeholders without live attachments", () => {
    const serializedPrompt = [
      "",
      "# Browser comments:",
      "## Comment 1",
      "File: browser:fixture",
      "Lines: 7",
      "Attached image: 1 additional labeled image for Comment 1",
      "",
      "## My request for Codex:",
      "steer fixture",
    ].join("\n");
    const label =
      "The next image was attached by the user as additional visual context for Comment 7.";
    const input = [
      { type: "text", text: serializedPrompt, text_elements: [] },
      { type: "text", text: label, text_elements: [] },
      { type: "text", text: "<image>", text_elements: [] },
      { type: "localImage", path: "/tmp/serialized-comment.png" },
      { type: "text", text: "</image>", text_elements: [] },
    ] satisfies readonly UserInput[];

    const compareKey = buildCodexSteeringCompareKey(input);

    expect(compareKey.rawText).toBe(serializedPrompt);
    expect(compareKey.imageCount).toBe(1);
  });

  test("serializes only the exact text and image subset", () => {
    const first = [
      { type: "text", text: "same", text_elements: [] },
      { type: "mention", name: "one", path: "/one" },
      { type: "localImage", path: "/tmp/one.png" },
    ] satisfies readonly UserInput[];
    const second = [
      { type: "text", text: "same", text_elements: [] },
      { type: "mention", name: "two", path: "/two" },
      { type: "localImage", path: "/tmp/two.png" },
    ] satisfies readonly UserInput[];

    expect(serializeCodexSteeringCompareKey(first)).toBe(serializeCodexSteeringCompareKey(second));
  });
});
