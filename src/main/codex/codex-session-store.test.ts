import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CodexThreadSummary } from "../../shared/types";
import { CodexSessionStore } from "./codex-session-store";

let sessionStore: CodexSessionStore;

beforeEach(() => {
  sessionStore = new CodexSessionStore();
});

const hasCodexSessionMaterialized = (threadId: string, codexHome?: string) =>
  sessionStore.hasMaterialized(threadId, codexHome);
const readCodexSessionThreadDetail = (
  input: Parameters<CodexSessionStore["readThreadDetail"]>[0],
) => sessionStore.readThreadDetail(input);
const readCodexSessionThreadMetadata = (threadId: string, codexHome?: string) =>
  sessionStore.readThreadMetadata(threadId, codexHome);
const resetCodexSessionStoreCaches = () => sessionStore.clear();

function makeLink(threadId: string): CodexThreadSummary {
  return {
    threadId,
    projectId: "codex",
    source: null,
    threadName: null,
    threadPreview: "",
    modelProvider: "openai",
    cwd: null,
    statusType: "idle",
    statusActiveFlags: [],
    hasUnreadTurn: false,
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    linkedAt: new Date(0).toISOString(),
  };
}

function withTempCodexHome(run: (codexHome: string) => void): void {
  const previousInterpreterHome = process.env.INTERPRETER_HOME;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-session-store-"));
  process.env.INTERPRETER_HOME = tempDir;
  resetCodexSessionStoreCaches();

  try {
    run(tempDir);
  } finally {
    if (previousInterpreterHome) {
      process.env.INTERPRETER_HOME = previousInterpreterHome;
    } else {
      delete process.env.INTERPRETER_HOME;
    }
    resetCodexSessionStoreCaches();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

afterEach(() => {
  resetCodexSessionStoreCaches();
});

describe("codex-session-store", () => {
  test("does not retain a missing rollout after it materializes", () => {
    withTempCodexHome((codexHome) => {
      expect(hasCodexSessionMaterialized("thr_late")).toBe(false);
      const directory = path.join(codexHome, "sessions", "2026", "08", "22");
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, "rollout-2026-08-22-thr_late.jsonl"), "{}\n");

      expect(hasCodexSessionMaterialized("thr_late")).toBe(true);
    });
  });

  test("reads session metadata without materializing transcript history", () => {
    withTempCodexHome((codexHome) => {
      fs.mkdirSync(path.join(codexHome, "sessions", "2026", "07", "06"), { recursive: true });
      fs.writeFileSync(
        path.join(
          codexHome,
          "sessions",
          "2026",
          "07",
          "06",
          "rollout-2026-07-06T18-08-45-thr_reviewer.jsonl",
        ),
        [
          JSON.stringify({
            timestamp: "2026-07-06T10:10:30.000Z",
            type: "session_meta",
            payload: {
              id: "thr_reviewer",
              parent_thread_id: "thr_parent",
              source: {
                subagent: {
                  other: "guardian",
                },
              },
              thread_source: "subagent",
              cwd: "/tmp/codex",
            },
          }),
          JSON.stringify({
            timestamp: "2026-07-06T10:10:31.000Z",
            type: "event_msg",
            payload: {
              type: "user_message",
              message: "The following is the Codex agent history...",
            },
          }),
        ].join("\n"),
      );

      const metadata = readCodexSessionThreadMetadata("thr_reviewer");
      const source = metadata?.source as { subagent?: { other?: string } } | null | undefined;

      expect(metadata?.threadId).toBe("thr_reviewer");
      expect(metadata?.parentThreadId).toBe("thr_parent");
      expect(metadata?.threadSource).toBe("subagent");
      expect(metadata?.cwd).toBe("/tmp/codex");
      expect(source?.subagent?.other).toBe("guardian");
    });
  });

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
        path.join(
          codexHome,
          "sessions",
          "2026",
          "03",
          "17",
          "rollout-2026-03-17T10-00-00-thr_session.jsonl",
        ),
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
              arguments: '{"cmd":"ls"}',
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-17T10:00:04.000Z",
            type: "response_item",
            payload: {
              type: "function_call_output",
              call_id: "call_1",
              output: '{"ok":true}',
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

      expect(hasCodexSessionMaterialized("thr_session")).toBe(true);
      expect(detail?.threadName).toBe("Imported thread");
      expect(detail?.cwd).toBe("/tmp/project");
      expect(detail?.turns.length).toBe(1);
      expect(detail?.turns[0]?.turnId).toBe("turn_1");
      expect(detail?.turns[0]?.tokenUsage?.modelContextWindow).toBe(200_000);
      expect(detail?.transcript.length).toBe(2);
      expect(detail?.transcript.some((entry) => entry.kind === "toolCall")).toBe(false);
      expect(detail?.threadPreview).toBe("Implement it");

      fs.writeFileSync(
        path.join(codexHome, "session_index.jsonl"),
        `${JSON.stringify({
          id: "thr_session",
          thread_name: "Updated imported thread",
          updated_at: "2026-03-17T10:04:00.000Z",
        })}\n`,
      );
      expect(
        readCodexSessionThreadDetail({
          threadId: "thr_session",
          link: makeLink("thr_session"),
        })?.threadName,
      ).toBe("Updated imported thread");
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
        path.join(
          codexHome,
          "sessions",
          "2026",
          "03",
          "23",
          "rollout-2026-03-23T14-28-12-thr_commentary.jsonl",
        ),
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
              arguments: '{"cmd":"bun test"}',
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

      expect(detail?.transcript.length).toBe(3);
      expect(detail?.transcript[0]?.kind).toBe("userMessage");
      expect(detail?.transcript[1]?.kind).toBe("assistantMessage");
      expect(detail?.transcript[1]?.assistantPhase).toBe("commentary");
      expect(detail?.transcript[2]?.kind).toBe("assistantMessage");
      expect(detail?.transcript[2]?.assistantPhase).toBe("final_answer");
      expect(detail?.threadPreview).toBe("run bun test");
    });
  });

  test("replays context compaction from compacted session lines and advances to the post-compaction turn context", () => {
    withTempCodexHome((codexHome) => {
      fs.mkdirSync(path.join(codexHome, "sessions", "2026", "03", "26"), { recursive: true });
      fs.writeFileSync(
        path.join(codexHome, "session_index.jsonl"),
        JSON.stringify({
          id: "thr_compaction_replay",
          thread_name: "Compaction replay thread",
          updated_at: "2026-03-26T09:00:08.000Z",
        }) + "\n",
      );
      fs.writeFileSync(
        path.join(
          codexHome,
          "sessions",
          "2026",
          "03",
          "26",
          "rollout-2026-03-26T09-00-00-thr_compaction_replay.jsonl",
        ),
        [
          JSON.stringify({
            timestamp: "2026-03-26T09:00:00.000Z",
            type: "session_meta",
            payload: {
              id: "thr_compaction_replay",
              timestamp: "2026-03-26T09:00:00.000Z",
              cwd: "/tmp/pre-compact",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-26T09:00:01.000Z",
            type: "event_msg",
            payload: {
              type: "task_started",
              turn_id: "turn_before_compaction",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-26T09:00:02.000Z",
            type: "event_msg",
            payload: {
              type: "user_message",
              message: "Summarize the repo",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-26T09:00:03.000Z",
            type: "event_msg",
            payload: {
              type: "agent_message",
              message: "Working through the repo structure.",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-26T09:00:04.000Z",
            type: "compacted",
            payload: {
              message: "",
              replacement_history: [],
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-26T09:00:04.100Z",
            type: "event_msg",
            payload: {
              type: "context_compacted",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-26T09:00:05.000Z",
            type: "turn_context",
            payload: {
              turn_id: "turn_after_compaction",
              cwd: "/tmp/post-compact",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-26T09:00:06.000Z",
            type: "event_msg",
            payload: {
              type: "user_message",
              message: "Continue with the implementation",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-26T09:00:07.000Z",
            type: "event_msg",
            payload: {
              type: "agent_message",
              message: "Implementation resumed after compaction.",
            },
          }),
        ].join("\n"),
      );

      const detail = readCodexSessionThreadDetail({
        threadId: "thr_compaction_replay",
        link: makeLink("thr_compaction_replay"),
      });

      expect(detail?.cwd).toBe("/tmp/post-compact");
      expect(detail?.turns.length).toBe(2);
      expect(detail?.turns[0]?.turnId).toBe("turn_before_compaction");
      expect(detail?.turns[1]?.turnId).toBe("turn_after_compaction");
      expect(detail?.transcript.length).toBe(5);
      expect(detail?.transcript[2]?.semanticKind).toBe("contextCompaction");
      expect(detail?.transcript[2]?.markdownText).toBe("Context automatically compacted");
      expect(detail?.transcript[3]?.turnId).toBe("turn_after_compaction");
      expect(detail?.transcript[3]?.markdownText).toBe("Continue with the implementation");
      expect(detail?.transcript[4]?.turnId).toBe("turn_after_compaction");
      expect(detail?.threadPreview).toBe("Summarize the repo");
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
        path.join(
          codexHome,
          "sessions",
          "2026",
          "03",
          "25",
          "rollout-2026-03-25T10-00-00-thr_reasoning.jsonl",
        ),
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
