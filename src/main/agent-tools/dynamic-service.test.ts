import { describe, expect, test, vi } from "vitest";
import type { BlockMutationEnvelope } from "../block-mutation-writer";
import {
  NODEX_APP_TOOL_NAMESPACE,
  NODEX_APP_V2_TOOLSET_REVISION,
  type CreateInput,
  type CreateOutput,
  type NodexAgentCreateCardCommand,
  type PrepareNodexAgentCreateResult,
} from "../../shared/nodex-agent-tools";
import {
  NodexAgentDynamicService,
  type NodexAgentDocumentHub,
  type NodexAgentDynamicExecutionContext,
  type NodexAgentWriter,
} from "./dynamic-service";

const createInput: CreateInput = {
  resource: {
    kind: "card",
    title: { kind: "plain", text: "Agent-authored Card" },
    body: { format: "nfm", content: "# Complete Card\n\nTwo Blocks." },
  },
  destination: { kind: "space" },
};

const createOutput = {
  data: {
    resource: {
      kind: "card",
      blockId: "card-1",
      documentId: "document-1",
      location: { kind: "space" },
      bodyBlockCount: 2,
      createdBodyBlockIds: ["body-1", "body-2"],
    },
  },
} as CreateOutput;

const createCommand: NodexAgentCreateCardCommand = {
  threadId: "thread-1",
  callId: "call-1",
  projectId: "project-1",
  requestHash: "request-hash",
  mutationId: "mutation-1",
  storeEpoch: "store-1",
  input: createInput,
  cardId: "card-1",
  bodyBlockIds: ["body-1", "body-2"],
  primaryMembershipId: "membership-primary",
  targetMembershipId: "membership-target",
  destination: { kind: "space" },
};

function envelope<T>(result: T): BlockMutationEnvelope<T> {
  return {
    result,
    events: [],
    metrics: {
      mutationId: "mutation-1",
      queueWaitMs: 0,
      workerDurationMs: 1,
      transactionMs: 1,
      eventCount: 0,
    },
  };
}

function createHarness(result: PrepareNodexAgentCreateResult) {
  const trace: string[] = [];
  const prepareNodexAgentCreate = vi.fn(async () => {
    trace.push("prepare");
    return envelope(result);
  });
  const executeNodexAgentCreate = vi.fn(async (...args: unknown[]) => {
    void args;
    trace.push("execute");
    return {
      ok: true as const,
      value: {
        output: createOutput,
        documentCommits: [],
        affectedDatabaseBlockIds: [],
        changeLogSeq: 1,
      },
    };
  });
  const unavailable = vi.fn(async () => {
    throw new Error("Unexpected dynamic-service dependency call");
  });
  const writer = {
    readNodexAgentTool: unavailable,
    prepareNodexAgentDocumentEdit: unavailable,
    completeNodexAgentDocumentEdit: unavailable,
    prepareNodexAgentCreate,
    prepareNodexAgentTransfer: unavailable,
    prepareNodexAgentDatabaseEdit: unavailable,
    executeNodexAgentDatabaseEdit: unavailable,
  } as unknown as NodexAgentWriter;
  const documentHub = {
    applyDocumentMutation: unavailable,
    executeNodexAgentCreate,
    executeNodexAgentTransfer: unavailable,
  } as unknown as NodexAgentDocumentHub;
  return {
    service: new NodexAgentDynamicService({ writer, documentHub }),
    prepareNodexAgentCreate,
    executeNodexAgentCreate,
    trace,
  };
}

function executionContext(
  authorize: NodexAgentDynamicExecutionContext["authorize"],
): NodexAgentDynamicExecutionContext {
  return {
    threadId: "thread-1",
    callId: "call-1",
    projectId: "project-1",
    access: {
      read: "allowed",
      write: "consent_required",
      domains: ["document", "placement", "database"],
    },
    authorize,
  };
}

