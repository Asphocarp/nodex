import { describe, expect, test, vi } from "vitest";
import {
  prepareCodexPrompt,
  splitCodexPromptAgentConfigLines,
} from "./codex-prompt-preparation";

describe("Codex prompt preparation", () => {
  test("keeps pasted text as a bounded sidecar until the main command boundary", async () => {
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
      browserAnnotationAttachments: [{
        schemaVersion: 1,
        id: "browser-comment-1",
        browserTabId: "browser-tab-1",
        createdAt: 2,
        note: "Make this action more prominent",
        pageTitle: "Checkout",
        pageUrl: "https://example.com/checkout",
        anchors: [{
          id: "anchor-1",
          kind: "element",
          pageUrl: "https://example.com/checkout",
          selector: "main > button",
          rect: { x: 40, y: 80, width: 120, height: 32 },
        }],
        evidence: {
          attachmentId: "browser-evidence.png",
          source: "nodex://assets/browser-evidence.png",
          mimeType: "image/png",
          width: 168,
          height: 80,
        },
      }],
    }, { resolveImageInput });

    expect(resolveImageInput).toHaveBeenCalledWith("nodex://assets/diagram.png");
    expect(resolveImageInput).toHaveBeenCalledWith(
      "nodex://assets/browser-evidence.png",
    );
    expect(prepared.inputItems.map((item) => item.type)).toEqual([
      "text",
      "text",
      "text",
      "localImage",
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
    expect(prepared.additionalContext?.["browser-annotations"]?.kind).toBe("application");
    expect(prepared.pendingInputItems.map((item) => item.type)).toEqual([
      "text",
      "text",
      "text",
      "localImage",
      "localImage",
      "skill",
    ]);
    expect(prepared.pastedTextAttachments).toEqual([{ text: "pasted context" }]);
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
