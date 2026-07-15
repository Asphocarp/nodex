import { describe, expect, test, vi } from "vitest";
import type { BlockMutationEnvelope } from "../block-mutation-writer";
import {
  CreateCardsV3InputSchema,
  CreateCardsV3OutputSchema,
  NODEX_APP_TOOL_NAMESPACE,
  NODEX_APP_V3_TOOLSET_REVISION,
  UpdateCardV3InputSchema,
  UpdateCardV3OutputSchema,
  type NodexAgentCreateCardsCommand,
} from "../../shared/nodex-agent-tools";
import type { NodexAgentDynamicExecutionContext } from "./dynamic-service";
import {
  NodexAgentV3DynamicService,
  type NodexAgentV3DocumentHub,
  type NodexAgentV3Writer,
} from "./dynamic-service-v3";

const ETAG = `nxe1.${"a".repeat(43)}`;

function envelope<T>(result: T): BlockMutationEnvelope<T> {
  return {
    result,
    events: [],
    metrics: {
      mutationId: "mutation-v3",
      queueWaitMs: 0,
      workerDurationMs: 1,
      transactionMs: 1,
      eventCount: 0,
    },
  };
}

function unavailable() {
  return vi.fn(async () => {
    throw new Error("Unexpected v3 dynamic-service dependency call");
  });
}

function context(
  authorize: NodexAgentDynamicExecutionContext["authorize"],
): NodexAgentDynamicExecutionContext {
  return {
    threadId: "thread-v3",
    callId: "call-v3",
    projectId: "project-v3",
    access: {
      read: "allowed",
      write: "consent_required",
      domains: ["document", "placement", "database"],
    },
    authorize,
  };
}

