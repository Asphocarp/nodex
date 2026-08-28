import { DeleteIcon, PlusIcon } from "@/components/shared/icons";
import { NodexButton, NodexIconButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  DatabaseTaskChoiceFilter,
  DatabaseTaskFilterCapabilities,
  DatabaseTaskFilterGroup,
  DatabaseTaskFilterState,
  DatabaseTaskTagFilter,
  DatabaseTaskTagMode,
} from "@/lib/database-view-task-filter";
import { createDefaultDatabaseTaskFilterGroup } from "@/lib/database-view-task-filter";
import { useObjectIdentityKey } from "@/lib/use-object-identity-keys";
import { DatabaseViewSelect } from "./database-view-select";

interface DatabaseViewTaskFilterEditorProps {
  readonly state: DatabaseTaskFilterState;
  readonly capabilities: DatabaseTaskFilterCapabilities;
  readonly disabled?: boolean;
  readonly onChange: (state: DatabaseTaskFilterState) => void;
}

const ROW_LABEL = "w-18 shrink-0 pt-1 text-xs text-token-description-foreground select-none";
const CHIP_CLASS = cn(
  "h-6 rounded-md px-2 text-xs font-medium",
  "text-token-description-foreground hover:bg-token-foreground/5 hover:text-token-foreground",
);
const CHIP_ACTIVE_CLASS = cn(
  "bg-[color-mix(in_srgb,var(--accent-blue)_18%,transparent)] text-(--accent-blue)",
  "hover:bg-[color-mix(in_srgb,var(--accent-blue)_22%,transparent)] hover:text-(--accent-blue)",
);

const updateChoice = (
  group: DatabaseTaskFilterGroup,
  role: "status" | "priority",
  update: (value: DatabaseTaskChoiceFilter) => DatabaseTaskChoiceFilter,
): DatabaseTaskFilterGroup => {
  const current = group[role];
  if (!current) return group;
  return { ...group, [role]: update(current) };
};

const updateTags = (
  group: DatabaseTaskFilterGroup,
  update: (value: DatabaseTaskTagFilter) => DatabaseTaskTagFilter,
): DatabaseTaskFilterGroup => {
  if (!group.tags) return group;
  return { ...group, tags: update(group.tags) };
};

