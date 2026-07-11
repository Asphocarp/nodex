import { useEffect, useState, type FormEvent } from "react";
import {
  Boxes,
  CalendarDays,
  CheckSquare2,
  Code2,
  Columns3,
  Database,
  Hash,
  List,
  Plus,
  Tags,
  TextCursorInput,
  Trash2,
  UserRound,
} from "lucide-react";
import type {
  DatabasePropertyOption,
  DatabasePropertyValueType,
  GeneralDatabaseViewKind,
} from "../../../shared/database-kernel";
import type {
  GeneralDatabaseCatalog,
  GeneralDatabaseDescriptor,
  GeneralDatabaseMembershipState,
  GeneralDatabasePropertyDefinition,
} from "../../../shared/database-query";
import { NodexButton, NodexIconButton } from "@/components/ui/button";
import {
  NodexDialog,
  NodexDialogContent,
  NodexDialogDescription,
  NodexDialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface CreateDatabaseDraft {
  readonly name: string;
}

export interface CreateDatabasePropertyDraft {
  readonly databaseBlockId: string;
  readonly name: string;
  readonly valueType: DatabasePropertyValueType;
}

export interface CreateDatabaseViewDraft {
  readonly databaseBlockId: string;
  readonly name: string;
  readonly kind: GeneralDatabaseViewKind;
}

export interface UpdateDatabaseViewDraft extends CreateDatabaseViewDraft {
  readonly viewId: string;
}

export interface SetDatabaseMembershipDraft {
  readonly cardBlockId: string;
  readonly databaseBlockId: string | null;
}

export interface PutDatabasePropertyOptionDraft {
  readonly databaseBlockId: string;
  readonly propertyId: string;
  readonly option: DatabasePropertyOption;
}

export interface DatabaseManagementSurfaceProps {
  readonly catalog: GeneralDatabaseCatalog;
  readonly cards: readonly GeneralDatabaseMembershipState[];
  readonly selectedDatabaseBlockId: string | null;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onSelectDatabase: (databaseBlockId: string) => void;
  readonly onCreateDatabase: (draft: CreateDatabaseDraft) => void | Promise<void>;
  readonly onCreateProperty: (
    draft: CreateDatabasePropertyDraft,
  ) => void | Promise<void>;
  readonly onDeleteProperty: (
    databaseBlockId: string,
    propertyId: string,
  ) => void | Promise<void>;
  readonly onCreateView: (draft: CreateDatabaseViewDraft) => void | Promise<void>;
  readonly onUpdateView: (draft: UpdateDatabaseViewDraft) => void | Promise<void>;
  readonly onDeleteView: (
    databaseBlockId: string,
    viewId: string,
  ) => void | Promise<void>;
  readonly onSetMembership: (
    draft: SetDatabaseMembershipDraft,
  ) => void | Promise<void>;
  readonly onPutPropertyOption: (
    draft: PutDatabasePropertyOptionDraft,
  ) => void | Promise<void>;
  readonly onDeletePropertyOption: (
    databaseBlockId: string,
    propertyId: string,
    optionId: string,
  ) => void | Promise<void>;
}

interface DatabaseManagementDialogProps
  extends DatabaseManagementSurfaceProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const PROPERTY_TYPES: readonly {
  readonly value: DatabasePropertyValueType;
  readonly label: string;
}[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "checkbox", label: "Checkbox" },
  { value: "select", label: "Select" },
  { value: "multi_select", label: "Multi-select" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & time" },
  { value: "person", label: "Person" },
];

const VIEW_KINDS: readonly {
  readonly value: GeneralDatabaseViewKind;
  readonly label: string;
}[] = [
  { value: "list", label: "List" },
  { value: "kanban", label: "Board" },
  { value: "calendar", label: "Calendar" },
  { value: "canvas", label: "Canvas" },
];

const propertyTypeIcon = (valueType: DatabasePropertyValueType) => {
  switch (valueType) {
    case "number":
      return Hash;
    case "checkbox":
      return CheckSquare2;
    case "select":
    case "multi_select":
      return Tags;
    case "date":
    case "datetime":
      return CalendarDays;
    case "person":
      return UserRound;
    case "text":
      return TextCursorInput;
  }
};

const viewKindIcon = (kind: GeneralDatabaseViewKind) => {
  switch (kind) {
    case "kanban":
      return Columns3;
    case "calendar":
      return CalendarDays;
    case "canvas":
      return Boxes;
    case "list":
      return List;
  }
};

const readOptions = (
  property: GeneralDatabasePropertyDefinition,
): readonly DatabasePropertyOption[] => {
  if (property.valueType !== "select" && property.valueType !== "multi_select") {
    return [];
  }
  const options = property.config.options;
  if (!Array.isArray(options)) return [];
  return options.flatMap((option) => {
    if (typeof option !== "object" || option === null || Array.isArray(option)) {
      return [];
    }
    const id = option.id;
    const name = option.name;
    const color = option.color;
    if (typeof id !== "string" || typeof name !== "string") return [];
    if (color !== undefined && typeof color !== "string") return [];
    return [{ id, name, ...(color === undefined ? {} : { color }) }];
  });
};

const selectedDescriptor = (
  catalog: GeneralDatabaseCatalog,
  selectedDatabaseBlockId: string | null,
): GeneralDatabaseDescriptor | null =>
  catalog.databases.find(
    (descriptor) => descriptor.database.blockId === selectedDatabaseBlockId,
  ) ?? catalog.databases[0] ?? null;

const submitTrimmed = (
  event: FormEvent<HTMLFormElement>,
  value: string,
  submit: (value: string) => void,
): void => {
  event.preventDefault();
  const normalized = value.trim();
  if (!normalized) return;
  submit(normalized);
};

function SectionHeader({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <div className="mb-2 flex items-end gap-3">
      <h3 className="text-sm font-medium text-token-text-primary">{title}</h3>
      <p className="truncate pb-px text-xs text-token-description-foreground">
        {detail}
      </p>
    </div>
  );
}

export function DatabaseManagementSurface({
  catalog,
  cards,
  selectedDatabaseBlockId,
  busy = false,
  error = null,
  onSelectDatabase,
  onCreateDatabase,
  onCreateProperty,
  onDeleteProperty,
  onCreateView,
  onUpdateView,
  onDeleteView,
  onSetMembership,
  onPutPropertyOption,
  onDeletePropertyOption,
}: DatabaseManagementSurfaceProps) {
  const descriptor = selectedDescriptor(catalog, selectedDatabaseBlockId);
  const [databaseName, setDatabaseName] = useState("");
  const [propertyName, setPropertyName] = useState("");
  const [propertyType, setPropertyType] =
    useState<DatabasePropertyValueType>("text");
  const [viewName, setViewName] = useState("");
  const [viewKind, setViewKind] = useState<GeneralDatabaseViewKind>("list");
  const [viewDrafts, setViewDrafts] = useState<Readonly<Record<
    string,
    { readonly name: string; readonly kind: GeneralDatabaseViewKind }
  >>>({});
  const [optionDrafts, setOptionDrafts] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    if (!descriptor || descriptor.database.blockId === selectedDatabaseBlockId) {
      return;
    }
    onSelectDatabase(descriptor.database.blockId);
  }, [descriptor, onSelectDatabase, selectedDatabaseBlockId]);

  const activeProperties = descriptor?.properties.filter(
    (property) => property.lifecycle === "active",
  ) ?? [];
  const activeViews = descriptor?.views.filter((view) => view.lifecycle === "active") ?? [];
  const selectedDatabaseId = descriptor?.database.blockId ?? null;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] max-sm:grid-cols-1">
          <aside className="flex min-h-0 flex-col border-r border-token-border bg-token-foreground/3 max-sm:hidden">
            <div className="px-4 pb-3 pt-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-token-text-primary">
                <Database className="size-4 text-token-description-foreground" />
                Databases
              </h2>
              <p className="mt-1 text-xs text-token-description-foreground">
                Shared schema and durable Views
              </p>
            </div>
            <nav aria-label="Project Databases" className="min-h-0 flex-1 overflow-y-auto px-2">
              {catalog.databases.map((candidate) => {
                const selected = candidate.database.blockId === descriptor?.database.blockId;
                return (
                  <button
                    key={candidate.database.blockId}
                    type="button"
                    aria-current={selected ? "page" : undefined}
                    onClick={() => onSelectDatabase(candidate.database.blockId)}
                    className={cn(
                      "mb-0.5 flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm outline-none transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-token-focus",
                      selected
                        ? "bg-token-foreground/8 text-token-text-primary"
                        : "text-token-text-secondary hover:bg-token-foreground/5 hover:text-token-text-primary",
                    )}
                  >
                    <Database className="size-3.5 shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1 truncate">{candidate.database.name}</span>
                    {candidate.database.isPrimary ? (
                      <span className="text-[10px] uppercase tracking-wide text-token-description-foreground">
                        Main
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
            <form
              className="border-t border-token-border p-2"
              onSubmit={(event) =>
                submitTrimmed(event, databaseName, (name) => {
                  void onCreateDatabase({ name });
                  setDatabaseName("");
                })}
            >
              <label className="sr-only" htmlFor="database-manager-new-database">
                New Database name
              </label>
              <div className="flex gap-1">
                <Input
                  id="database-manager-new-database"
                  value={databaseName}
                  disabled={busy}
                  onInput={(event) => setDatabaseName(event.currentTarget.value)}
                  placeholder="New Database"
                  className="h-8 text-sm"
                />
                <NodexButton
                  type="submit"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy || !databaseName.trim()}
                  aria-label="Create Database"
                >
                  <Plus />
                </NodexButton>
              </div>
            </form>
          </aside>

          <main className="min-h-0 overflow-y-auto px-6 pb-8 pt-5 max-sm:px-4">
            {descriptor ? (
              <>
                <div className="mb-7 pr-10">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-token-text-primary">
                      {descriptor.database.name}
                    </h2>
                    {descriptor.database.isPrimary ? (
                      <span className="rounded-md bg-token-foreground/6 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-token-description-foreground">
                        Primary
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-token-description-foreground">
                    {activeProperties.length} properties · {activeViews.length} Views
                  </p>
                </div>

                <section className="mb-8" aria-labelledby="database-cards-heading">
                  <SectionHeader
                    title="Cards"
                    detail="One owning Database per Card"
                  />
                  <h3 id="database-cards-heading" className="sr-only">Database membership</h3>
                  <div className="max-h-52 divide-y divide-token-border/60 overflow-y-auto border-y border-token-border/60">
                    {cards.map((state) => {
                      const currentDatabaseId = state.membership?.databaseBlockId ?? null;
                      const currentDatabase = catalog.databases.find(
                        (candidate) => candidate.database.blockId === currentDatabaseId,
                      );
                      const belongsHere = currentDatabaseId === selectedDatabaseId;
                      const actionLabel = belongsHere
                        ? "Remove"
                        : currentDatabaseId
                          ? "Move here"
                          : "Add";
                      return (
                        <div key={state.card.blockId} className="flex min-h-9 items-center gap-2 py-1.5">
                          <span className="min-w-0 flex-1 truncate text-sm text-token-text-primary">
                            {state.card.content?.title || "Untitled"}
                          </span>
                          <span className="max-w-44 truncate text-xs text-token-description-foreground">
                            {currentDatabase?.database.name ?? "No Database"}
                          </span>
                          <NodexButton
                            type="button"
                            size="xs"
                            variant="ghost"
                            disabled={busy || !selectedDatabaseId}
                            aria-label={`${actionLabel} Card ${state.card.content?.title || state.card.blockId}`}
                            onClick={() => void onSetMembership({
                              cardBlockId: state.card.blockId,
                              databaseBlockId: belongsHere ? null : selectedDatabaseId,
                            })}
                          >
                            {actionLabel}
                          </NodexButton>
                        </div>
                      );
                    })}
                    {cards.length === 0 ? (
                      <p className="py-3 text-xs text-token-description-foreground">
                        No active Cards in this Project.
                      </p>
                    ) : null}
                  </div>
                </section>

                <section className="mb-8" aria-labelledby="database-properties-heading">
                  <SectionHeader
                    title="Properties"
                    detail="Shared by every Card in this Database"
                  />
                  <h3 id="database-properties-heading" className="sr-only">Database properties</h3>
                  <div className="divide-y divide-token-border/60 border-y border-token-border/60">
                    {activeProperties.map((property) => {
                      const Icon = propertyTypeIcon(property.valueType);
                      const options = readOptions(property);
                      return (
                        <div key={property.id} className="group py-2.5">
                          <div className="flex min-h-7 items-center gap-2">
                            <Icon className="size-3.5 text-token-description-foreground" />
                            <span className="min-w-0 flex-1 truncate text-sm text-token-text-primary">
                              {property.name}
                            </span>
                            <span className="text-xs text-token-description-foreground">
                              {PROPERTY_TYPES.find((type) => type.value === property.valueType)?.label}
                            </span>
                            <NodexIconButton
                              icon={Trash2}
                              size="xs"
                              tone="danger"
                              ariaLabel={`Delete property ${property.name}`}
                              disabled={busy}
                              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                              onClick={() => void onDeleteProperty(descriptor.database.blockId, property.id)}
                            />
                          </div>
                          {property.valueType === "select" || property.valueType === "multi_select" ? (
                            <div className="ml-5 mt-2 flex flex-wrap items-center gap-1.5">
                              {options.map((option) => (
                                <span
                                  key={option.id}
                                  className="group/option inline-flex h-6 items-center gap-1 rounded-md bg-token-foreground/6 pl-2 pr-1 text-xs text-token-text-secondary"
                                >
                                  {option.name}
                                  <button
                                    type="button"
                                    aria-label={`Delete option ${option.name}`}
                                    disabled={busy}
                                    onClick={() => void onDeletePropertyOption(
                                      descriptor.database.blockId,
                                      property.id,
                                      option.id,
                                    )}
                                    className="rounded p-0.5 text-token-description-foreground opacity-0 hover:text-token-error-foreground group-hover/option:opacity-100 focus-visible:opacity-100"
                                  >
                                    <Trash2 className="size-3" />
                                  </button>
                                </span>
                              ))}
                              <form
                                onSubmit={(event) =>
                                  submitTrimmed(event, optionDrafts[property.id] ?? "", (name) => {
                                    void onPutPropertyOption({
                                      databaseBlockId: descriptor.database.blockId,
                                      propertyId: property.id,
                                      option: { id: crypto.randomUUID(), name },
                                    });
                                    setOptionDrafts((current) => ({ ...current, [property.id]: "" }));
                                  })}
                              >
                                <input
                                  aria-label={`Add option to ${property.name}`}
                                  value={optionDrafts[property.id] ?? ""}
                                  disabled={busy}
                                  onInput={(event) =>
                                    setOptionDrafts((current) => ({
                                      ...current,
                                      [property.id]: event.currentTarget.value,
                                    }))}
                                  placeholder="Add option"
                                  className="h-6 w-24 bg-transparent px-1 text-xs text-token-text-secondary outline-none placeholder:text-token-description-foreground focus:w-32"
                                />
                              </form>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    <form
                      className="flex items-center gap-2 py-2.5"
                      onSubmit={(event) =>
                        submitTrimmed(event, propertyName, (name) => {
                          void onCreateProperty({
                            databaseBlockId: descriptor.database.blockId,
                            name,
                            valueType: propertyType,
                          });
                          setPropertyName("");
                        })}
                    >
                      <Plus className="size-3.5 text-token-description-foreground" />
                      <Input
                        aria-label="New property name"
                        value={propertyName}
                        disabled={busy}
                        onInput={(event) => setPropertyName(event.currentTarget.value)}
                        placeholder="New property"
                        className="h-8 min-w-0 flex-1 border-transparent bg-transparent text-sm focus:bg-token-input-background"
                      />
                      <select
                        aria-label="New property type"
                        value={propertyType}
                        disabled={busy}
                        onChange={(event) =>
                          setPropertyType(event.target.value as DatabasePropertyValueType)}
                        className="h-8 rounded-md border border-transparent bg-transparent px-2 text-xs text-token-text-secondary outline-none hover:bg-token-foreground/5 focus:border-token-focus-border"
                      >
                        {PROPERTY_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>{type.label}</option>
                        ))}
                      </select>
                      <NodexButton
                        type="submit"
                        size="xs"
                        variant="secondary"
                        disabled={busy || !propertyName.trim()}
                      >
                        Add
                      </NodexButton>
                    </form>
                  </div>
                </section>

                <section aria-labelledby="database-views-heading">
                  <SectionHeader
                    title="Views"
                    detail="Durable filters, grouping, sorting and display"
                  />
                  <h3 id="database-views-heading" className="sr-only">Database Views</h3>
                  <div className="divide-y divide-token-border/60 border-y border-token-border/60">
                    {activeViews.map((view) => {
                      const Icon = viewKindIcon(view.kind);
                      const draft = viewDrafts[view.id] ?? {
                        name: view.name,
                        kind: view.kind,
                      };
                      const changed = draft.name.trim() !== view.name || draft.kind !== view.kind;
                      return (
                        <div key={view.id} className="group flex min-h-10 items-center gap-2 py-1.5">
                          <Icon className="size-3.5 text-token-description-foreground" />
                          <Input
                            aria-label={`View name ${view.name}`}
                            value={draft.name}
                            disabled={busy}
                            onInput={(event) => setViewDrafts((current) => ({
                              ...current,
                              [view.id]: { ...draft, name: event.currentTarget.value },
                            }))}
                            className="h-8 min-w-0 flex-1 border-transparent bg-transparent text-sm focus:bg-token-input-background"
                          />
                          <select
                            aria-label={`View kind ${view.name}`}
                            value={draft.kind}
                            disabled={busy}
                            onChange={(event) => setViewDrafts((current) => ({
                              ...current,
                              [view.id]: {
                                ...draft,
                                kind: event.target.value as GeneralDatabaseViewKind,
                              },
                            }))}
                            className="h-8 rounded-md border border-transparent bg-transparent px-2 text-xs text-token-text-secondary outline-none hover:bg-token-foreground/5 focus:border-token-focus-border"
                          >
                            {VIEW_KINDS.map((kind) => (
                              <option key={kind.value} value={kind.value}>{kind.label}</option>
                            ))}
                          </select>
                          <NodexButton
                            type="button"
                            size="xs"
                            variant="ghost"
                            disabled={busy || !changed || !draft.name.trim()}
                            aria-label={`Save View ${view.name}`}
                            onClick={() => void onUpdateView({
                              databaseBlockId: descriptor.database.blockId,
                              viewId: view.id,
                              name: draft.name.trim(),
                              kind: draft.kind,
                            })}
                          >
                            Save
                          </NodexButton>
                          {view.isPrimary ? (
                            <span className="text-[10px] uppercase tracking-wide text-token-description-foreground">
                              Primary
                            </span>
                          ) : (
                            <NodexIconButton
                              icon={Trash2}
                              size="xs"
                              tone="danger"
                              ariaLabel={`Delete View ${view.name}`}
                              disabled={busy}
                              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                              onClick={() => void onDeleteView(descriptor.database.blockId, view.id)}
                            />
                          )}
                        </div>
                      );
                    })}
                    <form
                      className="flex items-center gap-2 py-2.5"
                      onSubmit={(event) =>
                        submitTrimmed(event, viewName, (name) => {
                          void onCreateView({
                            databaseBlockId: descriptor.database.blockId,
                            name,
                            kind: viewKind,
                          });
                          setViewName("");
                        })}
                    >
                      <Plus className="size-3.5 text-token-description-foreground" />
                      <Input
                        aria-label="New View name"
                        value={viewName}
                        disabled={busy}
                        onInput={(event) => setViewName(event.currentTarget.value)}
                        placeholder="New View"
                        className="h-8 min-w-0 flex-1 border-transparent bg-transparent text-sm focus:bg-token-input-background"
                      />
                      <select
                        aria-label="New View kind"
                        value={viewKind}
                        disabled={busy}
                        onChange={(event) => setViewKind(event.target.value as GeneralDatabaseViewKind)}
                        className="h-8 rounded-md border border-transparent bg-transparent px-2 text-xs text-token-text-secondary outline-none hover:bg-token-foreground/5 focus:border-token-focus-border"
                      >
                        {VIEW_KINDS.map((kind) => (
                          <option key={kind.value} value={kind.value}>{kind.label}</option>
                        ))}
                      </select>
                      <NodexButton
                        type="submit"
                        size="xs"
                        variant="secondary"
                        disabled={busy || !viewName.trim()}
                      >
                        Add
                      </NodexButton>
                    </form>
                  </div>
                </section>

                {error ? (
                  <p role="alert" className="mt-5 text-sm text-token-error-foreground">
                    {error}
                  </p>
                ) : null}
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <Code2 className="mb-3 size-5 text-token-description-foreground" />
                <p className="text-sm font-medium text-token-text-primary">No Database yet</p>
                <p className="mt-1 max-w-xs text-xs text-token-description-foreground">
                  Create one from the sidebar to define shared properties and Views.
                </p>
              </div>
            )}
          </main>
    </div>
  );
}

export function DatabaseManagementDialog({
  open,
  onOpenChange,
  ...surfaceProps
}: DatabaseManagementDialogProps) {
  return (
    <NodexDialog open={open} onOpenChange={onOpenChange}>
      <NodexDialogContent
        className="h-[min(680px,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] w-[min(900px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
        closeButtonAriaLabel="Close Database manager"
      >
        <NodexDialogTitle className="sr-only">Manage Databases</NodexDialogTitle>
        <NodexDialogDescription className="sr-only">
          Manage shared Database schemas, property options, and durable Views.
        </NodexDialogDescription>
        <DatabaseManagementSurface {...surfaceProps} />
      </NodexDialogContent>
    </NodexDialog>
  );
}
