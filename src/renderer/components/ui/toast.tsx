import {
  type ReactNode,
  useCallback,
  useEffect,
  useSyncExternalStore,
} from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "@/components/shared/icons/generic-icons";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

const DEFAULT_TOAST_DURATION_MS = 5000;
const TOAST_EXIT_DURATION_S = 0.18;

export type ToastLevel = "info" | "success" | "warning" | "danger";

export interface ToastHandle {
  close: () => void;
}

export interface ToastOptions {
  description?: ReactNode;
  duration?: number;
  id?: string;
  hasCloseButton?: boolean;
  onRemove?: () => void;
}

export interface ToastCustomOptions {
  level?: ToastLevel;
  duration?: number;
  id?: string;
  hasCloseButton?: boolean;
  onRemove?: () => void;
  content: (input: { close: () => void; level: ToastLevel }) => ReactNode;
}

interface ToastBaseRecord {
  id: string;
  logicalId: string | null;
  level: ToastLevel;
  duration: number;
  hasCloseButton: boolean;
  isShown: boolean;
}

export interface ToastPlainRecord extends ToastBaseRecord {
  kind: "plain";
  title: ReactNode;
  description?: ReactNode;
}

export interface ToastCustomRecord extends ToastBaseRecord {
  kind: "custom";
  content: ToastCustomOptions["content"];
}

export type ToastRecord = ToastPlainRecord | ToastCustomRecord;

type ToastListener = () => void;

function resolveToastDuration(duration?: number): number {
  if (duration === 0) return 0;
  if (typeof duration !== "number" || Number.isNaN(duration) || duration < 0) {
    return DEFAULT_TOAST_DURATION_MS;
  }
  return duration;
}