export function DatabaseViewTaskFilterEditor({
  state,
  capabilities,
  disabled = false,
  onChange,
}: DatabaseViewTaskFilterEditorProps) {
  const objectIdentityKey = useObjectIdentityKey();
  const updateGroup = (
    groupIndex: number,
    update: (group: DatabaseTaskFilterGroup) => DatabaseTaskFilterGroup,
  ) =>
    onChange({
      groups: state.groups.map((group, index) => (index === groupIndex ? update(group) : group)),
    });
  const removeGroup = (groupIndex: number) =>
    onChange({
      groups:
        state.groups.length <= 1
          ? [createDefaultDatabaseTaskFilterGroup(capabilities)]
          : state.groups.filter((_, index) => index !== groupIndex),
    });

  return (
    <>
      <div className="flex h-9 items-center px-3">
        <span className="text-xs font-medium uppercase tracking-label text-token-description-foreground">
          Filters
        </span>
        <NodexButton
          size="xs"
          variant="ghost"
          disabled={disabled}
          className="ml-auto"
          onClick={() =>
            onChange({
              groups: [...state.groups, createDefaultDatabaseTaskFilterGroup(capabilities)],
            })
          }
        >
          <PlusIcon /> Group
        </NodexButton>
      </div>
      <div className="max-h-[420px] space-y-3 overflow-y-auto px-3 pb-3">
        {state.groups.map((group, groupIndex) => (
          <div
            key={objectIdentityKey(group)}
            className={cn(
              "relative space-y-1.5",
              groupIndex > 0 && "border-t-[0.5px] border-token-border/70 pt-3",
            )}
          >
            {state.groups.length > 1 ? (
              <NodexIconButton
                icon={DeleteIcon}
                size="xs"
                tone="danger"
                ariaLabel={`Remove filter group ${groupIndex + 1}`}
                disabled={disabled}
                className="absolute -top-0.5 right-0"
                onClick={() => removeGroup(groupIndex)}
              />
            ) : null}

            {capabilities.status && group.status ? (
              <div className="flex items-start gap-2">
                <span className={ROW_LABEL}>{capabilities.status.name}</span>
                <div className="flex min-w-0 flex-wrap gap-1">
                  {capabilities.status.options.map((option) => {
                    const selected = group.status?.selectedOptionIds.includes(option.id) ?? false;
                    return (
                      <NodexButton
                        key={option.id}
                        size="xs"
                        variant="ghost"
                        aria-pressed={selected}
                        disabled={disabled}
                        className={cn(CHIP_CLASS, selected && CHIP_ACTIVE_CLASS)}
                        onClick={() =>
                          updateGroup(groupIndex, (current) =>
                            updateChoice(current, "status", (value) => ({
                              selectedOptionIds: value.selectedOptionIds.includes(option.id)
                                ? value.selectedOptionIds.filter(
                                    (candidate) => candidate !== option.id,
                                  )
                                : [...value.selectedOptionIds, option.id],
                              includeEmpty: false,
                            })),
                          )
                        }
                      >
                        {option.name}
                      </NodexButton>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {capabilities.priority && group.priority ? (
              <div className="flex items-start gap-2">
                <span className={ROW_LABEL}>{capabilities.priority.name}</span>
                <div className="flex min-w-0 flex-wrap gap-1">
                  {capabilities.priority.options.map((option) => {
                    const selected = group.priority?.selectedOptionIds.includes(option.id) ?? false;
                    return (
                      <NodexButton
                        key={option.id}
                        size="xs"
                        variant="ghost"
                        aria-pressed={selected}
                        disabled={disabled}
                        className={cn(CHIP_CLASS, selected && CHIP_ACTIVE_CLASS)}
                        onClick={() =>
                          updateGroup(groupIndex, (current) =>
                            updateChoice(current, "priority", (value) => ({
                              ...value,
                              selectedOptionIds: value.selectedOptionIds.includes(option.id)
                                ? value.selectedOptionIds.filter(
                                    (candidate) => candidate !== option.id,
                                  )
                                : [...value.selectedOptionIds, option.id],
                            })),
                          )
                        }
                      >
                        {option.name}
                      </NodexButton>
                    );
                  })}
                  <NodexButton
                    size="xs"
                    variant="ghost"
                    aria-label="Empty priority"
                    aria-pressed={group.priority.includeEmpty}
                    disabled={disabled}
                    className={cn(CHIP_CLASS, group.priority.includeEmpty && CHIP_ACTIVE_CLASS)}
                    onClick={() =>
                      updateGroup(groupIndex, (current) =>
                        updateChoice(current, "priority", (value) => ({
                          ...value,
                          includeEmpty: !value.includeEmpty,
                        })),
                      )
                    }
                  >
                    Empty
                  </NodexButton>
                </div>
              </div>
            ) : null}

            {capabilities.tags && group.tags ? (
              <div className="flex items-start gap-2">
                <span className={ROW_LABEL}>{capabilities.tags.name}</span>
                <div className="flex min-w-0 flex-wrap items-start gap-1">
                  <DatabaseViewSelect
                    ariaLabel={`Tag filter mode ${groupIndex + 1}`}
                    value={group.tags.mode}
                    valueLabel={
                      group.tags.mode === "any" ? "Any" : group.tags.mode === "all" ? "All" : "None"
                    }
                    options={[
                      { value: "any", label: "Any" },
                      { value: "all", label: "All" },
                      { value: "none", label: "None" },
                    ]}
                    disabled={disabled}
                    className="w-18"
                    onValueChange={(mode) =>
                      updateGroup(groupIndex, (current) =>
                        updateTags(current, (value) => ({
                          ...value,
                          mode: mode as DatabaseTaskTagMode,
                        })),
                      )
                    }
                  />
                  {capabilities.tags.options.length === 0 ? (
                    <span className="pt-1 text-xs italic text-token-description-foreground">
                      No tags in project
                    </span>
                  ) : (
                    capabilities.tags.options.map((option) => {
                      const selected = group.tags?.selectedOptionIds.includes(option.id) ?? false;
                      return (
                        <NodexButton
                          key={option.id}
                          size="xs"
                          variant="ghost"
                          aria-pressed={selected}
                          disabled={disabled}
                          className={cn(CHIP_CLASS, selected && CHIP_ACTIVE_CLASS)}
                          onClick={() =>
                            updateGroup(groupIndex, (current) =>
                              updateTags(current, (value) => ({
                                ...value,
                                selectedOptionIds: value.selectedOptionIds.includes(option.id)
                                  ? value.selectedOptionIds.filter(
                                      (candidate) => candidate !== option.id,
                                    )
                                  : [...value.selectedOptionIds, option.id],
                              })),
                            )
                          }
                        >
                          {option.name}
                        </NodexButton>
                      );
                    })
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}
