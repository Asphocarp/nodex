/**
 * Review presentation is owned by its containing Session Scene. Project
 * identity is optional workspace metadata and never substitutes for Session
 * or Route ownership.
 */
export interface WorkbenchReviewConfig {
  readonly projectId: string | null;
}
