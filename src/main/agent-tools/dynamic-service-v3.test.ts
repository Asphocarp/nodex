import { describe, expect, test, vi } from "vitest";
import type { NodexAgentMutationEnvelope } from "./dynamic-service-v3-port";
import {
  CreatePagesV3InputSchema,
  CreatePagesV3OutputSchema,
  NODEX_APP_TOOL_NAMESPACE,
  NODEX_APP_V5_TOOLSET_REVISION,
  UpdatePageV3InputSchema,
  UpdatePageV3OutputSchema,
  type NodexAgentCreatePagesCommand,
} from "../../shared/nodex-agent-tools";
import type { NodexAgentDynamicExecutionContext } from "./dynamic-service-core";
import {
  NodexAgentV3DynamicService,
  type NodexAgentV3DocumentHub,
  type NodexAgentV3Writer,
} from "./dynamic-service-v3";

const ETAG = `nxe1.${"a".repeat(43)}`;

function envelope<T>(result: T): NodexAgentMutationEnvelope<T> {
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
  resolveResourceAccess: NodexAgentDynamicExecutionContext["resolveResourceAccess"] =
    async (intents) => ({
      kind: "consent_required",
      requirements: [{
        intent: intents[0] ?? {
          target: { kind: "library", libraryId: "library-v3" },
          action: "create_child",
        },
        grant: {
          root: { kind: "library", libraryId: "library-v3" },
          access: "read_write",
          libraryActions: ["create_child"],
        },
        reason: "library_consent_required",
        persistable: false,
      }],
      inspectionAccess: {
        kind: "inspection",
        scope: "call",
        threadId: "thread-v3",
        turnId: "turn-v3",
        callId: "call-v3",
        rootThreadId: "thread-v3",
        actorProjectId: "project-v3",
        libraryId: "library-v3",
        storeEpoch: "store-v3",
        grants: [{
          root: { kind: "library", libraryId: "library-v3" },
          access: "read_write",
          libraryActions: ["create_child"],
        }],
      },
    }),
): NodexAgentDynamicExecutionContext {
  const authority = {
    threadId: "thread-v3",
    turnId: "turn-v3",
    rootThreadId: "thread-v3",
    actorProjectId: "project-v3",
    libraryId: "library-v3",
    storeEpoch: "store-v3",
    scope: "project" as const,
    source: "project_turn" as const,
  };
  return {
    threadId: "thread-v3",
    callId: "call-v3",
    authority,
    access: {
      read: "allowed",
      write: "consent_required",
      domains: ["document", "placement", "database"],
    },
    resolveResourceAccess,
    authorize,
  };
}

