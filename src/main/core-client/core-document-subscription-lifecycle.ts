import { CoreModuleResponseError } from "./core-client";

interface ReconnectableDocumentSubscription {
  waitUntilConnected(): Promise<void>;
  reconnectAfterSubscriptionLoss(): Promise<void>;
}

export const executeWithDocumentSubscription = async <Value>(
  subscription: ReconnectableDocumentSubscription,
  isCurrent: () => boolean,
  execute: () => Promise<Value>,
): Promise<Value> => {
  await subscription.waitUntilConnected();
  try {
    return await execute();
  } catch (error) {
    const reconnectRequired =
      error instanceof CoreModuleResponseError
      && error.coreError.code === "unauthorized"
      && error.coreError.recovery.kind ===
        "reconnect_document_subscription";
    if (!reconnectRequired || !isCurrent()) throw error;
    await subscription.reconnectAfterSubscriptionLoss();
    if (!isCurrent()) throw error;
    return await execute();
  }
};
