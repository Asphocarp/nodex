import { MAX_CARD_WRITE_BODY_BYTES } from "../card-limits";

export const NFM_AGENT_GUIDE = {
  format: "nfm" as const,
  specificationVersion: "1",
  instructions: [
    "NFM is Nodex's complete document language: send one string to create, replace, patch, or insert many Blocks atomically.",
    "Use tabs, never spaces, for Block nesting. Escape \\ * ~ ` $ [ ] < > { } | ^ with a backslash when the character is literal.",
    "Use Markdown headings/lists/tasks/quotes/code and <empty-block/> for an intentional empty Block. Supported Nodex extensions include <mention-thread>, <mention-date>, <mention-card>, attachments, and agent configuration.",
    "<card uuid=\"…\" /> is an owning Card shell and may only preserve or reorder a Card already owned by the same Document. <mention-card url=\"nodex://cards/…\" /> is a non-owning reference. Use create or transfer_blocks to create/copy/move owned Cards.",
    `A complete NFM body is limited to ${MAX_CARD_WRITE_BODY_BYTES} UTF-8 bytes. Read stable Block identities with get_block format=blocks when an identity-sensitive edit is needed.`,
  ].join(" "),
  examples: [
    "# Launch plan\nContext paragraph\n\t- [ ] Confirm scope\n\t- [x] Record decision",
    "> Important\n\tNested explanation",
    '<mention-card url="nodex://cards/CARD_BLOCK_ID" />',
  ],
} as const;