function resolveLogicalToastId(id?: string): string | null {
  const normalized = id?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

class NodexToastStore {
  private snapshot: readonly ToastRecord[] = [];

  private readonly listeners = new Set<ToastListener>();

  private readonly records = new Map<string, ToastRecord>();

  private readonly onRemoveCallbacks = new Map<string, () => void>();

  private readonly orderedIds: string[] = [];

  private nextId = 1;

  subscribe = (listener: ToastListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): readonly ToastRecord[] => this.snapshot;

  info(title: ReactNode, options?: ToastOptions): ToastHandle {
    return this.createPlainToast("info", title, options);
  }

  success(title: ReactNode, options?: ToastOptions): ToastHandle {
    return this.createPlainToast("success", title, options);
  }

  warning(title: ReactNode, options?: ToastOptions): ToastHandle {
    return this.createPlainToast("warning", title, options);
  }

  danger(title: ReactNode, options?: ToastOptions): ToastHandle {
    return this.createPlainToast("danger", title, options);
  }

  custom(options: ToastCustomOptions): ToastHandle {
    const logicalId = resolveLogicalToastId(options.id);
    const id = this.createPhysicalToastId(logicalId);
    const record: ToastCustomRecord = {
      kind: "custom",
      id,
      logicalId,
      level: options.level ?? "info",
      duration: resolveToastDuration(options.duration),
      hasCloseButton: options.hasCloseButton ?? true,
      isShown: true,
      content: options.content,
    };
    return this.insertRecord(record, options.onRemove);
  }

  closeAll(): void {
    let didChange = false;

    for (const [id, record] of this.records.entries()) {
      if (!record.isShown) continue;
      this.records.set(id, {
        ...record,
        isShown: false,
      });
      didChange = true;
    }

    if (!didChange) return;
    this.emit();
  }

  close(id: string): void {
    const record = this.records.get(id);
    if (!record || !record.isShown) return;

    this.records.set(id, {
      ...record,
      isShown: false,
    });
    this.emit();
  }

  remove(id: string): void {
    if (!this.records.has(id)) return;

    this.records.delete(id);
    const index = this.orderedIds.indexOf(id);
    if (index >= 0) {
      this.orderedIds.splice(index, 1);
    }

    const onRemove = this.onRemoveCallbacks.get(id);
    this.onRemoveCallbacks.delete(id);
    this.emit();
    onRemove?.();
  }

  resetForTest(): void {
    this.snapshot = [];
    this.records.clear();
    this.onRemoveCallbacks.clear();
    this.orderedIds.splice(0, this.orderedIds.length);
    this.nextId = 1;
    this.emit();
  }

  private createPlainToast(
    level: ToastLevel,
    title: ReactNode,
    options?: ToastOptions,
  ): ToastHandle {
    const logicalId = resolveLogicalToastId(options?.id);
    const id = this.createPhysicalToastId(logicalId);
    const record: ToastPlainRecord = {
      kind: "plain",
      id,
      logicalId,
      level,
      duration: resolveToastDuration(options?.duration),
      hasCloseButton: options?.hasCloseButton ?? true,
      isShown: true,
      title,
      description: options?.description,
    };
    return this.insertRecord(record, options?.onRemove);
  }

  private createPhysicalToastId(logicalId: string | null): string {
    const physicalId = logicalId
      ? `${logicalId}-${this.nextId}`
      : String(this.nextId);
    this.nextId += 1;
    return physicalId;
  }

  private insertRecord(record: ToastRecord, onRemove?: () => void): ToastHandle {
    if (record.logicalId) {
      for (const [id, existing] of this.records.entries()) {
        if (existing.logicalId !== record.logicalId || !existing.isShown) continue;
        this.records.set(id, {
          ...existing,
          isShown: false,
        });
      }
    }

    this.records.set(record.id, record);
    if (onRemove) {
      this.onRemoveCallbacks.set(record.id, onRemove);
    }
    this.orderedIds.unshift(record.id);
    this.emit();

    return {
      close: () => {
        this.close(record.id);
      },
    };
  }

  private emit(): void {
    this.snapshot = this.orderedIds
      .map((id) => this.records.get(id) ?? null)
      .filter((record): record is ToastRecord => record !== null);

    for (const listener of this.listeners) {
      listener();
    }
  }
}

const nodexToastStore = new NodexToastStore();

export const toast = {
  info: (title: ReactNode, options?: ToastOptions) => nodexToastStore.info(title, options),
  success: (title: ReactNode, options?: ToastOptions) => nodexToastStore.success(title, options),
  warning: (title: ReactNode, options?: ToastOptions) => nodexToastStore.warning(title, options),
  danger: (title: ReactNode, options?: ToastOptions) => nodexToastStore.danger(title, options),
  custom: (options: ToastCustomOptions) => nodexToastStore.custom(options),
  closeAll: () => nodexToastStore.closeAll(),
};

export function useToaster() {
  return toast;
}

function useToastRecords() {
  return useSyncExternalStore(
    nodexToastStore.subscribe,
    nodexToastStore.getSnapshot,
    nodexToastStore.getSnapshot,
  );
}

function ToastDismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-token-description-foreground hover:bg-token-foreground/8 hover:text-token-foreground"
      aria-label="Dismiss notification"
      onClick={onClick}
    >
      <X className="size-3.5" />
    </button>
  );
}

function ToastLevelIcon({ level }: { level: ToastLevel }) {
  if (level === "success") {
    return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-token-charts-green" />;
  }

  if (level === "warning") {
    return <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-text-warning)]" />;
  }

  if (level === "danger") {
    return <AlertCircle className="mt-0.5 size-4 shrink-0 text-token-charts-red" />;
  }

  return <Info className="mt-0.5 size-4 shrink-0 text-token-description-foreground" />;
}

function plainToastToneClassName(level: ToastLevel): string {
  if (level === "success") {
    return "bg-token-charts-green/10 text-token-foreground ring-token-charts-green/25";
  }

  if (level === "warning") {
    return "bg-[var(--color-background-status-warning)] text-token-foreground ring-[var(--color-border-warning)]";
  }

  if (level === "danger") {
    return "bg-token-charts-red/10 text-token-foreground ring-token-charts-red/25";
  }

  return "bg-token-dropdown-background/90 text-token-foreground ring-token-border";
}

