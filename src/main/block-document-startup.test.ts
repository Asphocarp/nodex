import { describe, expect, test } from "bun:test";
import {
  prepareBlockDocumentAuthorityForStartup,
  type BlockDocumentStartupWriter,
} from "./block-document-startup";
import type { BlockDocumentShadowInitializationResult } from "./card-mutation-worker-protocol";
import type { ForeignReferenceMigrationBatchResult } from "./local-store/foreign-reference-migration";

const shadow = (
  overrides: Partial<BlockDocumentShadowInitializationResult> = {},
): BlockDocumentShadowInitializationResult => ({
  processed: 0,
  applied: 0,
  superseded: 0,
  failed: 0,
  errors: 0,
  exhausted: true,
  ...overrides,
});
const migration = (
  overrides: Partial<ForeignReferenceMigrationBatchResult> = {},
): ForeignReferenceMigrationBatchResult => ({
  processedDocuments: 0,
  migratedReferences: 0,
  recoveredCards: 0,
  databaseViewsCreated: 0,
  failedDocuments: 0,
  exhausted: true,
  changedDocumentIds: [],
  errors: [],
  ...overrides,
});

const makeWriter = (input: {
  readonly calls: string[];
  readonly shadows: BlockDocumentShadowInitializationResult[];
  readonly migrations: ForeignReferenceMigrationBatchResult[];
  readonly deferredForeignReferences?: number;
}): BlockDocumentStartupWriter => ({
  initializeBlockDocumentShadows: async () => {
    input.calls.push("shadow");
    const result = input.shadows.shift();
    if (!result) throw new Error("Unexpected shadow drain");
    return { result };
  },
  migrateLegacyForeignReferences: async () => {
    input.calls.push("migration");
    const result = input.migrations.shift();
    if (!result) throw new Error("Unexpected migration drain");
    return { result };
  },
  cutoverEligibleCardDocuments: async () => {
    input.calls.push("cutover");
    return {
      result: {
        cutoverDocumentIds: ["document:card-1"],
        alreadyPrimary: 0,
        deferredForeignReferences: input.deferredForeignReferences ?? 0,
      },
    };
  },
  repairDocumentSecondaryProjections: async () => {
    input.calls.push("projection");
    return {
      result: {
        inspectedDocuments: 1,
        repairedDocuments: 1,
        searchUnitCount: 2,
        assetRefCount: 0,
      },
    };
  },
});

describe("Block Document startup authority preparation", () => {
  test("repeats shadow and migration rounds until recovered Documents reach a fixed point", async () => {
    const calls: string[] = [];
    const writer = makeWriter({
      calls,
      shadows: [
        shadow({ processed: 2, applied: 2 }),
        shadow({ processed: 1, applied: 1 }),
      ],
      migrations: [
        migration({
          processedDocuments: 1,
          migratedReferences: 2,
          recoveredCards: 1,
          changedDocumentIds: ["document:host"],
        }),
        migration(),
      ],
    });

    const result = await prepareBlockDocumentAuthorityForStartup(writer);

    expect(calls.join(",")).toBe("shadow,migration,shadow,migration,cutover,projection");
    expect(result.cutoverDocumentIds.join(",")).toBe("document:card-1");
  });

  test("fails closed before cutover when a resumable migration batch reports an error", async () => {
    const calls: string[] = [];
    const writer = makeWriter({
      calls,
      shadows: [shadow()],
      migrations: [migration({
        processedDocuments: 1,
        failedDocuments: 1,
        exhausted: false,
        errors: [{ documentId: "document:broken", message: "invalid snapshot" }],
      })],
    });

    let message = "";
    try {
      await prepareBlockDocumentAuthorityForStartup(writer);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message.includes("invalid snapshot")).toBeTrue();
    expect(calls.join(",")).toBe("shadow,migration");
  });

  test("rejects a cutover result that still reports a foreign-body projection", async () => {
    const calls: string[] = [];
    const writer = makeWriter({
      calls,
      shadows: [shadow()],
      migrations: [migration()],
      deferredForeignReferences: 1,
    });

    let message = "";
    try {
      await prepareBlockDocumentAuthorityForStartup(writer);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message.includes("still contain legacy foreign-body projections")).toBeTrue();
    expect(calls.join(",")).toBe("shadow,migration,cutover");
  });
});
