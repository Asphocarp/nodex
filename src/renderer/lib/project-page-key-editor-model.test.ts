import { describe, expect, test } from "vitest";

import type { DatabasePageKeyNamespaceV2 } from "../../shared/database-module-v2";
import { projectPageKeyEditorModel } from "./project-page-key-editor-model";

type ModelInput = Parameters<typeof projectPageKeyEditorModel>[0];

const settings = (
  overrides: Partial<DatabasePageKeyNamespaceV2> = {},
): DatabasePageKeyNamespaceV2 => ({
  databaseId: "database:test" as never,
  currentPrefix: "LAB",
  nextNumber: 8,
  assignedPageCount: 7,
  revision: 2,
  retiredPrefixes: [],
  ...overrides,
});

describe("Project Page-key editor model", () => {
  const cases: Array<{
    readonly name: string;
    readonly input: ModelInput;
    readonly canSubmit: boolean;
    readonly summary: string;
  }> = [
    {
      name: "confirmed automatic create",
      input: {
        mode: "create" as const,
        expanded: false,
        draftPrefix: "LAB",
        preview: {
          kind: "available" as const,
          prefix: "LAB",
          availability: "available" as const,
          alternativePrefix: null,
          nextNumber: 1,
          exampleKeys: ["LAB-1", "LAB-2"],
        },
        settingsStatus: "idle" as const,
      },
      canSubmit: true,
      summary: "Page keys · LAB-1, LAB-2, …",
    },
    {
      name: "invalid manual create",
      input: {
        mode: "create" as const,
        expanded: true,
        draftPrefix: "1",
        preview: { kind: "local" as const, prefix: "1" },
        settingsStatus: "idle" as const,
      },
      canSubmit: false,
      summary: "Page keys · Checking…",
    },
    {
      name: "pending create",
      input: {
        mode: "create" as const,
        expanded: true,
        draftPrefix: "LAB",
        preview: { kind: "checking" as const, prefix: "LAB" },
        settingsStatus: "idle" as const,
      },
      canSubmit: false,
      summary: "Page keys · Checking…",
    },
    {
      name: "reserved create",
      input: {
        mode: "create" as const,
        expanded: true,
        draftPrefix: "LAB",
        preview: {
          kind: "reserved" as const,
          prefix: "LAB",
          availability: "reserved" as const,
          alternativePrefix: "LAB2",
          nextNumber: 1,
          exampleKeys: ["LAB-1", "LAB-2"],
        },
        settingsStatus: "idle" as const,
      },
      canSubmit: false,
      summary: "Page keys · LAB-1, LAB-2, …",
    },
  ];

  test.each(cases)("derives $name", ({ input, canSubmit, summary }) => {
    const model = projectPageKeyEditorModel(input);
    expect(model.canSubmit).toBe(canSubmit);
    expect(model.summary).toBe(summary);
  });

  test("explains unused and used renames from authority settings", () => {
    const preview = {
      kind: "available" as const,
      prefix: "RND",
      availability: "available" as const,
      alternativePrefix: null,
      nextNumber: 8,
      exampleKeys: ["RND-8", "RND-9"],
    };
    const unused = projectPageKeyEditorModel({
      mode: "edit",
      expanded: true,
      draftPrefix: "RND",
      currentPrefix: "LAB",
      preview,
      settings: settings({ assignedPageCount: 0, nextNumber: 1 }),
      settingsStatus: "ready",
    });
    expect(unused.canSubmit).toBe(true);
    expect(unused.impactText).toContain("old prefix will be released");

    const used = projectPageKeyEditorModel({
      mode: "edit",
      expanded: true,
      draftPrefix: "RND",
      currentPrefix: "LAB",
      preview,
      settings: settings({
        retiredPrefixes: [{ prefix: "OLD", lastNumber: 4 }],
      }),
      settingsStatus: "ready",
    });
    expect(used.impactText).toContain("7 Pages");
    expect(used.impactText).toContain("keep working and remain reserved");
    expect(used.history).toEqual([{
      prefix: "OLD",
      detail: "Numbers through 4 still resolve",
    }]);
  });

  test("keeps concurrency and reservation failures distinct", () => {
    const base = {
      mode: "edit" as const,
      expanded: true,
      draftPrefix: "RND",
      currentPrefix: "LAB",
      preview: {
        kind: "available" as const,
        prefix: "RND",
        availability: "available" as const,
        alternativePrefix: null,
        nextNumber: 8,
        exampleKeys: ["RND-8", "RND-9"],
      },
      settings: settings(),
      settingsStatus: "ready" as const,
    };
    expect(projectPageKeyEditorModel({
      ...base,
      saveFailure: {
        code: "identity_conflict",
        message: "reserved",
        retryable: false,
      },
    }).prefixError).toContain("claimed in another window");
    expect(projectPageKeyEditorModel({
      ...base,
      saveFailure: {
        code: "revision_conflict",
        message: "stale",
        retryable: false,
      },
    }).formError).toContain("changed in another window");
  });
});
