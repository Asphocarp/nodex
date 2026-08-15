import {
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";
import { editorCodeBlockOptions } from "./code-block-options";
import { createAgentConfigInlineContentSpec } from "./agent-config-chip";
import { createAttachmentInlineContentSpec } from "./attachment-chip";
import { createCalloutBlock } from "./callout-block";
import { createCanvasBlockSpec } from "./canvas-block";
import {
  createPageBlockSpec,
  createPageRefBlockSpec,
} from "./page-outliner-block";
import { createDateMentionInlineContentSpec } from "./date-mention-inline-content-spec";
import { createDatabaseViewRefBlockSpec } from "./database-view-ref-block";
import { createDatabaseBlockSpec } from "./database-block";
import { imageBlockSpec } from "./image-block";
import { createThreadSectionBlockSpec } from "./thread-section-block";
import { createThreadMentionInlineContentSpec } from "./thread-mention-chip";
import { createPageMentionInlineContentSpec } from "./page-mention-inline-content";
import { createSyncedBlockRefBlockSpec } from "./synced-block-ref-block";
import { createReusableTemplateRefBlockSpec } from "./document-bearing-shell-block";

export const nfmSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    toggleListItem: defaultBlockSpecs.toggleListItem,
    codeBlock: createCodeBlockSpec(editorCodeBlockOptions),
    table: defaultBlockSpecs.table,
    quote: defaultBlockSpecs.quote,
    divider: defaultBlockSpecs.divider,
    image: imageBlockSpec,
    callout: createCalloutBlock(),
    threadSection: createThreadSectionBlockSpec(),
    page: createPageBlockSpec(),
    database: createDatabaseBlockSpec(),
    canvas: createCanvasBlockSpec(),
    databaseViewRef: createDatabaseViewRefBlockSpec(),
    pageRef: createPageRefBlockSpec(),
    syncedBlockRef: createSyncedBlockRefBlockSpec(),
    templateRef: createReusableTemplateRefBlockSpec(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    agentConfig: createAgentConfigInlineContentSpec(),
    attachment: createAttachmentInlineContentSpec(),
    dateMention: createDateMentionInlineContentSpec(),
    pageMention: createPageMentionInlineContentSpec(),
    threadMention: createThreadMentionInlineContentSpec(),
  },
  styleSpecs: defaultStyleSpecs,
});

export type NfmSchemaType = typeof nfmSchema;
