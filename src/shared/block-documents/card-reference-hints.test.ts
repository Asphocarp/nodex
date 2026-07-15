import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import { removeCardReferenceDisplayHints } from "./card-reference-hints";

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

describe("removeCardReferenceDisplayHints", () => {
  test("removes only Card shell snapshots and reaches a clean fixed point", () => {
    const document = new Y.Doc();
    const body = document.getXmlFragment("body");
    const group = new Y.XmlElement("blockGroup");
    body.insert(0, [group]);
    appendBlock(group, "card-ref", "cardRef", {
      targetBlockId: "target-card",
      displayHint: "Old reference title",
    });
    appendBlock(group, "card-child", "card", {
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

    expect(removeCardReferenceDisplayHints(body)).toEqual({
      count: 2,
      blockIds: ["card-child", "card-ref"],
    });
    expect(removeCardReferenceDisplayHints(body)).toEqual({
      count: 0,
      blockIds: [],
    });
    expect(body.toString()).toContain('displayHint="Planning"');
    expect(body.toString()).toContain('displayHint="Template"');
    expect(body.toString()).not.toContain("Old reference title");
    expect(body.toString()).not.toContain("Old child title");
    document.destroy();
  });
});
