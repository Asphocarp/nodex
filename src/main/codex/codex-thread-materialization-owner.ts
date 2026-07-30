export interface CodexThreadMaterializationOwnerInput {
  readonly existingThreadFound: boolean;
  readonly existingProjectId: string | null;
  readonly explicitInitialOwnerProvided: boolean;
  readonly explicitInitialProjectId: string | null;
  readonly inferredInitialProjectId: string | null;
}

export function resolveCodexThreadMaterializationOwner(
  input: CodexThreadMaterializationOwnerInput,
): string | null {
  if (input.existingThreadFound) return input.existingProjectId;
  if (input.explicitInitialOwnerProvided) return input.explicitInitialProjectId;
  return input.inferredInitialProjectId;
}
