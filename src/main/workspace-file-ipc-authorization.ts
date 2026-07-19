export interface WorkspaceFileIpcSenderFacts {
  readonly hasOwnerWindow: boolean;
  readonly senderType: string;
  readonly isMainFrame: boolean;
}

export function isTrustedWorkspaceFileIpcSender(
  facts: WorkspaceFileIpcSenderFacts,
): boolean {
  return (
    facts.hasOwnerWindow
    && facts.senderType === "window"
    && facts.isMainFrame
  );
}
