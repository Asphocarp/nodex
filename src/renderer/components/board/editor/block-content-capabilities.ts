export interface BlockContentSchemaLike {
  readonly blockSchema: Readonly<Record<string, { readonly content?: string }>>;
}

/** Rich inline content and unstyled source are both editable text Block content. */
export function blockHasEditableTextContent(
  schema: BlockContentSchemaLike,
  blockType: string,
): boolean {
  const content = schema.blockSchema[blockType]?.content;
  return content === "inline" || content === "plain";
}
