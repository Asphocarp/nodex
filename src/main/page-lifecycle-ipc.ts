import type {
  PageLifecycleMutationCommandResult,
  PageLifecycleMutationRequest,
} from "../shared/page-lifecycle";
import {
  bindTrustedPageLifecycleMutation,
  pageLifecycleMutationFailure,
  pageLifecycleTransportFailure,
  type TrustedPageLifecycleMutationIdentity,
} from "../shared/page-lifecycle-transport";
import type { PageLifecyclePreflightResult } from "../shared/page-lifecycle-runtime";

export const PAGE_LIFECYCLE_MUTATION_IPC_CHANNEL =
  "pages:lifecycle:apply" as const;
export const PAGE_LIFECYCLE_PREFLIGHT_IPC_CHANNEL =
  "pages:lifecycle:preflight" as const;

export interface PageLifecycleIpcDependencies {
  readonly registerHandle: (
    channel: typeof PAGE_LIFECYCLE_MUTATION_IPC_CHANNEL,
    listener: (
      event: unknown,
      projectId: string,
      rawRequest: unknown,
    ) => Promise<PageLifecycleMutationCommandResult>,
  ) => void;
  readonly getTrustedIdentity: (
    event: unknown,
  ) => TrustedPageLifecycleMutationIdentity | null;
  readonly applyMutation: (
    request: PageLifecycleMutationRequest,
  ) => Promise<PageLifecycleMutationCommandResult>;
}

export const registerPageLifecycleIpcHandler = (
  dependencies: PageLifecycleIpcDependencies,
): void => {
  dependencies.registerHandle(
    PAGE_LIFECYCLE_MUTATION_IPC_CHANNEL,
    async (event, projectId, rawRequest) => {
      const identity = dependencies.getTrustedIdentity(event);
      if (!identity) {
        return {
          ok: false,
          error: pageLifecycleMutationFailure(
            "invalid_page_lifecycle_request",
            "Page lifecycle mutations are restricted to a trusted application window",
            rawRequest,
          ),
        };
      }
      const bound = bindTrustedPageLifecycleMutation(
        rawRequest,
        projectId,
        identity,
      );
      if (!bound.ok) return bound;
      try {
        return await dependencies.applyMutation(bound.value);
      } catch (error) {
        return pageLifecycleTransportFailure(bound.value, error);
      }
    },
  );
};

export interface PageLifecyclePreflightIpcDependencies {
  readonly registerHandle: (
    channel: typeof PAGE_LIFECYCLE_PREFLIGHT_IPC_CHANNEL,
    listener: (
      event: unknown,
      projectId: string,
      pageId: string,
    ) => Promise<PageLifecyclePreflightResult>,
  ) => void;
  readonly readPreflight: (
    projectId: string,
    pageId: string,
  ) => Promise<PageLifecyclePreflightResult>;
}

export const registerPageLifecyclePreflightIpcHandler = (
  dependencies: PageLifecyclePreflightIpcDependencies,
): void => {
  dependencies.registerHandle(
    PAGE_LIFECYCLE_PREFLIGHT_IPC_CHANNEL,
    async (_event, projectId, pageId) =>
      await dependencies.readPreflight(projectId, pageId),
  );
};
