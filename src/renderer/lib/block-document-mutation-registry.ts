import type { BlockDocumentMutationBarrier } from "./block-document-surface-runtime";

/**
 * Resolves the live mutation barrier for a mounted document surface. Drag
 * payloads carry this renderer-local identity so a target surface can flush
 * the actual source session before Core captures its structural fence.
 */
const barriers = new Map<
  string,
  Map<number, BlockDocumentMutationBarrier>
>();
let nextRegistrationId = 1;

export const registerBlockDocumentMutationBarrier = (
  surfaceId: string,
  barrier: BlockDocumentMutationBarrier,
): (() => void) => {
  const registrationId = nextRegistrationId;
  nextRegistrationId += 1;
  const registrations = barriers.get(surfaceId) ?? new Map();
  registrations.set(registrationId, barrier);
  barriers.set(surfaceId, registrations);
  return () => {
    const current = barriers.get(surfaceId);
    if (!current || !current.delete(registrationId)) return;
    if (current.size === 0) barriers.delete(surfaceId);
  };
};

export const resolveBlockDocumentMutationBarrier = (
  surfaceId: string,
): BlockDocumentMutationBarrier | null => {
  const registrations = barriers.get(surfaceId);
  if (!registrations || registrations.size === 0) return null;
  return [...registrations.values()].at(-1) ?? null;
};
