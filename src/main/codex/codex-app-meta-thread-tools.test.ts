import { describe, expect, test } from "bun:test";
import {
  buildCodexAppDynamicToolFailure,
  buildCodexAppDynamicToolSuccess,
  buildCodexAppMetaThreadToolSpecs,
} from "./codex-app-meta-thread-tools";

describe("codex app meta thread tool specs", () => {
  test("advertises the Codex app meta thread tools in the codex_app namespace", () => {
    const specs = buildCodexAppMetaThreadToolSpecs();
    const namespace = specs[0];
    const tools = namespace?.type === "namespace" ? namespace.tools : [];
    const toolNames = tools.map((spec) => spec.name).sort();

    expect(specs.length).toBe(1);
    expect(namespace?.type).toBe("namespace");
    expect(namespace?.name).toBe("codex_app");
    expect(JSON.stringify(toolNames)).toBe(JSON.stringify([
      "create_thread",
      "fork_thread",
      "get_handoff_status",
      "handoff_thread",
      "list_projects",
      "list_threads",
      "read_thread",
      "read_thread_terminal",
      "send_message_to_thread",
      "set_thread_archived",
      "set_thread_pinned",
      "set_thread_title",
    ].sort()));
    expect(tools.every((spec) => spec.type === "function")).toBeTrue();

    const createThread = tools.find((spec) => spec.name === "create_thread");
    const readThread = tools.find((spec) => spec.name === "read_thread");
    const sendMessage = tools.find((spec) => spec.name === "send_message_to_thread");

    expect(JSON.stringify((createThread?.inputSchema as Record<string, unknown>).required)).toBe(JSON.stringify(["prompt", "target"]));
    expect(JSON.stringify((readThread?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}).includes("maxOutputCharsPerItem")).toBeTrue();
    expect(JSON.stringify((sendMessage?.inputSchema as Record<string, unknown>).required)).toBe(JSON.stringify(["threadId", "prompt"]));
  });

  test("wraps dynamic tool responses in app-server content items", () => {
    const success = buildCodexAppDynamicToolSuccess({ threadId: "thread-1" });
    const failure = buildCodexAppDynamicToolFailure("No Codex thread found");
    const successText = success.contentItems[0]?.type === "inputText"
      ? success.contentItems[0].text
      : null;
    const failureText = failure.contentItems[0]?.type === "inputText"
      ? failure.contentItems[0].text
      : null;

    expect(success.success).toBeTrue();
    expect(success.contentItems[0]?.type).toBe("inputText");
    expect(successText).toBe("{\"threadId\":\"thread-1\"}");
    expect(failure.success).toBeFalse();
    expect(failureText).toBe("No Codex thread found");
  });
});
