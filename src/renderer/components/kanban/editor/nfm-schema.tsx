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
import {
  createCardBlockSpec,
  createCardRefBlockSpec,
} from "./card-outliner-block";
import { createDateMentionInlineContentSpec } from "./date-mention-chip";
import { createDatabaseViewRefBlockSpec } from "./database-view-ref-block";
import { imageBlockSpec } from "./image-block";
import { createThreadSectionBlockSpec } from "./thread-section-block";
import { createThreadMentionInlineContentSpec } from "./thread-mention-chip";
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
    card: createCardBlockSpec(),
    databaseViewRef: createDatabaseViewRefBlockSpec(),
    cardRef: createCardRefBlockSpec(),
    syncedBlockRef: createSyncedBlockRefBlockSpec(),
    templateRef: createReusableTemplateRefBlockSpec(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    agentConfig: createAgentConfigInlineContentSpec(),
    attachment: createAttachmentInlineContentSpec(),
    dateMention: createDateMentionInlineContentSpec(),
    threadMention: createThreadMentionInlineContentSpec(),
  },
  styleSpecs: defaultStyleSpecs,
});

export type NfmSchemaType = typeof nfmSchema;
