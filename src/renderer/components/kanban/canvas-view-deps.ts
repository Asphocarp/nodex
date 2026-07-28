import { useKanban } from "@/lib/use-kanban";
import { useTheme } from "@/lib/use-theme";
import { RegisteredOwnedBlockDocumentBoundary } from "@/components/block-documents/owned-block-document-boundary";
import {
  compactCanvasScene,
  createCanvasSceneSyncAdapter,
  readCanvasSceneCompaction,
} from "@/lib/api";
import { registerAppCloseFlushHandler } from "@/lib/app-close-flush";
import { createDefaultCanvasSceneOutbox } from "@/lib/canvas-scene-outbox";

export {
  RegisteredOwnedBlockDocumentBoundary,
  useKanban,
  useTheme,
  createCanvasSceneSyncAdapter,
  readCanvasSceneCompaction,
  compactCanvasScene,
  createDefaultCanvasSceneOutbox,
  registerAppCloseFlushHandler,
};

export function loadExcalidraw() {
  return import("@excalidraw/excalidraw");
}

export function loadCanvasCardSidebar() {
  return import("./canvas-card-sidebar");
}