describe("NodexAgentV3DynamicService", () => {
  test("authorizes and executes a complete Card batch with a Markdown preview", async () => {
    const input = CreateCardsV3InputSchema.parse({
      destination: { kind: "space" },
      cards: [{
        title: "**Launch** plan",
        markdown: "## Milestones\n\n- [ ] Ship",
      }],
    });
    const output = CreateCardsV3OutputSchema.parse({
      data: {
        cards: [{
          cardId: "card-created",
          location: { kind: "space" },
          bodyBlocksCreated: 2,
        }],
        created: 1,
      },
    });
    const command: NodexAgentCreateCardsCommand = {
      threadId: "thread-v3",
      callId: "call-v3",
      projectId: "project-v3",
      requestHash: "request-hash",
      mutationId: "mutation-v3",
      storeEpoch: "store-v3",
      input,
      destination: { kind: "space" },
      cards: [{
        input: {
          resource: {
            kind: "card",
            title: { kind: "plain", text: "Launch plan" },
            body: { format: "nfm", content: "## Milestones\n\n- [ ] Ship" },
          },
          destination: { kind: "space" },
        },
        cardId: output.data.cards[0]?.cardId ?? "card-created",
        bodyBlockIds: ["block-heading", "block-task"],
        primaryMembershipId: "membership-primary",
        targetMembershipId: "membership-target",
      }],
    };
    const trace: string[] = [];
    const prepareNodexAgentCreateCards = vi.fn(async () => {
      trace.push("prepare");
      return envelope({
        ok: true as const,
        value: {
          kind: "prepared" as const,
          command,
          leaseDocuments: [],
          previews: [{
            cardId: "card-created",
            title: "Launch plan",
            bodyBlockCount: 2,
            targetMarkdown: "## Milestones\n\n- [ ] Ship",
          }],
        },
      });
    });
    const executeNodexAgentCreateCards = vi.fn(async () => {
      trace.push("execute");
      return {
        ok: true as const,
        value: {
          output,
          duplicate: false,
          documentCommits: [],
          affectedDatabaseBlockIds: [],
          changeLogSeq: 1,
        },
      };
    });
    const writer = {
      readNodexAgentV3Tool: unavailable(),
      prepareNodexAgentCardUpdate: unavailable(),
      completeNodexAgentCardUpdate: unavailable(),
      prepareNodexAgentCreateCards,
      prepareNodexAgentDuplicateCard: unavailable(),
      prepareNodexAgentMoveCards: unavailable(),
    } as unknown as NodexAgentV3Writer;
    const documentHub = {
      applyDocumentMutation: unavailable(),
      executeNodexAgentCreateCards,
      executeNodexAgentDuplicateCard: unavailable(),
      executeNodexAgentMoveCards: unavailable(),
    } as unknown as NodexAgentV3DocumentHub;
    const service = new NodexAgentV3DynamicService({ writer, documentHub });
    const authorize = vi.fn(async (request) => {
      trace.push("authorize");
      expect(request.tool).toBe("create_cards");
      expect(request.preview.markdownPreview).toContain("Milestones");
      expect(request.preview.nfmPreview).toBeUndefined();
      return "allow_once" as const;
    });

    await expect(service.registry.execute({
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V3_TOOLSET_REVISION,
      tool: "create_cards",
    }, input, context(authorize))).resolves.toEqual({ effect: "write", output });
    expect(trace).toEqual(["prepare", "authorize", "prepare", "execute"]);
    expect(executeNodexAgentCreateCards).toHaveBeenCalledWith(command, []);
  });

  test("classifies whole-Card replacement as destructive and completes it through the Document kernel", async () => {
    const input = UpdateCardV3InputSchema.parse({
      cardId: "card-update",
      body: { kind: "replace", markdown: "# New body", ifMatch: ETAG },
    });
    const output = UpdateCardV3OutputSchema.parse({
      data: {
        cardId: "card-update",
        effects: { created: 1, updated: 0, moved: 0, deleted: 2 },
      },
    });
    const mutation = { operationId: "document-operation" };
    const prepareNodexAgentCardUpdate = vi.fn(async () => envelope({
      ok: true as const,
      value: {
        kind: "prepared" as const,
        mutation,
        effects: {
          createdBlockIds: ["block-new"],
          localBlockIds: {},
          copiedBlockIds: {},
          updatedBlockIds: [],
          movedBlockIds: [],
          deletedBlockIds: ["block-old-1", "block-old-2"],
          deletedOwnerBlockIds: [],
          titleChanged: false,
        },
        targetMarkdown: "# New body",
      },
    }));
    const applyDocumentMutation = vi.fn(async () => ({
      ok: true as const,
      value: { operationId: "document-operation" },
    }));
    const completeNodexAgentCardUpdate = vi.fn(async () => envelope({
      ok: true as const,
      output,
    }));
    const writer = {
      readNodexAgentV3Tool: unavailable(),
      prepareNodexAgentCardUpdate,
      completeNodexAgentCardUpdate,
      prepareNodexAgentCreateCards: unavailable(),
      prepareNodexAgentDuplicateCard: unavailable(),
      prepareNodexAgentMoveCards: unavailable(),
    } as unknown as NodexAgentV3Writer;
    const documentHub = {
      applyDocumentMutation,
      executeNodexAgentCreateCards: unavailable(),
      executeNodexAgentDuplicateCard: unavailable(),
      executeNodexAgentMoveCards: unavailable(),
    } as unknown as NodexAgentV3DocumentHub;
    const service = new NodexAgentV3DynamicService({ writer, documentHub });
    const authorize = vi.fn(async (request) => {
      expect(request.effect).toBe("destructive");
      expect(request.preview.markdownPreview).toBe("# New body");
      return "allow_once" as const;
    });

    await expect(service.registry.execute({
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V3_TOOLSET_REVISION,
      tool: "update_card",
    }, input, context(authorize))).resolves.toEqual({
      effect: "destructive",
      output,
    });
    expect(prepareNodexAgentCardUpdate).toHaveBeenCalledTimes(2);
    expect(applyDocumentMutation).toHaveBeenCalledWith(mutation);
    expect(completeNodexAgentCardUpdate).toHaveBeenCalledWith(expect.objectContaining({
      tool: "update_card",
      cardId: "card-update",
    }));
  });
});
