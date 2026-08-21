import { describe, expect, test } from "vite-plus/test";
import { resolveCodexThreadMaterializationOwner } from "./codex-thread-materialization-owner";

describe("resolveCodexThreadMaterializationOwner", () => {
  test("preserves a durable Project owner over explicit and inferred fallbacks", () => {
    expect(
      resolveCodexThreadMaterializationOwner({
        existingThreadFound: true,
        existingProjectId: "project:durable",
        explicitInitialOwnerProvided: true,
        explicitInitialProjectId: "project:explicit",
        inferredInitialProjectId: "project:inferred",
      }),
    ).toBe("project:durable");
  });

  test("preserves an explicit durable Projectless owner", () => {
    expect(
      resolveCodexThreadMaterializationOwner({
        existingThreadFound: true,
        existingProjectId: null,
        explicitInitialOwnerProvided: false,
        explicitInitialProjectId: null,
        inferredInitialProjectId: "project:inferred",
      }),
    ).toBeNull();
  });

  test("uses an explicit initial owner before cwd inference", () => {
    expect(
      resolveCodexThreadMaterializationOwner({
        existingThreadFound: false,
        existingProjectId: null,
        explicitInitialOwnerProvided: true,
        explicitInitialProjectId: null,
        inferredInitialProjectId: "project:inferred",
      }),
    ).toBeNull();
  });

  test("uses cwd inference only for a new Thread without an explicit owner", () => {
    expect(
      resolveCodexThreadMaterializationOwner({
        existingThreadFound: false,
        existingProjectId: null,
        explicitInitialOwnerProvided: false,
        explicitInitialProjectId: null,
        inferredInitialProjectId: "project:inferred",
      }),
    ).toBe("project:inferred");
  });
});
