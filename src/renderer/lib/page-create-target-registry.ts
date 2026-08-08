import type { ContentAccessContext } from "../../shared/content-access-context";
import type { DataSourcePropertyRecordV2 } from "../../shared/database-module-v2";
import type { ProjectAppearance } from "../../shared/project-appearance";
import {
  appScope,
  scopedAtom,
  type ScopeHandle,
  useScopedAtomValue,
} from "./maitai";
import type { BoardSummaryColumn, WorkflowStatus } from "./types";

export interface PageCreateTarget {
  readonly surfaceId: string;
  readonly panelTabId: string;
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly appearance: ProjectAppearance;
  };
  readonly databaseViewId: string;
  readonly clientSessionId: string;
  readonly accessContext: ContentAccessContext;
  readonly properties: readonly DataSourcePropertyRecordV2[];
  readonly columns: readonly Pick<BoardSummaryColumn, "id" | "name">[];
  readonly readOnlyReason: string | null;
}

export interface PageCreateTargetRegistration {
  readonly token: string;
  readonly target: PageCreateTarget;
  readonly activeColumnId: WorkflowStatus | null;
  readonly activitySequence: number;
}

export interface PageCreateTargetRegistryState {
  readonly registrations: Readonly<Record<string, PageCreateTargetRegistration>>;
  readonly activeSurfaceId: string | null;
  readonly nextActivitySequence: number;
}

export type PageCreateTargetResolution =
  | {
      readonly status: "resolved";
      readonly target: PageCreateTarget;
      readonly columnId: WorkflowStatus;
    }
  | {
      readonly status: "unavailable";
      readonly reason: string;
    };

const INITIAL_PAGE_CREATE_TARGET_REGISTRY_STATE: PageCreateTargetRegistryState = {
  registrations: {},
  activeSurfaceId: null,
  nextActivitySequence: 1,
};

const pageCreateTargetRegistryAtom = scopedAtom<PageCreateTargetRegistryState>(
  appScope,
  INITIAL_PAGE_CREATE_TARGET_REGISTRY_STATE,
  { debugLabel: "page-create-target-registry" },
);

function resolveColumnId(
  registration: PageCreateTargetRegistration,
): WorkflowStatus | null {
  const { activeColumnId, target } = registration;
  if (activeColumnId && target.columns.some((column) => column.id === activeColumnId)) {
    return activeColumnId;
  }
  return target.columns[0]?.id ?? null;
}

export function resolvePageCreateTarget(
  state: PageCreateTargetRegistryState,
): PageCreateTargetResolution {
  const registrations = Object.values(state.registrations);
  const active = state.activeSurfaceId
    ? state.registrations[state.activeSurfaceId] ?? null
    : null;
  const writable = registrations.filter((registration) => (
    !registration.target.readOnlyReason && resolveColumnId(registration)
  ));

  if (active && !active.target.readOnlyReason) {
    const columnId = resolveColumnId(active);
    if (columnId) {
      return { status: "resolved", target: active.target, columnId };
    }
  }

  const recentlyActive = writable
    .filter((registration) => registration.activitySequence > 0)
    .toSorted((left, right) => right.activitySequence - left.activitySequence)[0];
  if (recentlyActive) {
    const columnId = resolveColumnId(recentlyActive);
    if (columnId) {
      return { status: "resolved", target: recentlyActive.target, columnId };
    }
  }

  if (writable.length === 1) {
    const registration = writable[0];
    const columnId = registration ? resolveColumnId(registration) : null;
    if (registration && columnId) {
      return { status: "resolved", target: registration.target, columnId };
    }
  }

  if (writable.length > 1) {
    return {
      status: "unavailable",
      reason: "Focus a Board before creating a Page.",
    };
  }

  const closest = active
    ?? registrations.toSorted((left, right) => (
      right.activitySequence - left.activitySequence
    ))[0]
    ?? null;
  return {
    status: "unavailable",
    reason: closest?.target.readOnlyReason
      ?? "Open a writable Project Board before creating a Page.",
  };
}

export function registerPageCreateTarget(
  appHandle: ScopeHandle,
  token: string,
  target: PageCreateTarget,
): void {
  appHandle.set(pageCreateTargetRegistryAtom, (previous) => {
    const existing = previous.registrations[target.surfaceId];
    return {
      ...previous,
      registrations: {
        ...previous.registrations,
        [target.surfaceId]: {
          token,
          target,
          activeColumnId: existing?.activeColumnId ?? null,
          activitySequence: existing?.activitySequence ?? 0,
        },
      },
    };
  });
}

export function unregisterPageCreateTarget(
  appHandle: ScopeHandle,
  surfaceId: string,
  token: string,
): void {
  appHandle.set(pageCreateTargetRegistryAtom, (previous) => {
    const existing = previous.registrations[surfaceId];
    if (!existing || existing.token !== token) return previous;

    const registrations = { ...previous.registrations };
    delete registrations[surfaceId];
    return {
      ...previous,
      registrations,
      activeSurfaceId: previous.activeSurfaceId === surfaceId
        ? null
        : previous.activeSurfaceId,
    };
  });
}

export function markPageCreateTargetActive(
  appHandle: ScopeHandle,
  surfaceId: string,
  columnId?: WorkflowStatus,
): void {
  appHandle.set(pageCreateTargetRegistryAtom, (previous) => {
    const existing = previous.registrations[surfaceId];
    if (!existing) return previous;

    return {
      registrations: {
        ...previous.registrations,
        [surfaceId]: {
          ...existing,
          activeColumnId: columnId ?? existing.activeColumnId,
          activitySequence: previous.nextActivitySequence,
        },
      },
      activeSurfaceId: surfaceId,
      nextActivitySequence: previous.nextActivitySequence + 1,
    };
  });
}

export function getPageCreateTarget(
  appHandle: ScopeHandle,
  surfaceId: string,
): PageCreateTarget | null {
  return appHandle.get(pageCreateTargetRegistryAtom).registrations[surfaceId]?.target ?? null;
}

export function resolveRegisteredPageCreateTarget(
  appHandle: ScopeHandle,
): PageCreateTargetResolution {
  return resolvePageCreateTarget(appHandle.get(pageCreateTargetRegistryAtom));
}

export function usePageCreateTargetResolution(): PageCreateTargetResolution {
  return resolvePageCreateTarget(useScopedAtomValue(pageCreateTargetRegistryAtom));
}
