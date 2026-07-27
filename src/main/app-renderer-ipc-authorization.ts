export interface AppRendererIpcSenderFacts {
  readonly hasOwnerWindow: boolean;
  readonly senderType: string;
  readonly isMainFrame: boolean;
}

export function isTrustedAppRendererIpcSender(
  facts: AppRendererIpcSenderFacts,
): boolean {
  return (
    facts.hasOwnerWindow
    && facts.senderType === "window"
    && facts.isMainFrame
  );
}
