import { describe, expect, test } from "vitest";
import type {
  BlockPropertyMutationCommandResultV2,
  BlockPropertyMutationRequestV2,
} from "../shared/block-property-mutations-v2";
import {
  BLOCK_PROPERTY_MUTATION_IPC_CHANNEL,
  registerBlockPropertyMutationIpcHandler,
  type BlockPropertyMutationIpcHandler,
} from "./block-property-mutation-ipc";

const request: BlockPropertyMutationRequestV2 = {
  version: 2,
  mutationId: "mutation-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  clientSessionId: "spoofed",
  actor: { kind: "spoofed" },
  fields: [
    {
      scope: "intrinsic",
      blockId: "card-1",
      propertyKey: "run.baseBranch",
      operation: "set",
      expectedRevision: 1,
      value: "running",
    },
  ],
};

const committed = (
  bound: BlockPropertyMutationRequestV2,
): BlockPropertyMutationCommandResultV2 => ({
  ok: true,
  value: {
    version: 2,
    mutationId: bound.mutationId,
    projectId: bound.projectId,
    storeEpoch: bound.storeEpoch,
    duplicate: false,
    fields: [
      {
        path: "intrinsic/card-1/run.baseBranch",
        scope: "intrinsic",
        blockId: "card-1",
        propertyKey: "run.baseBranch",
        operation: "set",
        revision: 2,
        value: "running",
      },
    ],
    blockMetadataRevisions: { "card-1": 2 },
    commitSeq: 1,
    committedAt: "2026-07-11T00:00:00.000Z",
  },
});

const register = (options: {
  readonly trusted: boolean;
  readonly apply?: (
    request: BlockPropertyMutationRequestV2,
  ) => Promise<BlockPropertyMutationCommandResultV2>;
}): {
  readonly invoke: (
    projectId: string,
    request: unknown,
  ) => Promise<BlockPropertyMutationCommandResultV2>;
  readonly captured: BlockPropertyMutationRequestV2[];
} => {
  let handler: BlockPropertyMutationIpcHandler | null = null;
  const captured: BlockPropertyMutationRequestV2[] = [];
  registerBlockPropertyMutationIpcHandler({
    registerHandle: (channel, listener) => {
      expect(channel).toBe(BLOCK_PROPERTY_MUTATION_IPC_CHANNEL);
      handler = listener;
    },
    resolveTrustedIdentity: () =>
      options.trusted
        ? {
            actor: { kind: "electron_renderer", clientId: "renderer-1" },
            clientSessionId: "renderer-1",
          }
        : null,
    applyMutation: async (bound) => {
      captured.push(bound);
      return options.apply ? await options.apply(bound) : committed(bound);
    },
  });
  return {
    captured,
    invoke: async (projectId, input) => {
      if (!handler) throw new Error("IPC handler was not registered");
      return await handler(
        { sender: "fixture" },
        projectId,
        input as BlockPropertyMutationRequestV2,
      );
    },
  };
};

describe("Block property mutation IPC", () => {
  test("binds audit identity to the trusted renderer before writing", async () => {
    const harness = register({ trusted: true });
    const result = await harness.invoke("project-1", request);

    expect(result.ok).toBe(true);
    expect(harness.captured.length).toBe(1);
    expect(harness.captured[0]?.mutationId).toBe("mutation-1");
    expect(harness.captured[0]?.clientSessionId).toBe("renderer-1");
    expect(harness.captured[0]?.actor.kind).toBe("electron_renderer");
  });

  test("rejects untrusted senders and Project mismatches before the writer", async () => {
    const untrusted = register({ trusted: false });
    const unauthorized = await untrusted.invoke("project-1", null);
    expect(unauthorized.ok).toBe(false);
    if (unauthorized.ok) return;
    expect(unauthorized.error.code).toBe("invalid_property_mutation_request");
    expect(untrusted.captured.length).toBe(0);

    const scoped = register({ trusted: true });
    const mismatch = await scoped.invoke("project-2", request);
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) return;
    expect(mismatch.error.code).toBe("invalid_property_mutation_request");
    expect(scoped.captured.length).toBe(0);
  });

  test("keeps backend failures inside the typed result envelope", async () => {
    const harness = register({
      trusted: true,
      apply: async () => {
        throw new Error("worker offline");
      },
    });
    const result = await harness.invoke("project-1", request);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unknown");
    expect(result.error.retryable).toBe(true);
    expect(result.error.mutationId).toBe("mutation-1");
  });
});
