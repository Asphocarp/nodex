import { describe, expect, test } from "vitest";
import {
  registerBlockDocumentMutationBarrier,
  resolveBlockDocumentMutationBarrier,
} from "./block-document-mutation-registry";

describe("Block Document mutation barrier registry", () => {
  test("does not let an older surface disposer remove the current runtime", () => {
    const first = { prepareDurableMutation: async () => undefined } as never;
    const second = { prepareDurableMutation: async () => undefined } as never;
    const unregisterFirst = registerBlockDocumentMutationBarrier("surface-1", first);
    const unregisterSecond = registerBlockDocumentMutationBarrier("surface-1", second);

    expect(resolveBlockDocumentMutationBarrier("surface-1")).toBe(second);
    unregisterFirst();
    expect(resolveBlockDocumentMutationBarrier("surface-1")).toBe(second);
    unregisterSecond();
    expect(resolveBlockDocumentMutationBarrier("surface-1")).toBeNull();
  });
});
