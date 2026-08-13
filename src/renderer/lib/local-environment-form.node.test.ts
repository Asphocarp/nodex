import { describe, expect, it } from "vitest";
import type { WorktreeEnvironmentDefinition } from "./types";
import {
  createLocalEnvironmentDraft,
  createLocalEnvironmentDraftAction,
  LOCAL_ENVIRONMENT_SAVE_DISABLED_COPY,
  readLocalEnvironmentPlatformSlot,
  resolveLocalEnvironmentSaveDisabledReason,
  toPersistedLocalEnvironmentDefinition,
  validateLocalEnvironmentDraft,
  writeLocalEnvironmentPlatformSlot,
} from "./local-environment-form";

const environment: WorktreeEnvironmentDefinition = {
  version: 1,
  name: "Example",
  setup: { script: "default", platformScripts: { darwin: "mac" } },
  cleanup: { script: null, platformScripts: {} },
  actions: [{ name: "Run", icon: null, command: "pnpm dev", platform: null }],
};

describe("local environment form model", () => {
  it("maps persisted actions to runtime ids without materializing the display fallback", () => {
    const draft = createLocalEnvironmentDraft(environment);
    expect(draft.actions[0]).toMatchObject({
      name: "Run",
      icon: null,
      command: "pnpm dev",
    });
    expect(draft.actions[0]?.id).toEqual(expect.any(String));

    const persisted = toPersistedLocalEnvironmentDefinition(draft);
    expect(persisted.actions[0]).not.toHaveProperty("id");
    expect(persisted.actions[0]?.icon).toBeNull();
  });

  it("accepts blank actions, rejects one-sided actions, and filters blanks on save", () => {
    const blank = createLocalEnvironmentDraftAction();
    expect(blank.icon).toBe("tool");
    const draft = createLocalEnvironmentDraft(environment);
    draft.actions = [blank];
    expect(validateLocalEnvironmentDraft(draft).incompleteActionIds).toEqual([]);
    expect(toPersistedLocalEnvironmentDefinition(draft).actions).toEqual([]);

    draft.actions[0] = { ...blank, name: "Named" };
    expect(validateLocalEnvironmentDraft(draft).actionErrors[blank.id]).toEqual({
      command: "Enter an action command",
    });

    draft.actions[0] = { ...blank, command: "run" };
    expect(validateLocalEnvironmentDraft(draft).actionErrors[blank.id]).toEqual({
      name: "Enter an action name",
    });
  });

  it("resolves save gating in reference priority order", () => {
    const draft = createLocalEnvironmentDraft(environment);
    const valid = validateLocalEnvironmentDraft(draft);
    const base = { dirty: true, isSaving: false, ready: true, validation: valid };

    expect(resolveLocalEnvironmentSaveDisabledReason({ ...base, isSaving: true, readError: true }))
      .toBe("saving");
    expect(resolveLocalEnvironmentSaveDisabledReason({ ...base, ready: false, projectError: true }))
      .toBe("project-error");
    expect(resolveLocalEnvironmentSaveDisabledReason({ ...base, ready: false }))
      .toBe("loading-project");
    expect(resolveLocalEnvironmentSaveDisabledReason({ ...base, readError: true }))
      .toBe("read-error");

    draft.name = "";
    expect(resolveLocalEnvironmentSaveDisabledReason({
      ...base,
      validation: validateLocalEnvironmentDraft(draft),
    })).toBe("missing-name");

    draft.name = "Example";
    draft.actions = [{ ...createLocalEnvironmentDraftAction(), name: "Run" }];
    expect(resolveLocalEnvironmentSaveDisabledReason({
      ...base,
      validation: validateLocalEnvironmentDraft(draft),
    })).toBe("incomplete-action");
    expect(resolveLocalEnvironmentSaveDisabledReason({ ...base, dirty: false })).toBe("no-changes");
    expect(resolveLocalEnvironmentSaveDisabledReason(base)).toBeNull();
  });

  it("keeps exact disabled tooltip copy", () => {
    expect(LOCAL_ENVIRONMENT_SAVE_DISABLED_COPY).toEqual({
      saving: "Saving…",
      "read-error": "Retry loading the environment before saving",
      "missing-name": "Add an environment name to save",
      "incomplete-action": "Add both a name and command for each action",
      "no-changes": "No changes to save",
      "project-error": "Retry loading project information to save",
      "loading-project": "Loading project information",
    });
  });

  it("reads and writes default and platform slots without trimming scripts", () => {
    const draft = createLocalEnvironmentDraft(environment);
    const next = writeLocalEnvironmentPlatformSlot(draft.setup, "win32", "  windows\r\n");
    expect(readLocalEnvironmentPlatformSlot(next, "default")).toBe("default");
    expect(readLocalEnvironmentPlatformSlot(next, "win32")).toBe("  windows\r\n");

    draft.setup = next;
    expect(toPersistedLocalEnvironmentDefinition(draft).setup.platformScripts.win32)
      .toBe("  windows\r\n");
  });
});
