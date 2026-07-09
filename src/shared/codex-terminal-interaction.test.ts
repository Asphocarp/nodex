import { describe, expect, test } from "vitest";

import {
  getTerminalInteractionBufferKey,
  parseTerminalInteractionInput,
} from "./codex-terminal-interaction";

interface TerminalInteractionIdentity {
  conversationId: string;
  turnId: string;
  itemId: string;
  processId: string;
}

function getBufferKey(identity: TerminalInteractionIdentity): string {
  return getTerminalInteractionBufferKey(identity.conversationId, identity.itemId);
}

describe("Codex terminal interaction input", () => {
  test("keys residual input by conversation and item independent of turn and process", () => {
    const first = getBufferKey({
      conversationId: "conversation-1",
      turnId: "turn-1",
      itemId: "command-1",
      processId: "100",
    });
    const second = getBufferKey({
      conversationId: "conversation-1",
      turnId: "turn-2",
      itemId: "command-1",
      processId: "200",
    });

    expect(first).toBe("conversation-1:command-1");
    expect(second).toBe(first);
  });

  test("carries fragmented residual input across parser calls", () => {
    const first = parseTerminalInteractionInput("", "ec");
    const second = parseTerminalInteractionInput(first.inputBuffer, "ho");
    const third = parseTerminalInteractionInput(second.inputBuffer, " hello\rnext");

    expect(JSON.stringify(first.commands)).toBe("[]");
    expect(first.inputBuffer).toBe("ec");
    expect(JSON.stringify(second.commands)).toBe("[]");
    expect(second.inputBuffer).toBe("echo");
    expect(JSON.stringify(third.commands)).toBe('["echo hello"]');
    expect(third.inputBuffer).toBe("next");
  });

  test("submits on CR and LF and submits CRLF exactly once", () => {
    const parsed = parseTerminalInteractionInput("", "carriage\rline\npaired\r\n");

    expect(JSON.stringify(parsed.commands)).toBe('["carriage","line","paired"]');
    expect(parsed.inputBuffer).toBe("");
  });

  test("trims submitted commands and drops blank submissions", () => {
    const parsed = parseTerminalInteractionInput("  ", "\r \t \n  git status  \r\n");

    expect(JSON.stringify(parsed.commands)).toBe('["git status"]');
    expect(parsed.inputBuffer).toBe("");
  });

  test("emits multiple commands in input order and retains the trailing fragment", () => {
    const parsed = parseTerminalInteractionInput("", "first\rsecond\n third \rfourth");

    expect(JSON.stringify(parsed.commands)).toBe('["first","second","third"]');
    expect(parsed.inputBuffer).toBe("fourth");
  });

  test("ETX clears the residual without submitting it", () => {
    const parsed = parseTerminalInteractionInput(
      "discard-existing",
      "\u0003keep-this\rdiscard-fragment\u0003tail",
    );

    expect(JSON.stringify(parsed.commands)).toBe('["keep-this"]');
    expect(parsed.inputBuffer).toBe("tail");
  });

  test("backspace and DEL each remove one JavaScript UTF-16 code unit", () => {
    const backspaceAscii = parseTerminalInteractionInput("abc", "\b");
    const deleteAscii = parseTerminalInteractionInput("abc", "\u007f");
    const backspaceSurrogate = parseTerminalInteractionInput("😀", "\b");
    const deleteSurrogate = parseTerminalInteractionInput("😀", "\u007f");

    expect(backspaceAscii.inputBuffer).toBe("ab");
    expect(deleteAscii.inputBuffer).toBe("ab");
    expect(backspaceSurrogate.inputBuffer).toBe("\ud83d");
    expect(deleteSurrogate.inputBuffer).toBe("\ud83d");
  });

  test("preserves incomplete input when no control character arrives", () => {
    const parsed = parseTerminalInteractionInput("prefix-", "suffix");
    const unchanged = parseTerminalInteractionInput(parsed.inputBuffer, "");

    expect(JSON.stringify(parsed.commands)).toBe("[]");
    expect(parsed.inputBuffer).toBe("prefix-suffix");
    expect(JSON.stringify(unchanged.commands)).toBe("[]");
    expect(unchanged.inputBuffer).toBe("prefix-suffix");
  });
});
