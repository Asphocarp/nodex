/**
 * Migration-only codec for importing the pre-v71 Canvas Y.Doc representation.
 * Runtime Canvas code must use the portable scene contracts and scene store.
 */
export {
  applyCanvasForwardRestorePlan,
  applyCanvasSceneSnapshot,
  canonicalCanvasSceneFingerprint,
  compileCanvasForwardRestorePlan,
  createCanvasDocument,
  inspectCanvasDocument,
  openCanvasDocument,
  parseCanvasSceneMaterialization,
  type CanvasDocumentEnvelope,
  type CanvasElementSnapshot,
  type CanvasFileSnapshot,
  type CanvasForwardRestorePlan,
  type CanvasSceneMaterialization,
  type CanvasSceneSnapshot,
  type CanvasSharedAppState,
} from "../../shared/block-documents/canvas-document";
