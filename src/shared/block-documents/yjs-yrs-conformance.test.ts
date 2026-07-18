import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import * as Y from "yjs";

interface BridgeSummary {
  readonly title: string;
  readonly body_xml: string;
  readonly state_vector: readonly number[];
}

const fixtureRoot = path.resolve(
  "crates/nodex-core/tests/fixtures/yjs-yrs",
);
const temporaryRoots: string[] = [];

const firstXmlText = (node: Y.XmlFragment | Y.XmlElement): Y.XmlText => {
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) return child;
    if (child instanceof Y.XmlElement) {
      try {
        return firstXmlText(child);
      } catch {
        // Continue with the next branch.
      }
    }
  }
  throw new Error("fixture does not contain Y.XmlText");
};

const runBridge = (args: readonly string[]): BridgeSummary =>
  JSON.parse(
    execFileSync(
      "cargo",
      ["run", "--quiet", "-p", "nodex-core", "--example", "yjs_yrs_bridge", "--", ...args],
      { cwd: path.resolve("."), encoding: "utf8" },
    ),
  ) as BridgeSummary;

const normalizeXmlSerialization = (xml: string): string =>
  xml.replace(
    /<(\/)?([A-Za-z][A-Za-z0-9]*)([^>]*)>/g,
    (_match, closing: string | undefined, rawName: string, rawAttributes: string) => {
      const name = rawName.toLowerCase();
      if (closing) return `</${name}>`;
      const attributes = Array.from(
        rawAttributes.matchAll(/([A-Za-z][A-Za-z0-9]*)="([^"]*)"/g),
        (match) => `${match[1]}="${match[2]}"`,
      ).sort();
      return `<${name}${attributes.length > 0 ? ` ${attributes.join(" ")}` : ""}>`;
    },
  );

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true });
  }
});

describe("Yjs/Yrs compatibility", () => {
  test(
    "continues editing a rich Page in both engines after a bidirectional round trip",
    () => {
      const temporaryRoot = mkdtempSync(path.join(tmpdir(), "nodex-yjs-yrs-"));
      temporaryRoots.push(temporaryRoot);
      const rustUpdatePath = path.join(temporaryRoot, "rust-update.bin");
      const thirdUpdatePath = path.join(temporaryRoot, "third-update.bin");

      const rustAfterConcurrent = runBridge([
        "generate",
        fixtureRoot,
        rustUpdatePath,
      ]);

      const yjsDocument = new Y.Doc({ guid: "nodex-yjs-yrs-conformance" });
      for (const name of ["base.bin", "first.bin", "second.bin"]) {
        Y.applyUpdate(yjsDocument, readFileSync(path.join(fixtureRoot, name)));
      }
      Y.applyUpdate(yjsDocument, readFileSync(rustUpdatePath));
      expect(yjsDocument.getText("title").toString()).toBe(
        rustAfterConcurrent.title,
      );
      expect(
        normalizeXmlSerialization(
          yjsDocument.getXmlFragment("body").toString(),
        ),
      ).toBe(
        normalizeXmlSerialization(rustAfterConcurrent.body_xml),
      );

      const beforeThird = Y.encodeStateVector(yjsDocument);
      yjsDocument.transact(() => {
        const title = yjsDocument.getText("title");
        title.insert(title.length, " · JS3");
        const text = firstXmlText(yjsDocument.getXmlFragment("body"));
        text.insert(text.length, " third");
      }, "third-js-edit");
      writeFileSync(
        thirdUpdatePath,
        Y.encodeStateAsUpdate(yjsDocument, beforeThird),
      );

      const rustAfterThird = runBridge([
        "inspect",
        fixtureRoot,
        rustUpdatePath,
        thirdUpdatePath,
      ]);
      expect(rustAfterThird.title).toBe(
        yjsDocument.getText("title").toString(),
      );
      expect(normalizeXmlSerialization(rustAfterThird.body_xml)).toBe(
        normalizeXmlSerialization(
          yjsDocument.getXmlFragment("body").toString(),
        ),
      );
      expect(rustAfterThird.state_vector.length).toBeGreaterThan(1);
    },
    60_000,
  );
});