describe("NodexAgentV3DynamicService", () => {
  test("authorizes and executes a complete Card batch with a Markdown preview", async () => {
    const input = CreatePagesV3InputSchema.parse({
      destination: { kind: "library" },
      pages: [{
        title: "**Launch** plan",
        markdown: "## Milestones\n\n- [ ] Ship",
      }],
    });
    const output = CreatePagesV3OutputSchema.parse({
      data: {
        pages: [{
          pageId: "page-created",
          location: { kind: "library", libraryId: "library-v3" },
          bodyBlocksCreated: 2,
        }],
        created: 1,
      },
    });
    const command: NodexAgentCreatePagesCommand = {
      threadId: "thread-v3",
      callId: "call-v3",
      projectId: "project-v3",
      requestHash: "request-hash",
      mutationId: "mutation-v3",
      storeEpoch: "store-v3",
      input,
      destination: { kind: "space" },
      pages: [{
        input: {
          resource: {
            kind: "page",
            title: { kind: "plain", text: "Launch plan" },
            body: { format: "nfm", content: "## Milestones\n\n- [ ] Ship" },
          },
          destination: { kind: "space" },
        },
        pageId: output.data.pages[0]?.pageId ?? "page-created",
        bodyBlockIds: ["block-heading", "block-task"],
        primaryMembershipId: "membership-primary",
        targetMembershipId: "membership-target",
      }],
    };
    const trace: string[] = [];
    const prepareNodexAgentCreatePages = vi.fn(async (request) => {
      trace.push("prepare");
      return envelope({
        ok: true as const,
        value: {
          kind: "prepared" as const,
          command: {
            ...command,
            ...(request.resourceAccess
              ? { resourceAccess: request.resourceAccess }
              : {}),
          },
          documentHeads: [],
          previews: [{
            pageId: "page-created",
            title: "Launch plan",
            bodyBlockCount: 2,
            targetMarkdown: "## Milestones\n\n- [ ] Ship",
          }],
        },
      });
    });
    const executeNodexAgentCreatePages = vi.fn(async () => {
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
      prepareNodexAgentPageUpdate: unavailable(),
      completeNodexAgentPageUpdate: unavailable(),
      prepareNodexAgentCreatePages,
      prepareNodexAgentDuplicatePage: unavailable(),
      prepareNodexAgentMovePages: unavailable(),
    } as unknown as NodexAgentV3Writer;
    const documentHub = {
      applyDocumentMutation: unavailable(),
      executeNodexAgentCreatePages,
      executeNodexAgentDuplicatePage: unavailable(),
      executeNodexAgentMovePages: unavailable(),
    } as unknown as NodexAgentV3DocumentHub;
    const service = new NodexAgentV3DynamicService({ writer, documentHub });
    const authorize = vi.fn(async (request) => {
      trace.push("authorize");
      expect(request.tool).toBe("create_pages");
      expect(request.preview.markdownPreview).toContain("Milestones");
      expect(request.preview.nfmPreview).toBeUndefined();
      return {
        decision: "allow_task" as const,
        resourceAccess: {
          kind: "consent" as const,
          scope: "task" as const,
          rootThreadId: request.inspectionAccess.rootThreadId,
          actorProjectId: request.inspectionAccess.actorProjectId,
          libraryId: request.inspectionAccess.libraryId,
          storeEpoch: request.inspectionAccess.storeEpoch,
          grants: request.inspectionAccess.grants,
        },
      };
    });
    const recordTaskResourceAccess = vi.fn();
    const executionContext = {
      ...context(authorize),
      recordTaskResourceAccess,
    };

    await expect(service.registry.execute({
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V5_TOOLSET_REVISION,
      tool: "create_pages",
    }, input, executionContext)).resolves.toEqual({ effect: "write", output });
    expect(trace).toEqual(["prepare", "authorize", "prepare", "execute"]);
    expect(executeNodexAgentCreatePages).toHaveBeenCalledWith(
      expect.objectContaining({
        ...command,
        resourceAccess: expect.objectContaining({ scope: "task" }),
      }),
      [],
    );
    expect(recordTaskResourceAccess).toHaveBeenCalledWith([{
      root: { kind: "page", pageId: "page-created" },
      access: "read_write",
    }]);
  });

  test("classifies whole-Page replacement as destructive and completes it through the Document kernel", async () => {
    const input = UpdatePageV3InputSchema.parse({
      pageId: "page-update",
      body: { kind: "replace", markdown: "# New body", ifMatch: ETAG },
    });
    const output = UpdatePageV3OutputSchema.parse({
      data: {
        pageId: "page-update",
        effects: { created: 1, updated: 0, moved: 0, deleted: 2 },
      },
    });
    const mutation = { operationId: "document-operation" };
    const prepareNodexAgentPageUpdate = vi.fn(async () => envelope({
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
    const completeNodexAgentPageUpdate = vi.fn(async () => envelope({
      ok: true as const,
      output,
    }));
    const writer = {
      readNodexAgentV3Tool: unavailable(),
      prepareNodexAgentPageUpdate,
      completeNodexAgentPageUpdate,
      prepareNodexAgentCreatePages: unavailable(),
      prepareNodexAgentDuplicatePage: unavailable(),
      prepareNodexAgentMovePages: unavailable(),
    } as unknown as NodexAgentV3Writer;
    const documentHub = {
      applyDocumentMutation,
      executeNodexAgentCreatePages: unavailable(),
      executeNodexAgentDuplicatePage: unavailable(),
      executeNodexAgentMovePages: unavailable(),
    } as unknown as NodexAgentV3DocumentHub;
    const service = new NodexAgentV3DynamicService({ writer, documentHub });
    const authorize = vi.fn(async (request) => {
      expect(request.effect).toBe("destructive");
      expect(request.preview.markdownPreview).toBe("# New body");
      return { decision: "allow_once" as const };
    });
    const executionContext = context(authorize);

    await expect(service.registry.execute({
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V5_TOOLSET_REVISION,
      tool: "update_page",
    }, input, executionContext)).resolves.toEqual({
      effect: "destructive",
      output,
    });
    expect(prepareNodexAgentPageUpdate).toHaveBeenCalledTimes(2);
    expect(applyDocumentMutation).toHaveBeenCalledWith(mutation, {
      authority: executionContext.authority,
      resource: { kind: "page", pageId: "page-update" },
      callId: "call-v3",
    });
    expect(completeNodexAgentPageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      tool: "update_page",
      pageId: "page-update",
    }));

    const directAuthorize = vi.fn(async () => "deny" as const);
    const directContext = context(
      directAuthorize,
      async () => ({ kind: "authorized" as const }),
    );
    await expect(service.registry.execute({
      namespace: NODEX_APP_TOOL_NAMESPACE,
      toolsetRevision: NODEX_APP_V5_TOOLSET_REVISION,
      tool: "update_page",
    }, input, directContext)).resolves.toEqual({
      effect: "destructive",
      output,
    });
    expect(directAuthorize).not.toHaveBeenCalled();
    expect(prepareNodexAgentPageUpdate).toHaveBeenCalledTimes(4);
  });
});
