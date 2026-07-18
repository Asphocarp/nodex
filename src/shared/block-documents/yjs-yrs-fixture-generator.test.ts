import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "vitest";
import * as Y from "yjs";
import {
  materializePageDocument,
  populateBlockDocumentBodyFromNfm,
} from "./block-document-codec";
import { createPageDocument } from "./page-document";
import { replaceYTextWithPortableRichText } from "./portable-rich-text";

const outputRoot = path.resolve(
  "crates/nodex-core/tests/fixtures/yjs-yrs",
);

const firstXmlText = (node: Y.XmlFragment | Y.XmlElement): Y.XmlText => {
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) return child;
    if (!(child instanceof Y.XmlElement)) continue;
    try {
      return firstXmlText(child);
    } catch {
      // Continue with the next branch.
    }
  }
  throw new Error("fixture does not contain Y.XmlText");
};

const cloneFrom = (update: Uint8Array, clientId: number): Y.Doc => {
  const document = new Y.Doc({ guid: "nodex-yjs-yrs-conformance" });
  document.clientID = clientId;
  Y.applyUpdate(document, update);
  return document;
};

const generate =
  process.env.NODEX_GENERATE_YJS_YRS_FIXTURES === "1" ? test : test.skip;

generate("generates stable Yjs 13 fixtures for the Yrs compatibility corpus", async () => {
  const page = createPageDocument({
    documentId: "nodex-yjs-yrs-conformance",
    initializeBody: false,
  });
  page.document.clientID = 1_001;
  replaceYTextWithPortableRichText(page.title, [
    { type: "text", text: "迁移 😀 e\u0301 ", styles: { bold: true } },
    {
      type: "link",
      text: "Nodex",
      href: "https://nodex.local/core",
      styles: { italic: true },
    },
  ]);
  let blockIndex = 0;
  populateBlockDocumentBodyFromNfm(
    page.body,
    [
      "# Runtime",
      "Parent **bold** with [link](https://nodex.local/spec) 😀 中文 e\u0301",
      "\tNested child",
      "Sibling",
    ].join("\n"),
    () => `fixture-block-${++blockIndex}`,
  );
  const base = Y.encodeStateAsUpdate(page.document);
  const baseVector = Y.encodeStateVector(page.document);

  const first = cloneFrom(base, 1_002);
  first.transact(() => {
    first.getText("title").insert(0, "A ", { underline: true });
    const text = firstXmlText(first.getXmlFragment("body"));
    text.format(0, Math.min(text.length, 7), { code: true });
  }, "first-concurrent-edit");
  const firstUpdate = Y.encodeStateAsUpdate(first, baseVector);

  const second = cloneFrom(base, 1_003);
  second.transact(() => {
    const title = second.getText("title");
    title.insert(title.length, " B");
    const text = firstXmlText(second.getXmlFragment("body"));
    text.insert(text.length, " · concurrent");
  }, "second-concurrent-edit");
  const secondUpdate = Y.encodeStateAsUpdate(second, baseVector);

  const merged = cloneFrom(base, 1_004);
  Y.applyUpdate(merged, firstUpdate);
  Y.applyUpdate(merged, secondUpdate);
  const materialization = materializePageDocument(merged);

  const dependencySource = new Y.Doc({ guid: "missing-dependency" });
  dependencySource.clientID = 1_005;
  dependencySource.getText("title").insert(0, "base");
  const dependencyVector = Y.encodeStateVector(dependencySource);
  dependencySource.getText("title").insert(4, "-missing-base");
  const missingDependency = Y.encodeStateAsUpdate(
    dependencySource,
    dependencyVector,
  );

  await mkdir(outputRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputRoot, "base.bin"), base),
    writeFile(path.join(outputRoot, "first.bin"), firstUpdate),
    writeFile(path.join(outputRoot, "second.bin"), secondUpdate),
    writeFile(path.join(outputRoot, "missing-dependency.bin"), missingDependency),
    writeFile(
      path.join(outputRoot, "manifest.json"),
      `${JSON.stringify(
        {
          version: 1,
          yjsVersion: "13.6.31",
          title: merged.getText("title").toString(),
          bodyXml: merged.getXmlFragment("body").toString(),
          nfm: materialization.nfm,
          blockIds: materialization.blockTree.map((block) => block.id),
        },
        null,
        2,
      )}\n`,
    ),
  ]);
});

