import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  DatabaseJsonValue,
  DatabasePropertyValueType,
} from "../../../shared/database-kernel";
import type {
  DatabaseReadSnapshot,
  GeneralDatabaseManagement,
} from "../../../shared/database-query";
import { createUuidV7 } from "../../../shared/card-id";
import {
  commitDatabaseManagementIntent,
  readDatabaseManagementAuthority,
  type DatabaseManagementAuthority,
} from "@/lib/database-management-runtime";
import type { DatabaseManagementIntent } from "@/lib/database-management-intents";
import { subscribeDatabaseChanges } from "@/lib/api";
import { emptyDatabaseViewConfig } from "@/lib/database-view-authoring";
import { useMutationAuditSessionId } from "@/lib/mutation-audit-session";
import {
  DatabaseManagementDialog,
  type CreateDatabaseDraft,
  type CreateDatabasePropertyDraft,
  type CreateDatabaseViewDraft,
  type PutDatabasePropertyOptionDraft,
  type SetDatabaseMembershipDraft,
  type UpdateDatabaseViewDraft,
} from "./database-management-dialog";

interface DatabaseManagementDialogControllerProps {
  readonly projectId: string;
  readonly initialDatabaseBlockId?: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const propertyConfig = (
  valueType: DatabasePropertyValueType,
): Readonly<Record<string, DatabaseJsonValue>> =>
  valueType === "select" || valueType === "multi_select"
    ? { options: [] }
    : {};

const propertyKey = (propertyId: string): string =>
  `custom_${propertyId.replaceAll("-", "_")}`;

const messageForError = (error: unknown): string =>
  error instanceof Error ? error.message : "Database management failed";

export function DatabaseManagementDialogController({
  projectId,
  initialDatabaseBlockId = null,
  open,
  onOpenChange,
}: DatabaseManagementDialogControllerProps) {
  const clientSessionId = useMutationAuditSessionId();
  const [snapshot, setSnapshot] =
    useState<DatabaseReadSnapshot<GeneralDatabaseManagement> | null>(null);
  const [selectedDatabaseBlockId, setSelectedDatabaseBlockId] =
    useState<string | null>(initialDatabaseBlockId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readSequence = useRef(0);
  const mutationSequence = useRef(0);
  const snapshotRef = useRef(snapshot);
  const selectedDatabaseBlockIdRef = useRef(selectedDatabaseBlockId);
  snapshotRef.current = snapshot;
  selectedDatabaseBlockIdRef.current = selectedDatabaseBlockId;

  const applySnapshot = useCallback((
    next: DatabaseReadSnapshot<GeneralDatabaseManagement>,
    preferredDatabaseBlockId?: string | null,
  ) => {
    const currentSnapshot = snapshotRef.current;
    if (
      currentSnapshot &&
      currentSnapshot.projectId === next.projectId &&
      currentSnapshot.storeEpoch === next.storeEpoch &&
      currentSnapshot.changeLogSeq > next.changeLogSeq
    ) {
      return;
    }
    const candidateIds = new Set(
      next.value?.catalog.databases.map(
        (descriptor) => descriptor.database.blockId,
      ),
    );
    const preferred = preferredDatabaseBlockId?.trim() || null;
    const selected = selectedDatabaseBlockIdRef.current?.trim() || null;
    const nextSelected =
      (preferred && candidateIds.has(preferred) ? preferred : null) ??
      (selected && candidateIds.has(selected) ? selected : null) ??
      next.value?.catalog.databases[0]?.database.blockId ??
      null;
    snapshotRef.current = next;
    selectedDatabaseBlockIdRef.current = nextSelected;
    startTransition(() => {
      setSnapshot(next);
      setSelectedDatabaseBlockId(nextSelected);
    });
  }, []);

  const refresh = useCallback(async () => {
    const sequence = ++readSequence.current;
    try {
      const next = await readDatabaseManagementAuthority(projectId);
      if (sequence !== readSequence.current) return;
      applySnapshot(next, initialDatabaseBlockId);
      setError(null);
    } catch (nextError) {
      if (sequence !== readSequence.current) return;
      setError(messageForError(nextError));
    }
  }, [applySnapshot, initialDatabaseBlockId, projectId]);

  useEffect(() => {
    if (!open) return;
    setSelectedDatabaseBlockId(initialDatabaseBlockId);
    void refresh();
    return subscribeDatabaseChanges(projectId, () => {
      void refresh();
    });
  }, [initialDatabaseBlockId, open, projectId, refresh]);

  const mutate = async (
    buildIntent: (authority: DatabaseManagementAuthority) => DatabaseManagementIntent,
    preferredDatabaseBlockId?: string | null,
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    const sequence = ++mutationSequence.current;
    let refreshAfterFailure = false;
    try {
      const next = await commitDatabaseManagementIntent({
        projectId,
        operationId: crypto.randomUUID(),
        clientSessionId,
        buildIntent,
      });
      if (sequence !== mutationSequence.current) return;
      applySnapshot(next, preferredDatabaseBlockId);
    } catch (nextError) {
      if (sequence !== mutationSequence.current) return;
      setError(messageForError(nextError));
      refreshAfterFailure = true;
    } finally {
      if (sequence === mutationSequence.current) setBusy(false);
    }
    if (refreshAfterFailure) void refresh();
  };

  const createDatabase = async (draft: CreateDatabaseDraft) => {
    const databaseBlockId = createUuidV7();
    const viewId = crypto.randomUUID();
    await mutate(
      () => ({
        kind: "create_database",
        databaseBlockId,
        name: draft.name,
        initialView: {
          id: viewId,
          name: "All",
          kind: "list",
          config: emptyDatabaseViewConfig(),
        },
      }),
      databaseBlockId,
    );
  };

  const createProperty = async (draft: CreateDatabasePropertyDraft) => {
    const propertyId = crypto.randomUUID();
    await mutate((authority) => ({
      kind: "put_property",
      mode: "create",
      descriptor: authority.descriptor(draft.databaseBlockId),
      property: {
        id: propertyId,
        key: propertyKey(propertyId),
        name: draft.name,
        valueType: draft.valueType,
        config: propertyConfig(draft.valueType),
      },
    }));
  };

  const deleteProperty = async (
    databaseBlockId: string,
    propertyId: string,
  ) => {
    await mutate((authority) => ({
      kind: "delete_property",
      descriptor: authority.descriptor(databaseBlockId),
      propertyId,
    }));
  };

  const createView = async (draft: CreateDatabaseViewDraft) => {
    const viewId = crypto.randomUUID();
    await mutate((authority) => ({
      kind: "put_view",
      mode: "create",
      descriptor: authority.descriptor(draft.databaseBlockId),
      view: {
        id: viewId,
        name: draft.name,
        kind: draft.kind,
        config: emptyDatabaseViewConfig(),
        isPrimary: false,
      },
    }));
  };

  const deleteView = async (databaseBlockId: string, viewId: string) => {
    await mutate((authority) => ({
      kind: "delete_view",
      descriptor: authority.descriptor(databaseBlockId),
      viewId,
    }));
  };

  const updateView = async (draft: UpdateDatabaseViewDraft) => {
    await mutate((authority) => {
      const descriptor = authority.descriptor(draft.databaseBlockId);
      const view = descriptor.value?.views.find(
        (candidate) => candidate.id === draft.viewId,
      );
      if (!view) throw new Error(`Database View is unavailable: ${draft.viewId}`);
      return {
        kind: "put_view",
        mode: "update",
        descriptor,
        expectedRevision: draft.expectedRevision,
        ...(draft.beforeViewId === undefined
          ? {}
          : { beforeViewId: draft.beforeViewId }),
        view: {
          id: view.id,
          name: draft.name,
          kind: draft.kind,
          config: draft.config,
          isPrimary: view.isPrimary,
        },
      };
    });
  };

  const setMembership = async (draft: SetDatabaseMembershipDraft) => {
    await mutate((authority) => {
      const targetDescriptor = draft.databaseBlockId
        ? authority.descriptor(draft.databaseBlockId).value
        : null;
      const targetView = targetDescriptor?.views.find(
        (view) => view.lifecycle === "active" && view.id === draft.viewId,
      ) ?? targetDescriptor?.views.find(
        (view) => view.lifecycle === "active" && view.isPrimary,
      ) ?? targetDescriptor?.views.find((view) => view.lifecycle === "active");
      if (draft.databaseBlockId && !targetView) {
        throw new Error(
          `Target Database has no active durable View: ${draft.databaseBlockId}`,
        );
      }
      return {
        kind: "set_membership",
        authority: authority.management,
        cardBlockId: draft.cardBlockId,
        target: draft.databaseBlockId && targetView
          ? {
              databaseBlockId: draft.databaseBlockId,
              viewId: targetView.id,
              ...(draft.beforeCardBlockId
                ? { beforeCardBlockId: draft.beforeCardBlockId }
                : {}),
            }
          : null,
      };
    });
  };

  const putPropertyOption = async (
    draft: PutDatabasePropertyOptionDraft,
  ) => {
    await mutate((authority) => ({
      kind: "put_property_option",
      mode: "create",
      descriptor: authority.descriptor(draft.databaseBlockId),
      propertyId: draft.propertyId,
      option: draft.option,
    }));
  };

  const deletePropertyOption = async (
    databaseBlockId: string,
    propertyId: string,
    optionId: string,
  ) => {
    await mutate((authority) => ({
      kind: "delete_property_option",
      descriptor: authority.descriptor(databaseBlockId),
      propertyId,
      optionId,
    }));
  };

  return (
    <DatabaseManagementDialog
      open={open}
      catalog={snapshot?.value?.catalog ?? { databases: [] }}
      cards={snapshot?.value?.cards ?? []}
      selectedDatabaseBlockId={selectedDatabaseBlockId}
      busy={busy || snapshot === null}
      error={error}
      onOpenChange={onOpenChange}
      onSelectDatabase={setSelectedDatabaseBlockId}
      onCreateDatabase={createDatabase}
      onCreateProperty={createProperty}
      onDeleteProperty={deleteProperty}
      onCreateView={createView}
      onUpdateView={updateView}
      onDeleteView={deleteView}
      onSetMembership={setMembership}
      onPutPropertyOption={putPropertyOption}
      onDeletePropertyOption={deletePropertyOption}
    />
  );
}
