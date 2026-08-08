import { toast } from "@/components/ui/toast";
import { PageCreateDialog } from "@/components/kanban/page-create-dialog";
import type { ScopeHandle } from "./maitai";
import { isModalOpen, openModal } from "./modal-registry";
import type { PageCreateDraftSnapshot } from "./page-create-draft";
import type { PageCreateOrigin, PageCreateOriginKind } from "./page-create-focus";
import {
  getPageCreateTarget,
  resolveRegisteredPageCreateTarget,
  type PageCreateTarget,
} from "./page-create-target-registry";

export interface PageCreateRequest {
  readonly target: PageCreateTarget;
  readonly origin: PageCreateOrigin;
  readonly snapshot?: PageCreateDraftSnapshot;
}

function focusOpenPageCreateDialog(): void {
  if (typeof document === "undefined") return;
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(
      "[data-page-create-dialog] input, [data-page-create-dialog] [contenteditable='true']",
    )?.focus();
  });
}

export function requestPageCreate(
  appHandle: ScopeHandle,
  request: PageCreateRequest,
): boolean {
  if (isModalOpen(appHandle, PageCreateDialog)) {
    focusOpenPageCreateDialog();
    toast.info("Finish or close the current Page draft first.", {
      id: "page-create-already-open",
    });
    return false;
  }

  openModal(appHandle, PageCreateDialog, {
    requestId: crypto.randomUUID(),
    target: request.target,
    origin: request.origin,
    restoredSnapshot: request.snapshot,
  });
  return true;
}

export function requestPageCreateFromContext(
  appHandle: ScopeHandle,
  originKind: PageCreateOriginKind = "keyboard",
): boolean {
  const resolution = resolveRegisteredPageCreateTarget(appHandle);
  if (resolution.status === "unavailable") {
    toast.info(resolution.reason, { id: "page-create-target-unavailable" });
    return false;
  }

  const { target, columnId } = resolution;
  return requestPageCreate(appHandle, {
    target,
    origin: {
      surfaceId: target.surfaceId,
      panelTabId: target.panelTabId,
      projectId: target.project.id,
      databaseViewId: target.databaseViewId,
      kind: originKind,
      columnId,
    },
  });
}

export function restorePageCreateDraft(
  appHandle: ScopeHandle,
  request: PageCreateRequest,
): boolean {
  const mountedTarget = getPageCreateTarget(appHandle, request.target.surfaceId);
  if (!mountedTarget) {
    toast.info("Return to the original Board to restore this Page draft.", {
      id: "page-create-restore-unavailable",
    });
    return false;
  }

  return requestPageCreate(appHandle, {
    ...request,
    target: mountedTarget,
  });
}
