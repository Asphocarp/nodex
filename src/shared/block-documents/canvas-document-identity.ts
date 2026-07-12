export const CANVAS_BLOCK_TYPE = "canvas";
export const CANVAS_DOCUMENT_SCHEMA_KEY = "nodex.canvas";
export const CANVAS_DOCUMENT_SCHEMA_VERSION = 1;

export const primaryCanvasBlockId = (projectId: string): string =>
  `canvas:primary:${projectId}`;

export const primaryCanvasDocumentId = (projectId: string): string =>
  `document:canvas:primary:${projectId}`;
