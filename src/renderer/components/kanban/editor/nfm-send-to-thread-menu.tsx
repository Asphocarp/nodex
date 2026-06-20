import { Check, Info, Plus, Search } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { CodexThreadIcon, SpinnerIcon } from "@/components/shared/icons";
import { NodexTooltip } from "@/components/ui/tooltip";
import { useProjectThreadSummaries } from "@/features/local-conversation/local-conversation-store";
import type { CodexThreadSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  readNfmSendToThreadMode,
  writeNfmSendToThreadMode,
} from "./nfm-send-to-thread-mode-settings";
import {
  buildNfmSendToThreadRows,
  moveNfmSendToThreadFocusedRowId,
  resolveNfmSendToThreadFocusedRowId,
  type NfmSendToThreadMode,
  type NfmSendToThreadRequest,
  type NfmSendToThreadRow,
} from "./nfm-send-to-thread-menu-model";

interface NfmSendToThreadMenuProps {
  projectId: string | null;
  onAccept: (request: NfmSendToThreadRequest) => Promise<void> | void;
  onClose: () => void;
}

export interface NfmSendToThreadMenuSurfaceProps extends NfmSendToThreadMenuProps {
  threads: readonly CodexThreadSummary[];
  initialQuery?: string;
}

const SEND_TO_THREAD_ERROR = "Could not send";
const SEND_TO_THREAD_WRAP_TOOLTIP =
  "Sends the blocks, then replaces them with a collapsed toggle linking to the thread.";

function getSendToThreadRowDomId(listboxId: string, index: number) {
  return `${listboxId}-option-${index}`;
}

function keepEditorSelection(event: ReactPointerEvent<HTMLElement>) {
  if (event.button !== 0) return;
  event.preventDefault();
}

function SendToThreadStatusRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-9 items-center px-3 text-[13px] leading-5 text-token-description-foreground">
      {children}
    </div>
  );
}

