import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  Awareness,
  applyAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";
import { materializePageDocument } from "./block-document-codec";

interface BridgeSummary {
  readonly title: string;
  readonly body_semantic: unknown;
  readonly state_vector: readonly number[];
}

interface AwarenessBridgeSummary {
  readonly client_id: number;
  readonly state: unknown;
}

interface FixtureManifest {
  readonly matrix: {
    readonly blockTypes: readonly string[];
  };
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

const runBridge = <T = BridgeSummary>(args: readonly string[]): T =>
  JSON.parse(
    execFileSync(
      "cargo",
      ["run", "--quiet", "-p", "nodex-core", "--example", "yjs_yrs_bridge", "--", ...args],
      { cwd: path.resolve("."), encoding: "utf8" },
    ),
  ) as T;

const normalizedStateVector = (bytes: Uint8Array): readonly (readonly [number, number])[] =>
  [...Y.decodeStateVector(bytes).entries()].sort(
    ([left], [right]) => left - right,
  );

const exactElementNames = (body: Y.XmlFragment): readonly string[] =>
  [...body.createTreeWalker((node) => node instanceof Y.XmlElement)].map(
    (node) => (node as Y.XmlElement).nodeName,
  );

const semanticValue = (value: unknown): unknown => {
  if (value === undefined) return { $yrs: "undefined" };
  if (typeof value === "bigint") {
    return { $yrs: "bigint", value: value.toString() };
  }
  if (value instanceof Uint8Array) {
    return { $yrs: "bytes", value: [...value] };
  }
  if (Array.isArray(value)) return value.map(semanticValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, semanticValue(entry)]),
  );
};

const semanticXmlNode = (node: unknown): unknown => {
  if (node instanceof Y.XmlText) {
    const delta = node.toDelta() as readonly {
      readonly insert: unknown;
      readonly attributes?: Readonly<Record<string, unknown>>;
    }[];
    return {
      kind: "text",
      delta: delta.map((chunk) => ({
        insert: semanticValue(chunk.insert),
        attributes: semanticValue(chunk.attributes ?? {}),
      })),
    };
  }
  if (!(node instanceof Y.XmlElement)) {
    throw new TypeError(`Unsupported fixture XML node: ${typeof node}`);
  }
  return {
    kind: "element",
    name: node.nodeName,
    attributes: semanticValue(node.getAttributes()),
    children: node.toArray().map((child) => semanticXmlNode(child)),
  };
};

const semanticXml = (body: Y.XmlFragment): unknown =>
  body.toArray().map((node) => semanticXmlNode(node));

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true });
  }
});

