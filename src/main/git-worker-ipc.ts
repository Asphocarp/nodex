import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  GIT_WORKER_MESSAGE_FROM_VIEW_CHANNEL,
  isGitWorkerMessageFromView,
} from "../shared/git-worker-protocol";
import { isTrustedAppRendererIpcSender } from "./app-renderer-ipc-authorization";
import type { GitWorkerHost } from "./git-worker-host";
import { captureMainException } from "./observability/sentry-main";

function requireTrustedGitWorkerSender(event: IpcMainInvokeEvent): void {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  if (isTrustedAppRendererIpcSender({
    developmentOrigin: process.env.ELECTRON_RENDERER_URL ?? null,
    hasOwnerWindow: ownerWindow !== null,
    senderType: event.sender.getType(),
    senderUrl: event.senderFrame?.url ?? "",
    isMainFrame: event.senderFrame === event.sender.mainFrame,
  })) {
    return;
  }
  throw new Error("Git worker is available only to the top-level app renderer");
}

export function registerGitWorkerIpc(host: GitWorkerHost): () => void {
  ipcMain.removeHandler(GIT_WORKER_MESSAGE_FROM_VIEW_CHANNEL);
  ipcMain.handle(
    GIT_WORKER_MESSAGE_FROM_VIEW_CHANNEL,
    (event, rawMessage: unknown) => {
      try {
        requireTrustedGitWorkerSender(event);
        if (!isGitWorkerMessageFromView(rawMessage)) {
          throw new Error("Invalid Git worker renderer message");
        }
        host.handleRendererMessage(event.sender, rawMessage);
      } catch (error) {
        captureMainException(error, {
          tags: {
            channel: GIT_WORKER_MESSAGE_FROM_VIEW_CHANNEL,
            mechanism: "ipc",
          },
          extra: {
            senderWebContentsId: event.sender.id,
          },
        });
        throw error;
      }
    },
  );
  return () => {
    ipcMain.removeHandler(GIT_WORKER_MESSAGE_FROM_VIEW_CHANNEL);
  };
}
