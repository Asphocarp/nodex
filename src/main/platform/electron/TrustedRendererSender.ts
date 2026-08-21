import { BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { isTrustedAppRendererIpcSender } from "../../app-renderer-ipc-authorization";

/** Synchronous Electron ingress check; callers must run it before admitting work to a fiber. */
export const requireTrustedAppRendererSender = (
  event: IpcMainInvokeEvent | IpcMainEvent,
  capabilityName: string,
  developmentOrigin: string | null,
): void => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  if (
    isTrustedAppRendererIpcSender({
      developmentOrigin,
      hasOwnerWindow: ownerWindow !== null,
      senderType: event.sender.getType(),
      senderUrl: event.senderFrame?.url ?? "",
      isMainFrame: event.senderFrame === event.sender.mainFrame,
    })
  ) {
    return;
  }
  throw new Error(`${capabilityName} is available only to the top-level app renderer`);
};
