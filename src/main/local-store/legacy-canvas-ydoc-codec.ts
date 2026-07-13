/**
 * Import-only codec for the shipped Canvas Y.Doc representation.
 * Runtime Canvas code must use the portable scene contracts and scene store.
 */
export {
  createCanvasDocument,
  inspectCanvasDocument,
  type CanvasSceneMaterialization,
  type CanvasSceneSnapshot,
} from "../../shared/block-documents/canvas-document";
