export type AgentDocumentEditCompilerErrorCode =
  | "invalid_arguments"
  | "invalid_nfm"
  | "nfm_patch_mismatch"
  | "nfm_patch_overlap"
  | "protected_owner_deletion";

export class AgentDocumentEditCompilerError extends Error {
  public constructor(
    public readonly code: AgentDocumentEditCompilerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentDocumentEditCompilerError";
  }
}

export interface ExactNfmPatch {
  readonly oldNfm: string;
  readonly newNfm: string;
  readonly expectedMatches?: number;
}

interface PatchSpan {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
  readonly patchIndex: number;
}

export function applyExactNfmPatches(
  source: string,
  patches: readonly ExactNfmPatch[],
): string {
  const spans: PatchSpan[] = [];
  patches.forEach((patch, patchIndex) => {
    const starts: number[] = [];
    let from = 0;
    while (from <= source.length - patch.oldNfm.length) {
      const start = source.indexOf(patch.oldNfm, from);
      if (start === -1) break;
      starts.push(start);
      from = start + 1;
    }
    const expected = patch.expectedMatches ?? 1;
    if (starts.length !== expected) {
      throw new AgentDocumentEditCompilerError(
        "nfm_patch_mismatch",
        `NFM patch ${patchIndex} matched ${starts.length} span(s); expected ${expected}`,
      );
    }
    starts.forEach((start) => spans.push({
      start,
      end: start + patch.oldNfm.length,
      replacement: patch.newNfm,
      patchIndex,
    }));
  });
  spans.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < spans.length; index += 1) {
    const previous = spans[index - 1];
    const current = spans[index];
    if (previous && current && current.start < previous.end) {
      throw new AgentDocumentEditCompilerError(
        "nfm_patch_overlap",
        `NFM patches ${previous.patchIndex} and ${current.patchIndex} overlap`,
      );
    }
  }
  return [...spans]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, span) => result.slice(0, span.start) + span.replacement + result.slice(span.end),
      source,
    );
}
