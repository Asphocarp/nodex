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
import { createCardToggleBlockSpec } from "./card-toggle-block";
import { createCardRefBlockSpec } from "./card-ref-block";
import { createDateMentionInlineContentSpec } from "./date-mention-chip";
import { imageBlockSpec } from "./image-block";
import { createThreadSectionBlockSpec } from "./thread-section-block";
import { createThreadMentionInlineContentSpec } from "./thread-mention-chip";
import { createToggleListInlineViewBlockSpec } from "./toggle-list-inline-view-block";

export const toggleListSchema = BlockNoteSchema.create({
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
    cardToggle: createCardToggleBlockSpec(),
    toggleListInlineView: createToggleListInlineViewBlockSpec(),
    cardRef: createCardRefBlockSpec(),
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
