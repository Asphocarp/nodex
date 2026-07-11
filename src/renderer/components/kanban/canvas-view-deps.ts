import { useKanban } from "@/lib/use-kanban";
import { useTheme } from "@/lib/use-theme";
import { RegisteredOwnedBlockDocumentBoundary } from "@/components/block-documents/owned-block-document-boundary";
import { OwnedBlockDocumentSurface } from "@/components/block-documents/block-document-surface";

export {
  OwnedBlockDocumentSurface,
  RegisteredOwnedBlockDocumentBoundary,
  useKanban,
  useTheme,
};

export function loadExcalidraw() {
  return import("@excalidraw/excalidraw");
}

export function loadCanvasCardSidebar() {
  return import("./canvas-card-sidebar");
}
