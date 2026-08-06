export interface PageStageStoryDocument {
  readonly destroy: () => void;
}

export function createPageStageStoryDocument(input: {
  readonly projectId: string;
  readonly pageId: string;
  readonly title: string;
  readonly description: string;
}): PageStageStoryDocument {
  void input;
  return {
    destroy: () => undefined,
  };
}
