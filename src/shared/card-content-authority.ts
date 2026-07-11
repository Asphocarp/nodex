import type { CardInput } from "./types";

export const CARD_DOCUMENT_PATCH_FIELDS = ["title", "description"] as const;

export type CardDocumentPatchField =
  (typeof CARD_DOCUMENT_PATCH_FIELDS)[number];

export type CardMetadataPatch = Partial<
  Omit<CardInput, CardDocumentPatchField>
>;

export const CARD_DOCUMENT_MUTATION_REQUIRED_MESSAGE =
  "Card title and description belong to the Card Document. Use a Y.Doc Document mutation; whole-body NFM replacement is an explicit generation/head-CAS import only.";

export const findCardDocumentPatchFields = (
  patch: object,
): readonly CardDocumentPatchField[] =>
  CARD_DOCUMENT_PATCH_FIELDS.filter((field) => Object.hasOwn(patch, field));

export const assertCardUpdateExcludesDocumentContent = (
  patch: object,
): void => {
  const documentFields = findCardDocumentPatchFields(patch);
  if (documentFields.length === 0) return;
  throw new TypeError(
    `${CARD_DOCUMENT_MUTATION_REQUIRED_MESSAGE} Rejected fields: ${documentFields.join(", ")}.`,
  );
};
