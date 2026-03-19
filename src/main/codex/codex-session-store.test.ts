import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CodexThreadSummary } from "../../shared/types";
import {
  hasCodexSessionMaterialized,
  readCodexSessionThreadDetail,
  resetCodexSessionStoreCaches,
} from "./codex-session-store";

function makeLink(threadId: string): CodexThreadSummary {
  return {
    threadId,
    projectId: "codex",
    cardId: "card-1",
    threadName: null,
    threadPreview: "",
    modelProvider: "openai",
    cwd: null,
    statusType: "idle",
    statusActiveFlags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    linkedAt: new Date(0).toISOString(),
  };
}

function withTempCodexHome(run: (codexHome: string) => void): void {
  const previousCodexHome = process.env.CODEX_HOME;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-session-store-"));
  process.env.CODEX_HOME = tempDir;
  resetCodexSessionStoreCaches();

  try {
    run(tempDir);
  } finally {
    if (previousCodexHome) {
      process.env.CODEX_HOME = previousCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }
    resetCodexSessionStoreCaches();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

afterEach(() => {
  resetCodexSessionStoreCaches();
});

describe("codex-session-store", () => {
  test("materializes modern jsonl sessions into thread detail", () => {
    withTempCodexHome((codexHome) => {
      fs.mkdirSync(path.join(codexHome, "sessions", "2026", "03", "17"), { recursive: true });
      fs.writeFileSync(
        path.join(codexHome, "session_index.jsonl"),
        JSON.stringify({
          id: "thr_session",
          thread_name: "Imported thread",
          updated_at: "2026-03-17T10:03:00.000Z",
        }) + "\n",
      );
      fs.writeFileSync(
        path.join(codexHome, "sessions", "2026", "03", "17", "rollout-2026-03-17T10-00-00-thr_session.jsonl"),
        [
          JSON.stringify({
            timestamp: "2026-03-17T10:00:00.000Z",
            type: "session_meta",
            payload: {
              id: "thr_session",
              timestamp: "2026-03-17T10:00:00.000Z",
              cwd: "/tmp/project",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-17T10:00:01.000Z",
            type: "event_msg",
            payload: {
              type: "task_started",
              turn_id: "turn_1",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-17T10:00:02.000Z",
            type: "event_msg",
            payload: {
              type: "user_message",
              message: "Implement it",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-17T10:00:03.000Z",
            type: "response_item",
            payload: {
              type: "function_call",
              call_id: "call_1",
              name: "exec_command",
              arguments: "{\"cmd\":\"ls\"}",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-17T10:00:04.000Z",
            type: "response_item",
            payload: {
              type: "function_call_output",
              call_id: "call_1",
              output: "{\"ok\":true}",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-17T10:00:05.000Z",
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                total_token_usage: {
                  total_tokens: 12,
                  input_tokens: 5,
                  cached_input_tokens: 1,
                  output_tokens: 6,
                  reasoning_output_tokens: 2,
                },
                last_token_usage: {
                  total_tokens: 12,
                  input_tokens: 5,
                  cached_input_tokens: 1,
                  output_tokens: 6,
                  reasoning_output_tokens: 2,
                },
                model_context_window: 200_000,
              },
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-17T10:00:06.000Z",
            type: "event_msg",
            payload: {
              type: "agent_message",
              message: "Done.",
            },
          }),
        ].join("\n"),
      );

      const detail = readCodexSessionThreadDetail({
        threadId: "thr_session",
        link: makeLink("thr_session"),
      });

      expect(hasCodexSessionMaterialized("thr_session")).toBeTrue();
      expect(detail?.threadName).toBe("Imported thread");
      expect(detail?.cwd).toBe("/tmp/project");
      expect(detail?.turns.length).toBe(1);
      expect(detail?.turns[0]?.turnId).toBe("turn_1");
      expect(detail?.turns[0]?.tokenUsage?.modelContextWindow).toBe(200_000);
      expect(detail?.transcript.length).toBe(3);
      expect(detail?.transcript[1]?.toolCall?.subtype).toBe("command");
      expect(detail?.transcript[1]?.toolCall?.result ? JSON.stringify(detail.transcript[1].toolCall?.result) : "").toBe(
        JSON.stringify({ ok: true }),
      );
      expect(detail?.threadPreview).toBe("Done.");
    });
  });

  test("keeps commentary and final-answer agent messages in modern jsonl sessions", () => {
    withTempCodexHome((codexHome) => {
      fs.mkdirSync(path.join(codexHome, "sessions", "2026", "03", "23"), { recursive: true });
      fs.writeFileSync(
        path.join(codexHome, "session_index.jsonl"),
        JSON.stringify({
          id: "thr_commentary",
          thread_name: "Commentary thread",
          updated_at: "2026-03-23T14:28:40.000Z",
        }) + "\n",
      );
      fs.writeFileSync(
        path.join(codexHome, "sessions", "2026", "03", "23", "rollout-2026-03-23T14-28-12-thr_commentary.jsonl"),
        [
          JSON.stringify({
            timestamp: "2026-03-23T14:28:12.000Z",
            type: "session_meta",
            payload: {
              id: "thr_commentary",
              timestamp: "2026-03-23T14:28:12.000Z",
              cwd: "/tmp/project",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-23T14:28:13.000Z",
            type: "event_msg",
            payload: {
              type: "task_started",
              turn_id: "turn_1",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-23T14:28:14.000Z",
            type: "event_msg",
            payload: {
              type: "user_message",
              message: "run bun test",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-23T14:28:15.000Z",
            type: "event_msg",
            payload: {
              type: "agent_message",
              phase: "commentary",
              message: "Running the test suite in the repo root.",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-23T14:28:16.000Z",
            type: "response_item",
            payload: {
              type: "function_call",
              call_id: "call_1",
              name: "exec_command",
              arguments: "{\"cmd\":\"bun test\"}",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-23T14:28:17.000Z",
            type: "event_msg",
            payload: {
              type: "agent_message",
              phase: "final_answer",
              message: "`bun test` passed.",
            },
          }),
        ].join("\n"),
      );

      const detail = readCodexSessionThreadDetail({
        threadId: "thr_commentary",
        link: makeLink("thr_commentary"),
      });

      expect(detail?.transcript.length).toBe(4);
      expect(detail?.transcript[0]?.kind).toBe("userMessage");
      expect(detail?.transcript[1]?.kind).toBe("assistantMessage");
      expect(detail?.transcript[1]?.assistantPhase).toBe("commentary");
      expect(detail?.transcript[2]?.kind).toBe("toolCall");
      expect(detail?.transcript[3]?.kind).toBe("assistantMessage");
      expect(detail?.transcript[3]?.assistantPhase).toBe("final_answer");
      expect(detail?.threadPreview).toBe("`bun test` passed.");
    });
  });

  test("projects replay reasoning from summary-first content and coalesces consecutive reasoning rows", () => {
    withTempCodexHome((codexHome) => {
      fs.mkdirSync(path.join(codexHome, "sessions", "2026", "03", "25"), { recursive: true });
      fs.writeFileSync(
        path.join(codexHome, "session_index.jsonl"),
        JSON.stringify({
          id: "thr_reasoning",
          thread_name: "Reasoning thread",
          updated_at: "2026-03-25T10:00:06.000Z",
        }) + "\n",
      );
      fs.writeFileSync(
        path.join(codexHome, "sessions", "2026", "03", "25", "rollout-2026-03-25T10-00-00-thr_reasoning.jsonl"),
        [
          JSON.stringify({
            timestamp: "2026-03-25T10:00:00.000Z",
            type: "session_meta",
            payload: {
              id: "thr_reasoning",
              timestamp: "2026-03-25T10:00:00.000Z",
              cwd: "/tmp/project",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-25T10:00:01.000Z",
            type: "event_msg",
            payload: {
              type: "task_started",
              turn_id: "turn_1",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-25T10:00:02.000Z",
            type: "response_item",
            payload: {
              type: "reasoning",
              summary: ["Investigating", "Checking thread state"],
              content: ["Private chain of thought body"],
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-25T10:00:03.000Z",
            type: "event_msg",
            payload: {
              type: "agent_reasoning",
              text: "Confirming the repro path.",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-25T10:00:04.000Z",
            type: "event_msg",
            payload: {
              type: "agent_message",
              phase: "final_answer",
              message: "Fixed.",
            },
          }),
        ].join("\n"),
      );

      const detail = readCodexSessionThreadDetail({
        threadId: "thr_reasoning",
        link: makeLink("thr_reasoning"),
      });

      expect(detail?.transcript.length).toBe(2);
      expect(detail?.transcript[0]?.kind).toBe("reasoning");
      expect(detail?.transcript[0]?.markdownText).toBe(
        "**Investigating**\n\nChecking thread state\n\nConfirming the repro path.",
      );
      expect(detail?.transcript[1]?.kind).toBe("assistantMessage");
    });
  });
});
