import { describe, expect, test, vi } from "vitest";
import {
  prepareCodexPrompt,
  splitCodexPromptAgentConfigLines,
} from "./codex-prompt-preparation";

describe("Codex prompt preparation", () => {
  test("compiles one exact input for optimistic state and transport", async () => {
    const resolveImageInput = vi.fn(async (source: string) => ({
      type: "localImage" as const,
      path: `/resolved/${source.split("/").at(-1)}`,
    }));
    const prepared = await prepareCodexPrompt("ignored fallback", {
      text: "ship the fix",
      textAttachments: [{ text: "pasted context" }],
      fileAttachments: [{
        label: "store.ts",
        path: "src/store.ts",
        fsPath: "/workspace/src/store.ts",
      }],
      addedFiles: [{
        label: "store.ts duplicate",
        path: "src/store.ts",
        fsPath: "/workspace/src/store.ts",
      }],
      images: [{ source: "nodex://assets/diagram.png" }],
      skills: [{ name: "feature-dev", path: "/skills/feature-dev" }],
      commentAttachments: [{
        id: "comment-1",
        type: "comment",
        content: [{ content_type: "text", text: "Keep the identity stable" }],
        position: { side: "right", path: "src/store.ts", line: 42 },
        createdAt: 1,
      }],
    }, { resolveImageInput });

    expect(resolveImageInput).toHaveBeenCalledWith("nodex://assets/diagram.png");
    expect(prepared.inputItems.map((item) => item.type)).toEqual([
      "text",
      "text",
      "text",
      "localImage",
      "mention",
      "skill",
    ]);
    expect(prepared.inputItems.filter((item) => item.type === "mention")).toEqual([{
      type: "mention",
      name: "store.ts",
      path: "src/store.ts",
    }]);
    expect(prepared.additionalContext?.["review-diff-comments"]?.kind).toBe("application");
    expect(prepared.pendingInputItems.map((item) => item.type)).toEqual([
      "text",
      "text",
      "localImage",
      "skill",
    ]);
  });

  test("extracts inline agent config without sending it as prompt text", () => {
    const parsed = splitCodexPromptAgentConfigLines([
      "Investigate the owner path",
      '<agent-config mode="plan" model="gpt-test" reasoning="high" />',
    ].join("\n"));

    expect(parsed.text).toBe("Investigate the owner path");
    expect(parsed.agentConfigs).toEqual([{
      mode: "plan",
      model: "gpt-test",
      reasoning: "high",
    }]);
  });
});
