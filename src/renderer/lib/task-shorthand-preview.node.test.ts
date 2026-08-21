import { describe, expect, it } from "vite-plus/test";
import fixtures from "../../shared/fixtures/task-shorthand-v1-conformance.json";
import { previewTaskShorthand } from "./task-shorthand-preview";

describe("task shorthand preview", () => {
  it.each(fixtures)("keeps preview grammar aligned for $title", (fixture) => {
    const result = previewTaskShorthand(fixture.title);
    expect(Boolean(result)).toBe(fixture.match);
    if (!fixture.match || !result) return;
    expect(result).toMatchObject({
      priority: fixture.priority,
      estimate: fixture.estimate,
      tags: fixture.tags,
      title: fixture.rewrittenTitle,
    });
  });
});