describe("Yjs/Yrs compatibility", () => {
  test(
    "materializes the same schema matrix after a Rust BlockTree round trip",
    () => {
      const temporaryRoot = mkdtempSync(path.join(tmpdir(), "nodex-block-tree-"));
      temporaryRoots.push(temporaryRoot);
      const roundtripUpdatePath = path.join(temporaryRoot, "matrix-roundtrip.bin");
      runBridge([
        "matrix-block-tree-roundtrip",
        fixtureRoot,
        roundtripUpdatePath,
      ]);

      const source = new Y.Doc({ guid: "matrix-source" });
      Y.applyUpdate(
        source,
        readFileSync(path.join(fixtureRoot, "matrix-base.bin")),
      );
      const roundtrip = new Y.Doc({ guid: "matrix-roundtrip" });
      Y.applyUpdate(roundtrip, readFileSync(roundtripUpdatePath));

      expect(materializePageDocument(roundtrip)).toEqual(
        materializePageDocument(source),
      );
      expect(semanticXml(roundtrip.getXmlFragment("body"))).toEqual(
        semanticXml(source.getXmlFragment("body")),
      );
    },
    60_000,
  );

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
      expect(semanticXml(yjsDocument.getXmlFragment("body"))).toEqual(
        rustAfterConcurrent.body_semantic,
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
      expect(rustAfterThird.body_semantic).toEqual(
        semanticXml(yjsDocument.getXmlFragment("body")),
      );
      expect(rustAfterThird.state_vector.length).toBeGreaterThan(1);
      expect(
        normalizedStateVector(Uint8Array.from(rustAfterThird.state_vector)),
      ).toEqual(normalizedStateVector(Y.encodeStateVector(yjsDocument)));
    },
    60_000,
  );

  test(
    "round-trips every registered Block and inline shape with exact XML tags",
    () => {
      const temporaryRoot = mkdtempSync(path.join(tmpdir(), "nodex-yjs-yrs-matrix-"));
      temporaryRoots.push(temporaryRoot);
      const rustUpdatePath = path.join(temporaryRoot, "matrix-rust-update.bin");
      const thirdUpdatePath = path.join(temporaryRoot, "matrix-third-update.bin");
      const manifest = JSON.parse(
        readFileSync(path.join(fixtureRoot, "manifest.json"), "utf8"),
      ) as FixtureManifest;

      const rustAfterMatrix = runBridge([
        "matrix-generate",
        fixtureRoot,
        rustUpdatePath,
      ]);
      const yjsDocument = new Y.Doc({ guid: "nodex-yjs-yrs-schema-matrix" });
      Y.applyUpdate(
        yjsDocument,
        readFileSync(path.join(fixtureRoot, "matrix-base.bin")),
      );
      Y.applyUpdate(yjsDocument, readFileSync(rustUpdatePath));
      expect(yjsDocument.getText("title").toString()).toBe(rustAfterMatrix.title);
      expect(semanticXml(yjsDocument.getXmlFragment("body"))).toEqual(
        rustAfterMatrix.body_semantic,
      );

      const nodeNames = exactElementNames(yjsDocument.getXmlFragment("body"));
      expect(nodeNames).toContain("blockGroup");
      expect(nodeNames).toContain("blockContainer");
      for (const blockType of manifest.matrix.blockTypes) {
        expect(nodeNames, blockType).toContain(blockType);
      }

      const beforeThird = Y.encodeStateVector(yjsDocument);
      yjsDocument.transact(() => {
        const title = yjsDocument.getText("title");
        title.insert(title.length, " · matrix JS3");
        const text = firstXmlText(yjsDocument.getXmlFragment("body"));
        text.insert(text.length, " · matrix third");
      }, "matrix-third-js-edit");
      writeFileSync(
        thirdUpdatePath,
        Y.encodeStateAsUpdate(yjsDocument, beforeThird),
      );

      const rustAfterThird = runBridge([
        "matrix-inspect",
        fixtureRoot,
        rustUpdatePath,
        thirdUpdatePath,
      ]);
      expect(rustAfterThird.title).toBe(yjsDocument.getText("title").toString());
      expect(rustAfterThird.body_semantic).toEqual(
        semanticXml(yjsDocument.getXmlFragment("body")),
      );
      expect(
        normalizedStateVector(Uint8Array.from(rustAfterThird.state_vector)),
      ).toEqual(normalizedStateVector(Y.encodeStateVector(yjsDocument)));
    },
    60_000,
  );

  test(
    "exchanges ephemeral Awareness state in both directions",
    () => {
      const temporaryRoot = mkdtempSync(path.join(tmpdir(), "nodex-yjs-yrs-awareness-"));
      temporaryRoots.push(temporaryRoot);
      const rustUpdatePath = path.join(temporaryRoot, "awareness-rust.bin");
      const rust = runBridge<AwarenessBridgeSummary>([
        "awareness",
        path.join(fixtureRoot, "awareness-added.bin"),
        rustUpdatePath,
      ]);

      expect(rust.client_id).toBeGreaterThan(0);
      expect(rust.client_id).toBeLessThanOrEqual(0xffff_ffff);
      const remoteDocument = new Y.Doc({ guid: "awareness-yjs-consumer" });
      const remoteAwareness = new Awareness(remoteDocument);
      remoteAwareness.setLocalState(null);
      applyAwarenessUpdate(
        remoteAwareness,
        readFileSync(rustUpdatePath),
        "rust-fixture",
      );
      expect(remoteAwareness.getStates().get(rust.client_id)).toEqual(rust.state);
      expect(remoteAwareness.getStates().size).toBe(2);
      remoteAwareness.destroy();
    },
    60_000,
  );
});
