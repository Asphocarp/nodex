export interface CanvasCardReferenceProjection {
  readonly source_element_id: string;
  readonly target_block_id: string;
}

export interface CanvasFileProjection {
  readonly file_id: string;
  readonly mime_type: string;
  readonly asset_uri: string;
}

/** Compare reference identity as a keyed relation, independent of SQL/JS collation. */
export const isCanvasCardReferenceProjectionCurrent = (
  authorityReferences: readonly {
    readonly sourceElementId: string;
    readonly targetBlockId: string;
  }[],
  projectedReferences: readonly CanvasCardReferenceProjection[],
): boolean => {
  const expectedBySourceElement = new Map<string, string>();
  for (const reference of authorityReferences) {
    if (expectedBySourceElement.has(reference.sourceElementId)) return false;
    expectedBySourceElement.set(
      reference.sourceElementId,
      reference.targetBlockId,
    );
  }
  if (projectedReferences.length !== expectedBySourceElement.size) return false;
  return projectedReferences.every(
    (reference) =>
      expectedBySourceElement.get(reference.source_element_id) ===
      reference.target_block_id,
  );
};

/** Compare Canvas file identity as a keyed relation, independent of collation. */
export const isCanvasFileProjectionCurrent = (
  authorityFiles: Readonly<
    Record<string, { readonly mimeType: string; readonly source: string }>
  >,
  projectedFiles: readonly CanvasFileProjection[],
): boolean => {
  const expectedByFileId = new Map(Object.entries(authorityFiles));
  if (projectedFiles.length !== expectedByFileId.size) return false;
  return projectedFiles.every((projection) => {
    const expected = expectedByFileId.get(projection.file_id);
    if (!expected) return false;
    return (
      projection.mime_type === expected.mimeType &&
      projection.asset_uri === expected.source
    );
  });
};
