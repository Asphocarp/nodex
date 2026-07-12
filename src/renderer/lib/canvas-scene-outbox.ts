import type { CanvasSceneMutationRequest } from "../../shared/block-documents";

export interface CanvasSceneOutbox {
  list: (documentId: string) => Promise<readonly CanvasSceneMutationRequest[]>;
  put: (request: CanvasSceneMutationRequest) => Promise<void>;
  remove: (documentId: string, mutationId: string) => Promise<void>;
  clear: (documentId: string) => Promise<void>;
}

/** Deterministic test/default-memory implementation; production may use IndexedDB. */
export class MemoryCanvasSceneOutbox implements CanvasSceneOutbox {
  private readonly requests = new Map<
    string,
    Map<string, CanvasSceneMutationRequest>
  >();

  list = async (
    documentId: string,
  ): Promise<readonly CanvasSceneMutationRequest[]> =>
    [...(this.requests.get(documentId)?.values() ?? [])];

  put = async (request: CanvasSceneMutationRequest): Promise<void> => {
    const documentRequests = this.requests.get(request.documentId)
      ?? new Map<string, CanvasSceneMutationRequest>();
    const existing = documentRequests.get(request.mutationId);
    if (existing && existing !== request) {
      throw new Error(
        `Canvas mutation ${request.mutationId} already exists in the outbox`,
      );
    }
    documentRequests.set(request.mutationId, request);
    this.requests.set(request.documentId, documentRequests);
  };

  remove = async (documentId: string, mutationId: string): Promise<void> => {
    const documentRequests = this.requests.get(documentId);
    if (!documentRequests) return;
    documentRequests.delete(mutationId);
    if (documentRequests.size === 0) this.requests.delete(documentId);
  };

  clear = async (documentId: string): Promise<void> => {
    this.requests.delete(documentId);
  };
}
