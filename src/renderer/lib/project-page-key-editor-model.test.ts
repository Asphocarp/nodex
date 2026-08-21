import { describe, expect, test } from "vite-plus/test";

import type { DatabasePageKeyNamespaceV2 } from "../../shared/database-module-v2";
import { projectPageKeyEditorModel } from "./project-page-key-editor-model";

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
    expect(used.history).toEqual([
      {
        prefix: "OLD",
        detail: "Numbers through 4 still resolve",
      },
    ]);
  });

  test("keeps concurrency and reservation failures distinct", () => {
    const base = {
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
    expect(
      projectPageKeyEditorModel({
        ...base,
        saveFailure: {
          code: "identity_conflict",
          message: "reserved",
          retryable: false,
        },
      }).prefixError,
    ).toContain("claimed in another window");
    expect(
      projectPageKeyEditorModel({
        ...base,
        saveFailure: {
          code: "revision_conflict",
          message: "stale",
          retryable: false,
        },
      }).formError,
    ).toContain("changed in another window");
  });
});
