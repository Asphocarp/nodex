import {
  defaultProps,
  type CustomBlockConfig,
  type CustomInlineContentConfig,
} from "@blocknote/core";

export const calloutBlockConfig = {
  type: "callout",
  propSchema: {
    ...defaultProps,
    icon: { default: "💡" },
  },
  content: "inline",
} as const satisfies CustomBlockConfig;

export const cardToggleBlockConfig = {
  type: "cardToggle",
  propSchema: {
    ...defaultProps,
    cardId: { default: "" },
    meta: { default: "" },
    snapshot: { default: "" },
    sourceProjectId: { default: "" },
    sourceStatus: { default: "" },
    sourceStatusName: { default: "" },
    projectionOwnerId: { default: "" },
    projectionKind: { default: "" },
    projectionSourceProjectId: { default: "" },
    projectionCardId: { default: "" },
  },
  content: "inline",
} as const satisfies CustomBlockConfig;

export const cardRefBlockConfig = {
  type: "cardRef",
  propSchema: {
    sourceProjectId: { default: "default" },
    cardId: { default: "" },
  },
  content: "none",
} as const satisfies CustomBlockConfig;

export const threadSectionBlockConfig = {
  type: "threadSection",
  propSchema: {
    ...defaultProps,
    label: { default: "" },
    threadId: { default: "" },
  },
  content: "none",
} as const satisfies CustomBlockConfig;

export const toggleListInlineViewBlockConfig = {
  type: "toggleListInlineView",
  propSchema: {
    ...defaultProps,
    sourceProjectId: { default: "default" },
    rulesV2B64: { default: "" },
    propertyOrderCsv: { default: "priority,estimate,status" },
    hiddenPropertiesCsv: { default: "" },
    showEmptyEstimate: { default: "false" },
    showEmptyPriority: { default: "false" },
  },
  content: "none",
} as const satisfies CustomBlockConfig;

export const attachmentInlineContentConfig = {
  type: "attachment",
  propSchema: {
    kind: { default: "text" },
    mode: { default: "materialized" },
    source: { default: "" },
    name: { default: "" },
    mimeType: { default: undefined, type: "string" },
    bytes: { default: undefined, type: "number" },
    origin: { default: undefined, type: "string" },
  },
  content: "none",
} as const satisfies CustomInlineContentConfig;

export const agentConfigInlineContentConfig = {
  type: "agentConfig",
  propSchema: {
    mode: { default: "" },
    model: { default: "" },
    reasoning: { default: "" },
    unknownAttributes: { default: "" },
    rawAttributes: { default: "" },
  },
  content: "none",
} as const satisfies CustomInlineContentConfig;

export const dateMentionInlineContentConfig = {
  type: "dateMention",
  propSchema: {
    start: { default: "" },
    end: { default: "" },
    tz: { default: "" },
    format: { default: "" },
    timeFormat: { default: "" },
    reminder: { default: "" },
  },
  content: "none",
} as const satisfies CustomInlineContentConfig;

export const threadMentionInlineContentConfig = {
  type: "threadMention",
  propSchema: {
    uuid: { default: "" },
  },
  content: "none",
} as const satisfies CustomInlineContentConfig;

export const blockDocumentCustomBlockConfigs = {
  callout: calloutBlockConfig,
  threadSection: threadSectionBlockConfig,
  cardToggle: cardToggleBlockConfig,
  toggleListInlineView: toggleListInlineViewBlockConfig,
  cardRef: cardRefBlockConfig,
} as const;

export const blockDocumentCustomInlineContentConfigs = {
  agentConfig: agentConfigInlineContentConfig,
  attachment: attachmentInlineContentConfig,
  dateMention: dateMentionInlineContentConfig,
  threadMention: threadMentionInlineContentConfig,
} as const;
