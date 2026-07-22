export function resolveSideChatProjectId(input: {
  ready: boolean;
  conversationProjectId: string | null | undefined;
  parentProjectId: string | null;
}): string | null {
  if (!input.ready || input.conversationProjectId === undefined) {
    return input.parentProjectId;
  }

  return input.conversationProjectId;
}
