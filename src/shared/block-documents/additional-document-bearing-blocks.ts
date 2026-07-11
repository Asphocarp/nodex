export const REUSABLE_TEMPLATE_SOURCE_TYPE = "reusable_template_source";
export const REUSABLE_TEMPLATE_REFERENCE_TYPE = "templateRef";
export const REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_KEY = "nodex.reusable-template";
export const REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_VERSION = 1;

export const LARGE_DOCUMENT_BLOCK_TYPE = "largeDocument";
export const LARGE_DOCUMENT_SCHEMA_KEY = "nodex.large-document";
export const LARGE_DOCUMENT_SCHEMA_VERSION = 1;

export const LARGE_CODE_BLOCK_TYPE = "largeCode";
export const LARGE_CODE_DOCUMENT_SCHEMA_KEY = "nodex.large-code";
export const LARGE_CODE_DOCUMENT_SCHEMA_VERSION = 1;

export type AdditionalBlockDocumentKind =
  | "reusable_template"
  | "large_document"
  | "large_code";
