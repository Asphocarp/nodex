import { describe, expect, test } from "vitest";
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
      "automation_update",
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
    expect(tools.every((spec) => spec.type === "function")).toBe(true);

    const createThread = tools.find((spec) => spec.name === "create_thread");
    const readThread = tools.find((spec) => spec.name === "read_thread");
    const sendMessage = tools.find((spec) => spec.name === "send_message_to_thread");
    const automationUpdate = tools.find((spec) => spec.name === "automation_update");

    expect(JSON.stringify((createThread?.inputSchema as Record<string, unknown>).required)).toBe(JSON.stringify(["prompt", "target"]));
    expect(JSON.stringify((readThread?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}).includes("maxOutputCharsPerItem")).toBe(true);
    expect(JSON.stringify((sendMessage?.inputSchema as Record<string, unknown>).required)).toBe(JSON.stringify(["threadId", "prompt"]));
    const automationSchema = automationUpdate?.inputSchema as {
      anyOf?: Array<{
        properties?: Record<string, { enum?: string[] } | unknown>;
      }>;
    };
    const automationBranches = automationSchema.anyOf ?? [];
    const automationModes = [...new Set(automationBranches.flatMap((branch) => {
      const mode = branch.properties?.mode as { enum?: string[] } | undefined;
      return mode?.enum ?? [];
    }))].sort();
    const hasHeartbeatBranch = automationBranches.some((branch) => {
      const kind = branch.properties?.kind as { enum?: string[] } | undefined;
      return kind?.enum?.[0] === "heartbeat";
    });
    const hasSetupPathBranch = automationBranches.some((branch) => (
      branch.properties?.localEnvironmentConfigPath !== undefined
    ));

    expect(JSON.stringify(automationModes)).toBe(JSON.stringify([
      "create",
      "delete",
      "suggested_create",
      "suggested_update",
      "update",
      "view",
    ].sort()));
    expect(hasHeartbeatBranch).toBe(true);
    expect(hasSetupPathBranch).toBe(true);
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

    expect(success.success).toBe(true);
    expect(success.contentItems[0]?.type).toBe("inputText");
    expect(successText).toBe("{\"threadId\":\"thread-1\"}");
    expect(failure.success).toBe(false);
    expect(failureText).toBe("No Codex thread found");
  });
});
