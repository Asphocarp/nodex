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
  canvasBlockConfig,
  pageBlockConfig,
  pageRefBlockConfig,
  cardToggleBlockConfig,
  databaseBlockConfig,
  databaseViewRefBlockConfig,
  dateMentionInlineContentConfig,
  pageMentionInlineContentConfig,
  threadMentionInlineContentConfig,
  threadSectionBlockConfig,
  syncedBlockRefBlockConfig,
  reusableTemplateRefBlockConfig,
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
const headlessBlockDocumentBlockSpecs = {
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
    page: createHeadlessBlockSpec(pageBlockConfig),
    database: createHeadlessBlockSpec(databaseBlockConfig),
    canvas: createHeadlessBlockSpec(canvasBlockConfig),
    threadSection: createHeadlessBlockSpec(threadSectionBlockConfig),
    cardToggle: createHeadlessBlockSpec(cardToggleBlockConfig),
    toggleListInlineView: createHeadlessBlockSpec(toggleListInlineViewBlockConfig),
    pageRef: createHeadlessBlockSpec(pageRefBlockConfig),
    databaseViewRef: createHeadlessBlockSpec(databaseViewRefBlockConfig),
    syncedBlockRef: createHeadlessBlockSpec(syncedBlockRefBlockConfig),
    templateRef: createHeadlessBlockSpec(reusableTemplateRefBlockConfig),
} as const;

export const HEADLESS_BLOCK_DOCUMENT_BLOCK_TYPES = Object.freeze(
  Object.keys(headlessBlockDocumentBlockSpecs),
);

export const headlessBlockDocumentSchema = BlockNoteSchema.create({
  blockSpecs: headlessBlockDocumentBlockSpecs,
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    agentConfig: createHeadlessInlineContentSpec(agentConfigInlineContentConfig),
    attachment: createHeadlessInlineContentSpec(attachmentInlineContentConfig),
    dateMention: createHeadlessInlineContentSpec(dateMentionInlineContentConfig),
    pageMention: createHeadlessInlineContentSpec(pageMentionInlineContentConfig),
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
