export type WorkbenchReviewContext =
  | {
      readonly kind: "project";
      readonly projectId: string;
    }
  | {
      readonly kind: "session";
      readonly sessionId: string;
    };

/**
 * Review is owned by either a project scene or a session scene. `projectId`
 * remains nullable because a session-scoped Review can be fully projectless;
 * it is only workspace metadata/fallback, never the capability gate.
 *
 * The optional context on project-bound values is a decode-compatibility
 * allowance for pre-context persisted tabs. Schemas normalize those values
 * to an explicit project context at the persistence boundary.
 */
export type WorkbenchReviewConfig =
  | {
      readonly projectId: string;
      readonly context?: WorkbenchReviewContext;
    }
  | {
      readonly projectId: null;
      readonly context: Extract<WorkbenchReviewContext, { kind: "session" }>;
    };

export function resolveWorkbenchReviewContext(
  config: WorkbenchReviewConfig,
): WorkbenchReviewContext | null {
  if (config.context) return config.context;
  if (config.projectId) {
    return { kind: "project", projectId: config.projectId };
  }
  return null;
}
