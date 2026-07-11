import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import type {
  DatabaseJsonValue,
  DatabasePropertyValueType,
  GeneralDatabaseViewConfig,
} from "../../../shared/database-kernel";
import type { DatabaseReadSnapshot, GeneralDatabaseCatalog } from "../../../shared/database-query";
import { createUuidV7 } from "../../../shared/card-id";
import {
  commitDatabaseManagementIntent,
  readDatabaseManagementCatalog,
  type DatabaseManagementAuthority,
} from "@/lib/database-management-runtime";
import type { DatabaseManagementIntent } from "@/lib/database-management-intents";
import { subscribeDatabaseChanges } from "@/lib/api";
import { useMutationAuditSessionId } from "@/lib/mutation-audit-session";
import {
  DatabaseManagementDialog,
  type CreateDatabaseDraft,
  type CreateDatabasePropertyDraft,
  type CreateDatabaseViewDraft,
  type PutDatabasePropertyOptionDraft,
} from "./database-management-dialog";

interface DatabaseManagementDialogControllerProps {
  readonly projectId: string;
  readonly initialDatabaseBlockId?: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const emptyViewConfig = (): GeneralDatabaseViewConfig => ({
  schemaKey: "nodex.database-view",
  schemaVersion: 1,
  filter: { kind: "group", operator: "and", children: [] },
  sort: [
    {
      field: { kind: "manual" },
      direction: "asc",
      nulls: "last",
    },
  ],
  group: null,
  display: { propertyIds: [], showTitle: true },
});

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
    useState<DatabaseReadSnapshot<GeneralDatabaseCatalog> | null>(null);
  const [selectedDatabaseBlockId, setSelectedDatabaseBlockId] =
    useState<string | null>(initialDatabaseBlockId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readSequence = useRef(0);
  const mutationSequence = useRef(0);

  const applySnapshot = useEffectEvent((
    next: DatabaseReadSnapshot<GeneralDatabaseCatalog>,
    preferredDatabaseBlockId?: string | null,
  ) => {
    if (
      snapshot &&
      snapshot.storeEpoch === next.storeEpoch &&
      snapshot.changeLogSeq > next.changeLogSeq
    ) {
      return;
    }
    const candidateIds = new Set(
      next.value?.databases.map((descriptor) => descriptor.database.blockId),
    );
    const preferred = preferredDatabaseBlockId?.trim() || null;
    const selected = selectedDatabaseBlockId?.trim() || null;
    const nextSelected =
      (preferred && candidateIds.has(preferred) ? preferred : null) ??
      (selected && candidateIds.has(selected) ? selected : null) ??
      next.value?.databases[0]?.database.blockId ??
      null;
    startTransition(() => {
      setSnapshot(next);
      setSelectedDatabaseBlockId(nextSelected);
    });
  });

  const refresh = useEffectEvent(async () => {
    const sequence = ++readSequence.current;
    try {
      const next = await readDatabaseManagementCatalog(projectId);
      if (sequence !== readSequence.current) return;
      applySnapshot(next, initialDatabaseBlockId);
      setError(null);
    } catch (nextError) {
      if (sequence !== readSequence.current) return;
      setError(messageForError(nextError));
    }
  });

  useEffect(() => {
    if (!open) return;
    setSelectedDatabaseBlockId(initialDatabaseBlockId);
    void refresh();
    return subscribeDatabaseChanges(projectId, () => {
      void refresh();
    });
  }, [initialDatabaseBlockId, open, projectId]);

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
        operationId: createUuidV7(),
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
    const viewId = createUuidV7();
    await mutate(
      () => ({
        kind: "create_database",
        databaseBlockId,
        name: draft.name,
        initialView: {
          id: viewId,
          name: "All",
          kind: "list",
          config: emptyViewConfig(),
        },
      }),
      databaseBlockId,
    );
  };

  const createProperty = async (draft: CreateDatabasePropertyDraft) => {
    const propertyId = createUuidV7();
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
    const viewId = createUuidV7();
    await mutate((authority) => ({
      kind: "put_view",
      mode: "create",
      descriptor: authority.descriptor(draft.databaseBlockId),
      view: {
        id: viewId,
        name: draft.name,
        kind: draft.kind,
        config: emptyViewConfig(),
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
      catalog={snapshot?.value ?? { databases: [] }}
      selectedDatabaseBlockId={selectedDatabaseBlockId}
      busy={busy || snapshot === null}
      error={error}
      onOpenChange={onOpenChange}
      onSelectDatabase={setSelectedDatabaseBlockId}
      onCreateDatabase={createDatabase}
      onCreateProperty={createProperty}
      onDeleteProperty={deleteProperty}
      onCreateView={createView}
      onDeleteView={deleteView}
      onPutPropertyOption={putPropertyOption}
      onDeletePropertyOption={deletePropertyOption}
    />
  );
}
