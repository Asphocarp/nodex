import { describe, expect, test } from "vitest";
import {
  detectComposerSlashTrigger,
  filterComposerSlashCommands,
  resolveComposerSlashHighlight,
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

    expect(trigger.active).toBe(true);
    expect(trigger.trigger).toBe("/");
    expect(trigger.query).toBe("mo");
    expect(trigger.from).toBe(7);
    expect(trigger.to).toBe(10);
  });

  test("detects an at-command token at the cursor", () => {
    const trigger = detectComposerSlashTrigger({ text: "ask @go", cursor: "ask @go".length });

    expect(trigger.active).toBe(true);
    expect(trigger.trigger).toBe("@");
    expect(trigger.query).toBe("go");
    expect(trigger.from).toBe(4);
    expect(trigger.to).toBe(7);
  });

  test("rejects command tokens after another slash, email text, or cursor drift", () => {
    expect(detectComposerSlashTrigger({ text: "http://x", cursor: "http://x".length }).active).toBe(false);
    expect(detectComposerSlashTrigger({ text: "email@example.com", cursor: "email@example.com".length }).active).toBe(false);
    expect(detectComposerSlashTrigger({ text: "/model later", cursor: "/model later".length }).active).toBe(false);
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

  test("uses trigger eligibility and keeps goal visible in non-empty composer text", () => {
    const matches = filterComposerSlashCommands({
      query: "go",
      trigger: "@",
      composerText: "ask @go",
      commands: [
        command({ id: "compact", title: "Compact", requiresEmptyComposer: true }),
        command({ id: "model", title: "Model" }),
        command({ id: "goal", title: "Goal", requiresEmptyComposer: false, triggers: ["/", "@"] }),
      ],
    });

    expect(matches.length).toBe(1);
    expect(matches[0]?.command.id).toBe("goal");
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
    expect(resolveComposerSlashHighlight({
      matches: updatedMatches,
      intent: { commandId: "model", source: "pointer" },
    })).toEqual({ commandId: "model", source: "pointer" });
    expect(resolveComposerSlashHighlight({
      matches,
      intent: { commandId: "missing", source: "pointer" },
    })).toEqual({ commandId: "compact", source: "programmatic" });
  });
});
