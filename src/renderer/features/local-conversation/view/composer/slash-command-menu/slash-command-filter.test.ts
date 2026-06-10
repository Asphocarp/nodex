import { describe, expect, test } from "bun:test";
import {
  detectComposerSlashTrigger,
  filterComposerSlashCommands,
  resolveNextSlashHighlight,
  resolvePreservedSlashHighlight,
} from "./slash-command-filter";
import type { ComposerSlashCommand } from "./slash-command-types";

function command(input: Partial<ComposerSlashCommand> & { id: string; title: string }): ComposerSlashCommand {
  return {
    group: "Commands",
    icon: null,
    ...input,
  };
}

describe("composer slash command filtering", () => {
  test("detects a slash token at the cursor", () => {
    const trigger = detectComposerSlashTrigger({ text: "prefix /mo", cursor: "prefix /mo".length });

    expect(trigger.active).toBeTrue();
    expect(trigger.query).toBe("mo");
    expect(trigger.from).toBe(7);
    expect(trigger.to).toBe(10);
  });

  test("rejects slash tokens after another slash or after cursor drift", () => {
    expect(detectComposerSlashTrigger({ text: "http://x", cursor: "http://x".length }).active).toBeFalse();
    expect(detectComposerSlashTrigger({ text: "/model later", cursor: "/model later".length }).active).toBeFalse();
  });

  test("applies empty-composer gating and fuzzy matching", () => {
    const matches = filterComposerSlashCommands({
      query: "mdl",
      composerText: "/mdl",
      commands: [
        command({ id: "model", title: "Model", requiresEmptyComposer: true }),
        command({ id: "side", title: "Side", requiresEmptyComposer: true }),
        command({ id: "skill:browser", title: "Browser Use" }),
      ],
    });

    expect(matches.length).toBe(1);
    expect(matches[0]?.command.id).toBe("model");
  });

  test("hides empty-only commands for non-empty composer text", () => {
    const matches = filterComposerSlashCommands({
      query: "",
      composerText: "ask /",
      commands: [
        command({ id: "compact", title: "Compact", requiresEmptyComposer: true }),
        command({ id: "skill:browser", title: "Browser Use" }),
      ],
    });

    expect(matches.length).toBe(1);
    expect(matches[0]?.command.id).toBe("skill:browser");
  });

  test("wraps keyboard highlight through visible matches", () => {
    const matches = [
      { command: command({ id: "compact", title: "Compact" }), score: 1, matchedTitleIndexes: [] },
      { command: command({ id: "model", title: "Model" }), score: 1, matchedTitleIndexes: [] },
    ];

    expect(resolveNextSlashHighlight({ matches, currentCommandId: null, direction: "first" })).toBe("compact");
    expect(resolveNextSlashHighlight({ matches, currentCommandId: "compact", direction: "next" })).toBe("model");
    expect(resolveNextSlashHighlight({ matches, currentCommandId: "compact", direction: "previous" })).toBe("model");
  });

  test("preserves the highlighted row across equivalent item updates", () => {
    const matches = [
      { command: command({ id: "compact", title: "Compact" }), score: 1, matchedTitleIndexes: [] },
      { command: command({ id: "model", title: "Model" }), score: 1, matchedTitleIndexes: [] },
    ];
    const updatedMatches = [
      { command: command({ id: "compact", title: "Compact" }), score: 1, matchedTitleIndexes: [] },
      { command: command({ id: "model", title: "Model" }), score: 1, matchedTitleIndexes: [] },
    ];

    expect(resolvePreservedSlashHighlight({ matches, currentCommandId: null })).toBe("compact");
    expect(resolvePreservedSlashHighlight({ matches: updatedMatches, currentCommandId: "model" })).toBe("model");
    expect(resolvePreservedSlashHighlight({ matches, currentCommandId: "missing" })).toBe("compact");
  });
});
