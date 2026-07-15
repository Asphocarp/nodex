import { MAX_CARD_WRITE_BODY_BYTES } from "../card-limits";

export const NESTED_MARKDOWN_COMPACT_HINT =
  'Nested Markdown is Markdown with Nodex tags and tab-nested Blocks. Use one literal tab per child level; spaces do not nest. Example string: "▶ Toggle title\\n\\tChild paragraph\\n\\t- [ ] Child task".';

export const NESTED_MARKDOWN_AGENT_GUIDE = {
  format: "markdown" as const,
  specificationVersion: "1",
  instructions: [
    NESTED_MARKDOWN_COMPACT_HINT,
    "Send one complete string to create, replace, patch, or insert many Blocks atomically. Leading spaces remain authored content; only literal tabs express Block ancestry.",
    "Use Markdown headings, lists, tasks, quotes, code, and <empty-block/> for an intentional empty Block. Nodex tags include <mention-thread>, <mention-date>, <mention-card>, attachments, and agent configuration.",
    "<card uuid=\"…\" /> is an owning Card shell and may only preserve or reorder a Card already owned by the same body. <mention-card url=\"nodex://cards/…\" /> is a non-owning reference. Use create_cards, move_cards, or duplicate_card for owning Cards.",
    `A complete body is limited to ${MAX_CARD_WRITE_BODY_BYTES} UTF-8 bytes. Use fetch format=blocks before advanced_update_card when stable Block identity matters.`,
    "Card titles use a single-line inline subset with styles, links, thread mentions, and date mentions; titles reject Block syntax, tabs, line breaks, attachments, agent configuration, and Card Blocks.",
  ].join(" "),
  examples: [
    "# Launch plan\nContext paragraph\n\t- [ ] Confirm scope\n\t- [x] Record decision",
    "> Important\n\tNested explanation",
    '<mention-card url="nodex://cards/CARD_BLOCK_ID" />',
  ],
} as const;

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
