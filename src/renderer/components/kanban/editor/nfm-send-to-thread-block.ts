export interface NfmSendToThreadToggleBlock {
  id: string;
  type: "toggleListItem";
  props: Record<string, never>;
  content: Array<
    | { type: "text"; text: string; styles: Record<string, never> }
    | { type: "threadMention"; props: { uuid: string } }
  >;
  children: unknown[];
}

export function createSendToThreadToggleBlock(input: {
  threadId: string;
  children: unknown[];
  blockId?: string;
}): NfmSendToThreadToggleBlock {
  return {
    id: input.blockId ?? crypto.randomUUID(),
    type: "toggleListItem",
    props: {},
    content: [
      { type: "text", text: "sent to ", styles: {} },
      { type: "threadMention", props: { uuid: input.threadId } },
    ],
    children: input.children,
  };
}
