import { useEffect } from "react";
import { appScope, useScopeHandle } from "@/lib/maitai";
import { subscribeCodexAppServerMessage } from "../app-server-message-bus";
import { removeLocalConversationViewState } from "./local-conversation-thread-view-state";

export function LocalConversationViewStateCleanupController() {
  const appHandle = useScopeHandle(appScope);

  useEffect(
    () =>
      subscribeCodexAppServerMessage("thread-deleted", ({ threadId }) => {
        removeLocalConversationViewState(appHandle, threadId);
      }),
    [appHandle],
  );

  return null;
}
