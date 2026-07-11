import {
  BlockNoteSchema,
  createBlockSpec,
  createInlineContentSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
  type BlockConfig,
  type CustomInlineContentConfig,
  type PropSchema,
  type StyleSchema,
} from "@blocknote/core";
import {
  agentConfigInlineContentConfig,
  attachmentInlineContentConfig,
  calloutBlockConfig,
  cardRefBlockConfig,
  cardToggleBlockConfig,
  databaseViewRefBlockConfig,
  dateMentionInlineContentConfig,
  threadMentionInlineContentConfig,
  threadSectionBlockConfig,
  toggleListInlineViewBlockConfig,
} from "./blocknote-schema-config";

const failHeadlessRender = (): never => {
  throw new Error("The headless Block Document schema does not render DOM content");
};

const createHeadlessBlockSpec = <
  const TType extends string,
  const TProps extends PropSchema,
  const TContent extends "inline" | "none",
>(config: BlockConfig<TType, TProps, TContent>) =>
  createBlockSpec(config, { render: failHeadlessRender })();

const createHeadlessInlineContentSpec = <
  const TConfig extends CustomInlineContentConfig,
>(config: TConfig) =>
  createInlineContentSpec<TConfig, StyleSchema>(config, {
    render: failHeadlessRender,
  });

/**
 * The canonical Block Document schema for Node-side Yjs conversion and
 * validation. Its implementations are intentionally non-rendering: callers
 * may use the ProseMirror schema, `blocksToYDoc`, and
 * `yXmlFragmentToBlocks`, but DOM export belongs to a renderer adapter.
 */
export const headlessBlockDocumentSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    toggleListItem: defaultBlockSpecs.toggleListItem,
    codeBlock: defaultBlockSpecs.codeBlock,
    table: defaultBlockSpecs.table,
    quote: defaultBlockSpecs.quote,
    divider: defaultBlockSpecs.divider,
    image: defaultBlockSpecs.image,
    callout: createHeadlessBlockSpec(calloutBlockConfig),
    threadSection: createHeadlessBlockSpec(threadSectionBlockConfig),
    cardToggle: createHeadlessBlockSpec(cardToggleBlockConfig),
    toggleListInlineView: createHeadlessBlockSpec(toggleListInlineViewBlockConfig),
    cardRef: createHeadlessBlockSpec(cardRefBlockConfig),
    databaseViewRef: createHeadlessBlockSpec(databaseViewRefBlockConfig),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    agentConfig: createHeadlessInlineContentSpec(agentConfigInlineContentConfig),
    attachment: createHeadlessInlineContentSpec(attachmentInlineContentConfig),
    dateMention: createHeadlessInlineContentSpec(dateMentionInlineContentConfig),
    threadMention: createHeadlessInlineContentSpec(threadMentionInlineContentConfig),
  },
  styleSpecs: defaultStyleSpecs,
});

export type HeadlessBlockDocumentEditor =
  typeof headlessBlockDocumentSchema.BlockNoteEditor;
export type HeadlessBlockDocumentBlock =
  typeof headlessBlockDocumentSchema.Block;
export type HeadlessBlockDocumentPartialBlock =
  typeof headlessBlockDocumentSchema.PartialBlock;