function SendToThreadModeSelector({
  mode,
  disabled,
  onModeChange,
}: {
  mode: NfmSendToThreadMode;
  disabled: boolean;
  onModeChange: (mode: NfmSendToThreadMode) => void;
}) {
  const modeItems = [
    { value: "send", label: "Send", hasInfo: false },
    { value: "wrap-toggle", label: "Send & wrap", hasInfo: true },
  ] as const;

  return (
    <div className="mx-2 mb-1 grid h-7 shrink-0 grid-cols-2 rounded-lg bg-token-foreground/5 p-0.5">
      {modeItems.map(({ value, label, hasInfo }) => {
        return (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            disabled={disabled}
            className={cn(
              "flex min-w-0 items-center justify-center gap-1 rounded-[7px] px-2 text-[12px] leading-6 text-token-description-foreground",
              "disabled:cursor-default disabled:opacity-50",
              mode === value && "bg-token-dropdown-background text-token-foreground shadow-sm",
            )}
            onPointerDown={keepEditorSelection}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onModeChange(value);
            }}
          >
            <span className="min-w-0 truncate">{label}</span>
            {hasInfo ? (
              <NodexTooltip
                tooltipContent={SEND_TO_THREAD_WRAP_TOOLTIP}
                side="top"
                sideOffset={4}
                tooltipBodyClassName="max-w-[220px] text-[12px] leading-4"
              >
                <span
                  data-testid="send-to-thread-wrap-mode-info"
                  className="inline-flex size-3.5 shrink-0 items-center justify-center text-token-description-foreground"
                  aria-hidden="true"
                >
                  <Info className="size-3 shrink-0" aria-hidden="true" />
                </span>
              </NodexTooltip>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function SendToThreadRow({
  row,
  index,
  listboxId,
  focused,
  disabled,
  accepting,
  onAccept,
  onFocusRowChange,
}: {
  row: NfmSendToThreadRow;
  index: number;
  listboxId: string;
  focused: boolean;
  disabled: boolean;
  accepting: boolean;
  onAccept: (row: NfmSendToThreadRow) => void;
  onFocusRowChange: (rowId: string) => void;
}) {
  return (
    <button
      id={getSendToThreadRowDomId(listboxId, index)}
      type="button"
      role="option"
      aria-selected={focused}
      aria-disabled={disabled || undefined}
      data-focused={focused ? "true" : undefined}
      data-nfm-send-to-thread-row-kind={row.kind}
      className={cn(
        "group flex h-7 w-full select-none items-center gap-1.5 rounded-[7px] px-1.5 text-left text-[14px] leading-7 outline-hidden",
        "text-token-foreground",
        disabled ? "cursor-default opacity-55" : "cursor-interaction hover:bg-token-list-hover-background",
        focused && "bg-token-list-hover-background",
      )}
      onPointerDown={keepEditorSelection}
      onPointerEnter={() => onFocusRowChange(row.id)}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onAccept(row);
      }}
    >
      <span className="flex h-[18px] w-[22px] shrink-0 items-center justify-center text-token-description-foreground">
        {row.kind === "new-thread" ? (
          <Plus className="size-4" aria-hidden="true" />
        ) : (
          <CodexThreadIcon className="size-4" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{row.label}</span>
      <span className="ml-1 max-w-[118px] shrink truncate text-[12px] leading-4 text-token-description-foreground">
        {row.meta}
      </span>
      {accepting ? (
        <SpinnerIcon className="size-3.5 shrink-0 text-token-description-foreground" />
      ) : null}
    </button>
  );
}

export function NfmSendToThreadMenu({
  projectId,
  onAccept,
  onClose,
}: NfmSendToThreadMenuProps) {
  const threads = useProjectThreadSummaries(projectId ?? "");

  return (
    <NfmSendToThreadMenuSurface
      projectId={projectId}
      threads={threads}
      onAccept={onAccept}
      onClose={onClose}
    />
  );
}

export function NfmSendToThreadMenuSurface({
  projectId,
  threads,
  initialQuery = "",
  onAccept,
  onClose,
}: NfmSendToThreadMenuSurfaceProps) {
  const listboxId = useId();
  const comboboxId = useId();
  const [query, setQuery] = useState(initialQuery);
  const deferredQuery = useDeferredValue(query);
  const [mode, setMode] = useState<NfmSendToThreadMode>(() => readNfmSendToThreadMode());
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [acceptingRowId, setAcceptingRowId] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    setQuery(initialQuery);
    setFocusedRowId(null);
  }, [initialQuery]);

  const rows = useMemo(
    () => projectId
      ? buildNfmSendToThreadRows({ threads, query: deferredQuery })
      : [],
    [deferredQuery, projectId, threads],
  );
  const resolvedFocusedRowId = resolveNfmSendToThreadFocusedRowId(
    focusedRowId,
    deferredQuery,
    rows,
  );
  const focusedIndex = resolvedFocusedRowId
    ? rows.findIndex((row) => row.id === resolvedFocusedRowId)
    : -1;
  const activeDescendantId = focusedIndex >= 0 && focusedIndex < rows.length
    ? getSendToThreadRowDomId(listboxId, focusedIndex)
    : undefined;
  const disabled = Boolean(acceptingRowId) || !projectId;
  const visibleThreadCount = rows.filter((row) => row.kind === "thread").length;

  const handleModeChange = useCallback((nextMode: NfmSendToThreadMode) => {
    setMode(writeNfmSendToThreadMode(nextMode));
  }, []);

  const acceptRow = useCallback(async (row: NfmSendToThreadRow) => {
    setAcceptError(null);
    setAcceptingRowId(row.id);
    try {
      await onAccept({
        target: row.target,
        mode,
      });
      setAcceptingRowId(null);
    } catch {
      setAcceptError(SEND_TO_THREAD_ERROR);
      setAcceptingRowId(null);
    }
  }, [mode, onAccept]);

  const activateRow = useCallback((row: NfmSendToThreadRow | undefined) => {
    if (!row || disabled) return;
    void acceptRow(row);
  }, [acceptRow, disabled]);

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusedRowId((currentRowId) =>
        moveNfmSendToThreadFocusedRowId(
          resolveNfmSendToThreadFocusedRowId(currentRowId, deferredQuery, rows),
          1,
          rows,
        )
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusedRowId((currentRowId) =>
        moveNfmSendToThreadFocusedRowId(
          resolveNfmSendToThreadFocusedRowId(currentRowId, deferredQuery, rows),
          -1,
          rows,
        )
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activateRow(rows[focusedIndex]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="flex max-h-[70vh] w-[330px] max-w-[calc(100vw-24px)] flex-col overflow-hidden text-[14px] leading-[1.2]"
      contentEditable={false}
    >
      <div className="flex h-[38px] shrink-0 items-center gap-1.5 px-2 py-[5px]">
        <Search className="size-4 shrink-0 text-token-description-foreground" aria-hidden="true" />
        <input
          id={comboboxId}
          role="combobox"
          aria-label="Search threads"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded="true"
          aria-haspopup="listbox"
          aria-activedescendant={activeDescendantId}
          value={query}
          placeholder="Search threads..."
          className="h-7 min-w-0 flex-1 rounded-[7px] bg-transparent px-1.5 py-[3px] text-[14px] text-token-foreground outline-hidden placeholder:text-token-description-foreground focus:bg-token-foreground/5"
          onChange={(event) => {
            setAcceptError(null);
            setFocusedRowId(null);
            setQuery(event.target.value);
          }}
          onKeyDown={handleInputKeyDown}
        />
      </div>
      <SendToThreadModeSelector
        mode={mode}
        disabled={disabled}
        onModeChange={handleModeChange}
      />
      <div className="notion-scroller vertical h-[340px] min-h-0 overflow-y-auto pb-3">
        <div id={listboxId} role="listbox" aria-labelledby={comboboxId}>
          <div className="pb-1">
            <div className="flex h-7 items-end px-[14px] pb-1 pt-3 text-[12px] leading-4 font-medium text-token-description-foreground">
              <span className="min-w-0 flex-1 truncate">Destination</span>
            </div>
            <div className="flex flex-col gap-px px-1">
              {rows.map((row, index) => (
                <SendToThreadRow
                  key={row.id}
                  row={row}
                  index={index}
                  listboxId={listboxId}
                  focused={focusedIndex === index}
                  disabled={disabled}
                  accepting={acceptingRowId === row.id}
                  onAccept={(acceptedRow) => {
                    void acceptRow(acceptedRow);
                  }}
                  onFocusRowChange={setFocusedRowId}
                />
              ))}
            </div>
          </div>
          {!projectId ? (
            <SendToThreadStatusRow>No project selected</SendToThreadStatusRow>
          ) : null}
          {projectId && visibleThreadCount === 0 ? (
            <SendToThreadStatusRow>
              <Check className="mr-2 size-3.5 text-token-description-foreground" />
              New thread is available
            </SendToThreadStatusRow>
          ) : null}
          {acceptError ? (
            <SendToThreadStatusRow>{acceptError}</SendToThreadStatusRow>
          ) : null}
        </div>
      </div>
    </div>
  );
}