function NodexToastPlainSurface({
  record,
  onClose,
}: {
  record: ToastPlainRecord;
  onClose: () => void;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "pointer-events-auto flex min-w-0 items-start gap-2 rounded-[14px] px-3 py-2 shadow-lg ring-[0.5px] backdrop-blur-sm",
        plainToastToneClassName(record.level),
      )}
    >
      <ToastLevelIcon level={record.level} />
      <div className="min-w-0 flex-1">
        <div className="min-w-0 text-sm leading-5 font-medium text-token-foreground">
          {record.title}
        </div>
        {record.description ? (
          <div className="min-w-0 text-sm leading-5 text-token-description-foreground">
            {record.description}
          </div>
        ) : null}
      </div>
      {record.hasCloseButton ? <ToastDismissButton onClick={onClose} /> : null}
    </div>
  );
}

function NodexToastCustomSurface({
  record,
  onClose,
}: {
  record: ToastCustomRecord;
  onClose: () => void;
}) {
  return (
    <div
      className={cn(
        "pointer-events-auto relative rounded-[16px] bg-token-dropdown-background/90 shadow-lg ring-[0.5px] ring-token-border backdrop-blur-sm",
        record.hasCloseButton ? "pr-10" : "",
      )}
    >
      {record.hasCloseButton ? (
        <div className="absolute top-2 right-2">
          <ToastDismissButton onClick={onClose} />
        </div>
      ) : null}
      {record.content({
        close: onClose,
        level: record.level,
      })}
    </div>
  );
}

function NodexToastItem({ record }: { record: ToastRecord }) {
  const closeToast = useCallback(() => {
    nodexToastStore.close(record.id);
  }, [record.id]);

  return (
    <ToastLifecycleWrapper record={record}>
      {record.kind === "plain"
        ? <NodexToastPlainSurface record={record} onClose={closeToast} />
        : <NodexToastCustomSurface record={record} onClose={closeToast} />}
    </ToastLifecycleWrapper>
  );
}

function ToastLifecycleWrapper({
  record,
  children,
}: {
  record: ToastRecord;
  children: ReactNode;
}) {
  const closeToast = useCallback(() => {
    nodexToastStore.close(record.id);
  }, [record.id]);

  useEffect(() => {
    if (!record.isShown || record.duration === 0) return undefined;

    const timer = window.setTimeout(() => {
      closeToast();
    }, record.duration);

    return () => {
      window.clearTimeout(timer);
    };
  }, [closeToast, record.duration, record.isShown]);

  return (
    <motion.div
      data-slot="toast-item"
      layout="position"
      initial={{
        opacity: 0,
        y: -10,
        scale: 0.98,
      }}
      animate={record.isShown
        ? {
            opacity: 1,
            y: 0,
            scale: 1,
          }
        : {
            opacity: 0,
            y: -8,
            scale: 0.98,
          }}
      transition={{
        duration: TOAST_EXIT_DURATION_S,
        ease: [0.19, 1, 0.22, 1],
      }}
      onAnimationComplete={() => {
        if (!record.isShown) {
          nodexToastStore.remove(record.id);
        }
      }}
      className="w-full"
    >
      {children}
    </motion.div>
  );
}

export function NodexToastProvider({ children }: { children: ReactNode }) {
  const records = useToastRecords();

  return (
    <>
      {children}
      <div className="pointer-events-none fixed inset-0 z-[60]">
        <div
          data-slot="toast-viewport"
          className="pointer-events-none mx-auto flex w-full max-w-[560px] flex-col gap-2 px-3 pt-3"
        >
          {records.map((record) => (
            <NodexToastItem key={record.id} record={record} />
          ))}
        </div>
      </div>
    </>
  );
}

export function __resetNodexToastStoreForTests() {
  nodexToastStore.resetForTest();
}

export function __getNodexToastSnapshotForTests(): readonly ToastRecord[] {
  return nodexToastStore.getSnapshot();
}
