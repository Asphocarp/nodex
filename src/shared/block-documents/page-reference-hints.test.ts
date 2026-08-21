import { describe, expect, test } from "vite-plus/test";
import * as Y from "yjs";
import { normalizePageReferences } from "./page-reference-hints";

const appendBlock = (
  group: Y.XmlElement,
  id: string,
  type: string,
  attributes: Readonly<Record<string, string>>,
): void => {
  const container = new Y.XmlElement("blockContainer");
  container.setAttribute("id", id);
  const content = new Y.XmlElement(type);
  for (const [key, value] of Object.entries(attributes)) {
    content.setAttribute(key, value);
  }
  container.insert(0, [content]);
  group.insert(group.length, [container]);
};

describe("normalizePageReferences", () => {
  test("removes only Page shell snapshots and reaches a clean fixed point", () => {
    const document = new Y.Doc();
    const body = document.getXmlFragment("body");
    const group = new Y.XmlElement("blockGroup");
    body.insert(0, [group]);
    appendBlock(group, "page-ref", "pageRef", {
      targetBlockId: "target-card",
      displayHint: "Old reference title",
    });
    appendBlock(group, "card-child", "page", {
      displayHint: "Old child title",
    });
    appendBlock(group, "database-ref", "databaseViewRef", {
      databaseViewId: "view-1",
      displayHint: "Planning",
    });
    appendBlock(group, "template-ref", "templateRef", {
      sourceBlockId: "template-1",
      displayHint: "Template",
    });

    expect(normalizePageReferences(body)).toEqual({
      removedHints: 2,
      renamedNodes: 0,
      blockIds: ["card-child", "page-ref"],
    });
    expect(normalizePageReferences(body)).toEqual({
      removedHints: 0,
      renamedNodes: 0,
      blockIds: [],
    });
    expect(body.toString()).toContain('displayHint="Planning"');
    expect(body.toString()).toContain('displayHint="Template"');
    expect(body.toString()).not.toContain("Old reference title");
    expect(body.toString()).not.toContain("Old child title");
    document.destroy();
  });

  test("renames historical cardRef nodes with exact targets", () => {
    const document = new Y.Doc();
    const body = document.getXmlFragment("body");
    const group = new Y.XmlElement("blockGroup");
    body.insert(0, [group]);
    appendBlock(group, "historical-reference", "cardRef", {
      targetBlockId: "target-page",
      displayHint: "Old target title",
      legacyCardId: "stale-alias",
    });
    appendBlock(group, "unresolved-reference", "cardRef", {
      displayHint: "Unresolved title",
    });

    expect(normalizePageReferences(body)).toEqual({
      removedHints: 2,
      renamedNodes: 1,
      blockIds: ["historical-reference", "unresolved-reference"],
    });
    expect(body.toString()).toContain('<pageref targetBlockId="target-page"></pageref>');
    expect(body.toString()).not.toContain("legacyCardId");
    expect(body.toString()).toContain("<cardref></cardref>");
    expect(normalizePageReferences(body)).toEqual({
      removedHints: 0,
      renamedNodes: 0,
      blockIds: [],
    });
    document.destroy();
  });
});
