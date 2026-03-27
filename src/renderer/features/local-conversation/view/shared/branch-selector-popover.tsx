import { useCallback, useMemo, useState } from "react";
import {
  BranchStatusIcon,
  CheckmarkIcon,
  PlusIcon,
} from "@/components/shared/icons";
import {
  NodexDropdownButtonTrigger,
  NodexDropdownItem,
  NodexDropdownMessage,
  NodexDropdownMenu,
  NodexDropdownSearchInput,
  NodexDropdownSection,
  NodexDropdownSectionLabel,
  NodexDropdownSeparator,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";

export interface BranchSelectorPopoverState {
  currentBranch: string | null;
  defaultBranch?: string | null;
  branches: string[];
}

interface BranchSelectorPopoverProps {
  cwd: string | null;
  state: BranchSelectorPopoverState;
  busy: boolean;
  onRefresh: () => Promise<void>;
  onCheckout: (branch: string) => Promise<boolean>;
  onCreate?: (branch: string) => Promise<boolean>;
  selectedBranch?: string | null;
  disabled?: boolean;
  triggerClassName?: string;
}

function filterBranches(branches: string[], query: string): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return branches;
  return branches.filter((branch) => branch.toLowerCase().includes(normalizedQuery));
}

export function BranchSelectorPopover({
  cwd,
  state,
  busy,
  onRefresh,
  onCheckout,
  onCreate,
  selectedBranch,
  disabled = false,
  triggerClassName,
}: BranchSelectorPopoverProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredBranches = useMemo(
    () => filterBranches(state.branches, search),
    [search, state.branches],
  );

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      void onRefresh();
      return;
    }

    setSearch("");
  }, [onRefresh]);

  const handleBranchSelect = useCallback(async (branch: string) => {
    const didCheckout = await onCheckout(branch);
    if (!didCheckout) return;
    setOpen(false);
  }, [onCheckout]);

  const handleCreateSelect = useCallback(async () => {
    if (!onCreate) return;

    const typedBranch = search.trim();
    const promptedBranch = typeof window !== "undefined" && !typedBranch
      ? window.prompt("Create and checkout new branch", "") ?? ""
      : "";
    const nextBranch = typedBranch || promptedBranch.trim();
    if (!nextBranch) return;

    const didCreate = await onCreate(nextBranch);
    if (!didCreate) return;
    setOpen(false);
  }, [onCreate, search]);

  const activeSelectedBranch = selectedBranch?.trim() || null;
  const currentBranch = activeSelectedBranch ?? state.currentBranch;
  const triggerLabel = currentBranch ?? state.defaultBranch ?? "No branch";
  const isDisabled = disabled || !cwd || busy;
  const hasRepositoryState = state.currentBranch !== null || state.branches.length > 0 || Boolean(state.defaultBranch);
  const emptyBranchMessage = !cwd
    ? "Working directory unavailable"
    : !hasRepositoryState && !search.trim()
      ? "No Git repository detected"
      : "No matching branches";
  const canCreateBranch = Boolean(onCreate && cwd && !busy && hasRepositoryState);

  return (
    <NodexDropdownMenu
      open={open}
      onOpenChange={handleOpenChange}
      side="top"
      align="start"
      triggerButton={(
        <NodexDropdownButtonTrigger
          aria-label="Select Git branch"
          title={cwd ? triggerLabel : "Working directory unavailable"}
          disabled={isDisabled}
          size="sm"
          chrome="transparent"
          shape="pill"
          muted
          className={cn("px-1.5", triggerClassName)}
        >
          <span className="inline-flex min-w-0 items-center gap-1">
            <BranchStatusIcon className="shrink-0" />
            <span className="max-w-40 truncate text-sm">{triggerLabel}</span>
          </span>
        </NodexDropdownButtonTrigger>
      )}
      contentWidth="panel"
    >
      <NodexDropdownSearchInput
        autoFocus={false}
        placeholder="Search branches"
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;

          event.preventDefault();
          if (filteredBranches.length === 0) {
            void handleCreateSelect();
            return;
          }

          const nextBranch = filteredBranches.find((branch) => branch !== currentBranch) ?? filteredBranches[0];
          if (!nextBranch) return;
          void handleBranchSelect(nextBranch);
        }}
      />

      <NodexDropdownScrollBranchList
        filteredBranches={filteredBranches}
        currentBranch={currentBranch}
        busy={busy}
        emptyBranchMessage={emptyBranchMessage}
        onBranchSelect={handleBranchSelect}
      />

      {onCreate ? (
        <>
          <NodexDropdownSeparator />
          <NodexDropdownItem
            disabled={!canCreateBranch}
            onSelect={() => {
              void handleCreateSelect();
            }}
            leftSlot={<PlusIcon className="size-4 shrink-0" />}
          >
            Create and checkout new branch…
          </NodexDropdownItem>
        </>
      ) : null}
    </NodexDropdownMenu>
  );
}

function NodexDropdownScrollBranchList({
  filteredBranches,
  currentBranch,
  busy,
  emptyBranchMessage,
  onBranchSelect,
}: {
  filteredBranches: string[];
  currentBranch: string | null;
  busy: boolean;
  emptyBranchMessage: string;
  onBranchSelect: (branch: string) => Promise<void>;
}) {
  return (
    <div className="vertical-scroll-fade-mask flex h-[200px] flex-col gap-1.5 overflow-y-auto">
      <NodexDropdownSectionLabel>Branches</NodexDropdownSectionLabel>
      {filteredBranches.length === 0 ? (
        <NodexDropdownMessage compact>{emptyBranchMessage}</NodexDropdownMessage>
      ) : (
        <NodexDropdownSection className="flex flex-col">
          {filteredBranches.map((branch) => (
            <NodexDropdownItem
              key={branch}
              disabled={busy}
              onSelect={() => {
                void onBranchSelect(branch);
              }}
              leftSlot={<BranchStatusIcon className="shrink-0" />}
              rightSlot={branch === currentBranch ? <CheckmarkIcon className="shrink-0" /> : null}
              tooltipText={branch}
              tooltipSide="top"
              tooltipAlign="start"
            >
              {branch}
            </NodexDropdownItem>
          ))}
        </NodexDropdownSection>
      )}
    </div>
  );
}
