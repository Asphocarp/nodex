import type {
  PageLifecycleMutationCommandResultV2,
  PageLifecycleMutationRequestV2,
} from "../shared/page-lifecycle-v2";
import {
  bindTrustedPageLifecycleMutationV2,
  pageLifecycleMutationFailureV2,
  pageLifecycleTransportFailureV2,
  type TrustedPageLifecycleMutationIdentityV2,
} from "../shared/page-lifecycle-v2-transport";
import type { PageLifecyclePreflightResultV2 } from "../shared/page-lifecycle-v2-runtime";

export const PAGE_LIFECYCLE_MUTATION_IPC_CHANNEL = "pages:lifecycle:apply" as const;
export const PAGE_LIFECYCLE_PREFLIGHT_IPC_CHANNEL = "pages:lifecycle:preflight" as const;

export interface PageLifecycleIpcDependencies {
  readonly registerHandle: (
    channel: typeof PAGE_LIFECYCLE_MUTATION_IPC_CHANNEL,
    listener: (
      event: unknown,
      projectId: string,
      rawRequest: unknown,
    ) => Promise<PageLifecycleMutationCommandResultV2>,
  ) => void;
  readonly getTrustedIdentity: (event: unknown) => TrustedPageLifecycleMutationIdentityV2 | null;
  readonly applyMutation: (
    request: PageLifecycleMutationRequestV2,
  ) => Promise<PageLifecycleMutationCommandResultV2>;
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
          error: pageLifecycleMutationFailureV2(
            "invalid_page_lifecycle_request",
            "Page lifecycle mutations are restricted to a trusted application window",
            rawRequest,
          ),
        };
      }
      const bound = bindTrustedPageLifecycleMutationV2(rawRequest, projectId, identity);
      if (!bound.ok) return bound;
      try {
        return await dependencies.applyMutation(bound.value);
      } catch (error) {
        return pageLifecycleTransportFailureV2(bound.value, error);
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
    ) => Promise<PageLifecyclePreflightResultV2>,
  ) => void;
  readonly readPreflight: (
    projectId: string,
    pageId: string,
  ) => Promise<PageLifecyclePreflightResultV2>;
}

export const registerPageLifecyclePreflightIpcHandler = (
  dependencies: PageLifecyclePreflightIpcDependencies,
): void => {
  dependencies.registerHandle(
    PAGE_LIFECYCLE_PREFLIGHT_IPC_CHANNEL,
    async (_event, projectId, pageId) => await dependencies.readPreflight(projectId, pageId),
  );
};
