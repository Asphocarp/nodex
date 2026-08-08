import { describe, expect, test } from "vitest";
import {
  materializePageDocument,
  populateBlockDocumentBodyFromNfm,
} from "../../shared/block-documents/block-document-codec";
import {
  buildPageCreateInput,
  capturePageCreateDraftSnapshot,
  createEmptyPageCreateDraftSnapshot,
  createPageCreateDescriptionDraft,
  pageCreateDraftSnapshotsEqual,
  resolvePageCreateTagNames,
} from "./page-create-draft";

describe("Page create draft", () => {
  test("starts a blank description with one canonical editable paragraph", () => {
    const draft = createPageCreateDescriptionDraft("request-empty-description");

    expect(materializePageDocument(draft.document)).toMatchObject({
      nfm: "",
      blockTree: [
        {
          type: "paragraph",
          content: [],
          children: [],
        },
      ],
    });
    draft.document.destroy();
  });

  test("materializes one Page lifecycle payload from local title, NFM, and properties", () => {
    const draft = createPageCreateDescriptionDraft("request-1");
    populateBlockDocumentBodyFromNfm(
      draft.body,
      "## Context\n\nKeep the creation draft local until submit.",
    );

    const input = buildPageCreateInput({
      title: "  Ship create modal  ",
      descriptionDraft: draft,
      priority: "p1-high",
      estimate: "m",
      selectedTagIds: ["tag-ui", "tag-shared-name", "tag-shared-name-2"],
      tagOptions: [
        { id: "tag-ui", name: "UI", color: "blue" },
        { id: "tag-shared-name", name: "Polish", color: "green" },
        { id: "tag-shared-name-2", name: "Polish", color: "yellow" },
      ],
    });

    expect(input).toEqual({
      title: "Ship create modal",
      description: "## Context\nKeep the creation draft local until submit.",
      priority: "p1-high",
      estimate: "m",
      tags: ["UI", "Polish"],
    });
    draft.document.destroy();
  });

  test("uses a fresh collaborative identity for each create-more generation", () => {
    const first = createPageCreateDescriptionDraft("request-1", 0);
    const second = createPageCreateDescriptionDraft("request-1", 1);

    expect(first.documentId).not.toBe(second.documentId);
    expect(first.body).not.toBe(second.body);
    expect(second.generation).toBe(1);
    first.document.destroy();
    second.document.destroy();
  });

  test("rejects an empty title and a tag selection that lost its option authority", () => {
    const draft = createPageCreateDescriptionDraft("request-2");

    expect(() => buildPageCreateInput({
      title: "   ",
      descriptionDraft: draft,
      priority: null,
      estimate: null,
      selectedTagIds: [],
      tagOptions: [],
    })).toThrow("Page title is required");
    expect(() => resolvePageCreateTagNames(["missing"], [])).toThrow(
      "A selected tag is no longer available",
    );
    draft.document.destroy();
  });

  test("captures a pure recoverable snapshot and hydrates it into a fresh document", () => {
    const first = createPageCreateDescriptionDraft("request-restore");
    populateBlockDocumentBodyFromNfm(first.body, "Recover this body");
    const snapshot = capturePageCreateDraftSnapshot({
      title: "Recover this Page",
      descriptionDraft: first,
      status: "build",
      priority: "p1-high",
      estimate: "m",
      selectedTagIds: ["tag-ui"],
      tagOptions: [{ id: "tag-ui", name: "UI", color: "blue" }],
      createMore: true,
      expanded: true,
    });
    const restored = createPageCreateDescriptionDraft(
      "request-restored",
      0,
      snapshot.descriptionNfm,
    );

    expect(snapshot).toEqual({
      title: "Recover this Page",
      descriptionNfm: "Recover this body",
      status: "build",
      priority: "p1-high",
      estimate: "m",
      tagNames: ["UI"],
      createMore: true,
      expanded: true,
    });
    expect(restored.documentId).not.toBe(first.documentId);
    expect(buildPageCreateInput({
      title: snapshot.title,
      descriptionDraft: restored,
      priority: snapshot.priority,
      estimate: snapshot.estimate,
      selectedTagIds: [],
      tagOptions: [],
    }).description).toBe("Recover this body");
    expect(pageCreateDraftSnapshotsEqual(snapshot, { ...snapshot })).toBe(true);
    expect(pageCreateDraftSnapshotsEqual(
      createEmptyPageCreateDraftSnapshot("build", {
        priority: "p1-high",
        estimate: "m",
        tagNames: ["UI"],
        createMore: true,
        expanded: true,
      }),
      snapshot,
    )).toBe(false);
    first.document.destroy();
    restored.document.destroy();
  });

  test("keeps draft recovery closable after a selected tag loses authority", () => {
    const draft = createPageCreateDescriptionDraft("request-stale-tag");

    expect(capturePageCreateDraftSnapshot({
      title: "Recover the remaining draft",
      descriptionDraft: draft,
      status: "triage",
      priority: null,
      estimate: null,
      selectedTagIds: ["removed-tag"],
      tagOptions: [],
      createMore: false,
      expanded: false,
    }).tagNames).toEqual([]);
    draft.document.destroy();
  });
});