async function executeCreate(
  service: NodexAgentDynamicService,
  context: NodexAgentDynamicExecutionContext,
) {
  return await service.registry.execute({
    namespace: NODEX_APP_TOOL_NAMESPACE,
    toolsetRevision: NODEX_APP_V2_TOOLSET_REVISION,
    tool: "create",
  }, createInput, context);
}

describe("NodexAgentDynamicService", () => {
  test("preflights before authorization and never executes a denied write", async () => {
    const harness = createHarness({
      ok: true,
      value: {
        kind: "prepared",
        command: createCommand,
        leaseDocuments: [],
        createdBodyBlockIds: ["body-1", "body-2"],
        targetNfm: "# Complete Card\n\nTwo Blocks.",
      },
    });
    const authorize = vi.fn(async () => {
      harness.trace.push("authorize");
      return "deny" as const;
    });

    await expect(executeCreate(
      harness.service,
      executionContext(authorize),
    )).rejects.toMatchObject({
      failure: { error: { code: "authorization_denied" } },
    });
    expect(harness.trace).toEqual(["prepare", "authorize"]);
    expect(harness.executeNodexAgentCreate).not.toHaveBeenCalled();
  });

  test("re-prepares after authorization and executes the refreshed command", async () => {
    const harness = createHarness({
      ok: true,
      value: {
        kind: "prepared",
        command: createCommand,
        leaseDocuments: [],
        createdBodyBlockIds: ["body-1", "body-2"],
        targetNfm: "# Complete Card\n\nTwo Blocks.",
      },
    });
    const authorize = vi.fn(async (input) => {
      harness.trace.push("authorize");
      expect(input.preview.nfmPreview).toContain("Complete Card");
      return "allow_once" as const;
    });

    await expect(executeCreate(
      harness.service,
      executionContext(authorize),
    )).resolves.toEqual({ effect: "write", output: createOutput });
    expect(harness.trace).toEqual(["prepare", "authorize", "prepare", "execute"]);
    expect(harness.prepareNodexAgentCreate).toHaveBeenCalledTimes(2);
    expect(harness.executeNodexAgentCreate).toHaveBeenCalledWith(createCommand, []);
  });

  test("rejects a mutation whose authorization footprint expands while consent is pending", async () => {
    const initial: PrepareNodexAgentCreateResult = {
      ok: true,
      value: {
        kind: "prepared",
        command: createCommand,
        leaseDocuments: [],
        createdBodyBlockIds: ["body-1", "body-2"],
        targetNfm: "# Complete Card\n\nTwo Blocks.",
      },
    };
    const expanded: PrepareNodexAgentCreateResult = {
      ok: true,
      value: {
        kind: "prepared",
        command: { ...createCommand, bodyBlockIds: ["body-1", "body-2", "body-3"] },
        leaseDocuments: [],
        createdBodyBlockIds: ["body-1", "body-2", "body-3"],
        targetNfm: "# Complete Card\n\nThree Blocks.",
      },
    };
    const harness = createHarness(initial);
    harness.prepareNodexAgentCreate
      .mockResolvedValueOnce(envelope(initial))
      .mockResolvedValueOnce(envelope(expanded));

    await expect(executeCreate(
      harness.service,
      executionContext(async () => "allow_once"),
    )).rejects.toMatchObject({
      failure: { error: { code: "conflict", recovery: "retry_same" } },
    });
    expect(harness.executeNodexAgentCreate).not.toHaveBeenCalled();
  });

  test("returns a durable replay result without asking again", async () => {
    const harness = createHarness({
      ok: true,
      value: { kind: "completed", output: createOutput },
    });
    const authorize = vi.fn(async () => "allow_once" as const);

    await expect(executeCreate(
      harness.service,
      executionContext(authorize),
    )).resolves.toEqual({ effect: "write", output: createOutput });
    expect(authorize).not.toHaveBeenCalled();
    expect(harness.executeNodexAgentCreate).not.toHaveBeenCalled();
  });
});
