import { describe, expect, test } from "vitest";
import {
  buildCodexDelegationInput,
  buildCodexDelegationText,
  parseCodexDelegationText,
} from "./codex-delegation";

describe("Codex delegation envelope", () => {
  test("serializes the exact one-item XML envelope and escapes protocol fields", () => {
    const input = buildCodexDelegationInput({
      sourceThreadId: "thread<&>",
      input: "Compare a < b && b > c",
    });

    expect(JSON.stringify(input)).toBe(
      JSON.stringify([
        {
          type: "text",
          text: [
            "<codex_delegation>",
            "  <source_thread_id>thread&lt;&amp;&gt;</source_thread_id>",
            "  <input>Compare a &lt; b &amp;&amp; b &gt; c</input>",
            "</codex_delegation>",
          ].join("\n"),
          text_elements: [],
        },
      ]),
    );
  });

  test("round-trips multiline delegated input", () => {
    const payload = {
      sourceThreadId: "thread-1",
      input: "First line\n<second>& final",
    };
    expect(JSON.stringify(parseCodexDelegationText(buildCodexDelegationText(payload)))).toBe(
      JSON.stringify(payload),
    );
  });

  test("rejects partial envelopes and envelopes missing either field", () => {
    expect(parseCodexDelegationText("prefix <codex_delegation></codex_delegation>")).toBe(null);
    expect(
      parseCodexDelegationText(
        [
          "<codex_delegation>",
          "<source_thread_id>thread-1</source_thread_id>",
          "</codex_delegation>",
        ].join("\n"),
      ),
    ).toBe(null);
  });
});
