import { describe, expect, test } from "vitest";
import {
  decideWorkspaceFileTabOpen,
  type WorkspaceFileTabCandidate,
} from "./workspace-file-tab-model";

const empty: WorkspaceFileTabCandidate = {
  hostId: "local",
  id: "files-empty",
  path: null,
};
const durable: WorkspaceFileTabCandidate = {
  hostId: "local",
  id: "files-a",
  path: "/repo/a.ts",
};
const preview: WorkspaceFileTabCandidate = {
  hostId: "local",
  id: "preview-b",
  path: "/repo/b.ts",
};

describe("workspace file tab state machine", () => {
  test("replaces the active empty tab for the first selection", () => {
    expect(decideWorkspaceFileTabOpen({
      activeDurableTabId: empty.id,
      durableTabs: [empty],
      hostId: "local",
      mode: "preview",
      path: "/repo/a.ts",
      previewTab: null,
    })).toEqual({ kind: "replace-empty", tabId: empty.id });
  });

  test("creates, replaces, and pins the leaf preview explicitly", () => {
    expect(decideWorkspaceFileTabOpen({
      activeDurableTabId: durable.id,
      durableTabs: [durable],
      hostId: "local",
      mode: "preview",
      path: "/repo/b.ts",
      previewTab: null,
    })).toEqual({ kind: "create-preview", replacingPreviewTabId: null });
    expect(decideWorkspaceFileTabOpen({
      activeDurableTabId: durable.id,
      durableTabs: [durable],
      hostId: "local",
      mode: "preview",
      path: "/repo/c.ts",
      previewTab: preview,
    })).toEqual({
      kind: "create-preview",
      replacingPreviewTabId: preview.id,
    });
    expect(decideWorkspaceFileTabOpen({
      activeDurableTabId: durable.id,
      durableTabs: [durable],
      hostId: "local",
      mode: "durable",
      path: preview.path ?? "",
      previewTab: preview,
    })).toEqual({ kind: "pin-preview", tabId: preview.id });
  });

  test("reuses matching durable and preview tabs without duplication", () => {
    expect(decideWorkspaceFileTabOpen({
      activeDurableTabId: durable.id,
      durableTabs: [durable],
      hostId: "local",
      mode: "preview",
      path: durable.path ?? "",
      previewTab: preview,
    })).toEqual({ kind: "focus-durable", tabId: durable.id });
    expect(decideWorkspaceFileTabOpen({
      activeDurableTabId: durable.id,
      durableTabs: [durable],
      hostId: "local",
      mode: "preview",
      path: preview.path ?? "",
      previewTab: preview,
    })).toEqual({ kind: "focus-preview", tabId: preview.id });
  });
});
