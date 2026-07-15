import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  CreateInputSchema,
  EditDocumentInputSchema,
  NODEX_AGENT_TOOL_CONTRACTS,
  NODEX_APP_TOOLS,
  SearchInputSchema,
} from ".";

describe("Nodex Agent tool contracts", () => {
  test("keeps catalog names, schemas, loading policy, and handlers in one parity set", () => {
    expect(Object.keys(NODEX_AGENT_TOOL_CONTRACTS)).toEqual(NODEX_APP_TOOLS);

    for (const [name, contract] of Object.entries(NODEX_AGENT_TOOL_CONTRACTS)) {
      const schema = z.toJSONSchema(contract.inputSchema) as Record<string, unknown>;
      expect(contract.description.length, name).toBeGreaterThan(40);
      const alternatives = Array.isArray(schema.anyOf)
        ? schema.anyOf as Array<Record<string, unknown>>
        : [schema];
      expect(alternatives.length, name).toBeGreaterThan(0);
      for (const alternative of alternatives) {
        expect(alternative.type, name).toBe("object");
        expect(alternative.additionalProperties, name).toBe(false);
      }
      expect(typeof contract.classifyEffect, name).toBe("function");
    }

    expect(NODEX_AGENT_TOOL_CONTRACTS.get_context.deferLoading).toBe(false);
    expect(NODEX_AGENT_TOOL_CONTRACTS.get_block.deferLoading).toBe(false);
    expect(NODEX_AGENT_TOOL_CONTRACTS.search.deferLoading).toBe(false);
    expect(NODEX_AGENT_TOOL_CONTRACTS.query_database.deferLoading).toBe(true);
    expect(NODEX_AGENT_TOOL_CONTRACTS.create.deferLoading).toBe(true);
  });

  test("does not accept model-authored catalog, Project, actor, or idempotency scope", () => {
    const forbiddenRootFields = {
      version: 1,
      toolsetRevision: 1,
      schemaVersion: 1,
      projectId: "project-forged",
      storeEpoch: "epoch-forged",
      actor: "agent-forged",
      clientSession: "session-forged",
      mutationId: "mutation-forged",
      idempotencyKey: "key-forged",
      writeFence: "fence-forged",
    };

    for (const field of Object.keys(forbiddenRootFields)) {
      const parsed = SearchInputSchema.safeParse({
        query: "roadmap",
        [field]: forbiddenRootFields[field as keyof typeof forbiddenRootFields],
      });
      expect(parsed.success, field).toBe(false);
    }
  });

  test("accepts one-call creation of a complete multi-Block NFM Card", () => {
    const parsed = CreateInputSchema.safeParse({
      resource: {
        kind: "card",
        title: { kind: "plain", text: "Migration plan" },
        body: {
          format: "nfm",
          content: [
            "## Goal",
            "",
            "Move in three phases.",
            "",
            "- [ ] Inventory",
            "\t- Check ownership",
            "- [ ] Migrate",
            "- [ ] Verify",
            "",
            "<callout icon=\"💡\">Keep the rollback path open.</callout>",
          ].join("\n"),
        },
      },
      destination: { kind: "space", at: { kind: "end" } },
    });

    expect(parsed.success).toBe(true);
  });

  test("accepts appending many NFM Blocks in one structural edit", () => {
    const parsed = EditDocumentInputSchema.safeParse({
      documentId: "document-1",
      ifRevision: "revision-1",
      body: {
        kind: "nfm.insert",
        at: { kind: "end" },
        content: "## Risks\n\n- First risk\n- Second risk\n- Third risk",
      },
    });

    expect(parsed.success).toBe(true);
    expect(NODEX_AGENT_TOOL_CONTRACTS.edit_document.classifyEffect(
      parsed.success ? parsed.data : ({} as never),
    )).toBe("write");
  });

  test("rejects ambiguous anchors, empty edits, unknown keys, and unsafe patch shapes", () => {
    expect(CreateInputSchema.safeParse({
      resource: { kind: "card", title: { kind: "plain", text: "Card" } },
      destination: {
        kind: "document",
        documentId: "document-1",
        ifRevision: "revision-1",
        at: { kind: "before", blockId: "block-1", parentBlockId: "block-2" },
      },
    }).success).toBe(false);

    expect(EditDocumentInputSchema.safeParse({
      documentId: "document-1",
      ifRevision: "revision-1",
    }).success).toBe(false);

    expect(EditDocumentInputSchema.safeParse({
      documentId: "document-1",
      ifRevision: "revision-1",
      body: {
        kind: "nfm.patch",
        patches: [{ oldNfm: "", newNfm: "replacement" }],
      },
    }).success).toBe(false);

    expect(EditDocumentInputSchema.safeParse({
      documentId: "document-1",
      ifRevision: "revision-1",
      body: { kind: "nfm.replace", content: "Replacement", extra: true },
    }).success).toBe(false);
  });

  test("classifies potentially deleting document operations as destructive", () => {
    const replacement = EditDocumentInputSchema.parse({
      documentId: "document-1",
      ifRevision: "revision-1",
      body: { kind: "nfm.replace", content: "New body" },
    });
    const deletion = EditDocumentInputSchema.parse({
      documentId: "document-1",
      ifRevision: "revision-1",
      body: {
        kind: "blocks",
        edits: [{ kind: "delete", blockId: "block-1" }],
      },
    });

    expect(NODEX_AGENT_TOOL_CONTRACTS.edit_document.classifyEffect(replacement)).toBe(
      "destructive",
    );
    expect(NODEX_AGENT_TOOL_CONTRACTS.edit_document.classifyEffect(deletion)).toBe(
      "destructive",
    );
  });
});
