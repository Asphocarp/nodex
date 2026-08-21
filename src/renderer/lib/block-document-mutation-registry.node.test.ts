import { describe, expect, test } from "vitest";
import {
  registerBlockDocumentStructuralMutationParticipant,
  resolveBlockDocumentStructuralMutationParticipant,
} from "./block-document-mutation-registry";

describe("Block Document structural mutation participant registry", () => {
  test("does not let an older surface disposer remove the current runtime", () => {
    const first = { prepareAndFence: async () => undefined } as never;
    const second = { prepareAndFence: async () => undefined } as never;
    const unregisterFirst = registerBlockDocumentStructuralMutationParticipant("surface-1", first);
    const unregisterSecond = registerBlockDocumentStructuralMutationParticipant(
      "surface-1",
      second,
    );

    expect(resolveBlockDocumentStructuralMutationParticipant("surface-1")).toBe(second);
    unregisterFirst();
    expect(resolveBlockDocumentStructuralMutationParticipant("surface-1")).toBe(second);
    unregisterSecond();
    expect(resolveBlockDocumentStructuralMutationParticipant("surface-1")).toBeNull();
  });
});
