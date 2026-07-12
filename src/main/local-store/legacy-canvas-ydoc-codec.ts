/**
 * Migration-only codec for importing the pre-v71 Canvas Y.Doc representation.
 * Runtime Canvas code must use the portable scene contracts and scene store.
 */
export {
  createCanvasDocument,
  inspectCanvasDocument,
  type CanvasSceneMaterialization,
  type CanvasSceneSnapshot,
} from "../../shared/block-documents/canvas-document";
