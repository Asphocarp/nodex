import {
  Children,
  Fragment,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  type CSSProperties,
  type Ref,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export type HeaderActionSlotPosition = "left" | "center" | "right";
export type HeaderActionAlign = "start" | "end";

export interface HeaderActionEntry {
  actionId: string;
  slotPosition: HeaderActionSlotPosition;
  align: HeaderActionAlign;
  order: number;
  children: ReactNode;
}

export type HeaderActionProps = HeaderActionEntry;

const EMPTY_HEADER_ACTIONS: readonly HeaderActionEntry[] = [];
const HeaderActionsContext = createContext<readonly HeaderActionEntry[]>(EMPTY_HEADER_ACTIONS);
const HeaderActionRegistrationContext = createContext<HeaderActionCollector | null>(null);

interface HeaderActionCollector {
  add: (entry: HeaderActionEntry) => void;
  getEntries: () => HeaderActionEntry[];
}

export function HeaderAction(props: HeaderActionProps) {
  const collector = useContext(HeaderActionRegistrationContext);
  collector?.add({
    actionId: props.actionId,
    slotPosition: props.slotPosition,
    align: props.align,
    order: props.order,
    children: props.children,
  });

  return null;
}

export function HeaderActionProvider({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) {
  const collector = createHeaderActionCollector();

  return (
    <HeaderActionRegistrationContext.Provider value={collector}>
      <div hidden aria-hidden="true">
        {actions}
      </div>
      <CollectedHeaderActionProvider collector={collector}>
        {children}
      </CollectedHeaderActionProvider>
    </HeaderActionRegistrationContext.Provider>
  );
}

export function useHeaderActions(slotPosition?: HeaderActionSlotPosition): readonly HeaderActionEntry[] {
  const entries = useContext(HeaderActionsContext);
  if (!slotPosition) return entries;

  return entries.filter((entry) => entry.slotPosition === slotPosition);
}

export function collectHeaderActions(actions: ReactNode): HeaderActionEntry[] {
  const entries: HeaderActionEntry[] = [];

  const visit = (node: ReactNode) => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;

      if (child.type === Fragment) {
        visit(getElementChildren(child));
        return;
      }

      if (child.type === HeaderAction) {
        const props = child.props as HeaderActionProps;
        entries.push({
          actionId: props.actionId,
          slotPosition: props.slotPosition,
          align: props.align,
          order: props.order,
          children: props.children,
        });
        return;
      }

      visit(getElementChildren(child));
    });
  };

  visit(actions);

  return sortHeaderActions(entries);
}

function CollectedHeaderActionProvider({
  collector,
  children,
}: {
  collector: HeaderActionCollector;
  children: ReactNode;
}) {
  const entries = collector.getEntries();

  return (
    <HeaderActionsContext.Provider value={entries}>
      {children}
    </HeaderActionsContext.Provider>
  );
}

function createHeaderActionCollector(): HeaderActionCollector {
  const entries: HeaderActionEntry[] = [];

  return {
    add: (entry) => {
      entries.push(entry);
    },
    getEntries: () => sortHeaderActions(entries),
  };
}

export function HeaderShellSlot({
  side,
  slotWidth,
  minWidth,
  fallbackWidth,
  fallbackRailWidth,
  onMeasuredWidthChange,
  onMeasuredRailWidthChange,
}: {
  side: HeaderActionSlotPosition;
  slotWidth: number;
  minWidth: number;
  fallbackWidth: number;
  fallbackRailWidth: number;
  onMeasuredWidthChange: (width: number) => void;
  onMeasuredRailWidthChange: (width: number) => void;
}) {
  const entries = useHeaderActions(side);
  const probeRef = useRef<HTMLDivElement | null>(null);
  const railProbeRef = useRef<HTMLDivElement | null>(null);
  const measurementKey = entries.map((entry) => `${entry.actionId}:${entry.align}:${entry.order}`).join("|");
  const paddingClassName = resolveHeaderSlotPaddingClassName(side, entries.length);

  useEffect(() => {
    const controlsElement = probeRef.current;
    if (!controlsElement) return undefined;

    if (entries.length === 0) {
      onMeasuredWidthChange(0);
      onMeasuredRailWidthChange(0);
      return undefined;
    }

    const measure = () => {
      const width = Math.ceil(controlsElement.getBoundingClientRect().width);
      const railWidth = Math.ceil(railProbeRef.current?.getBoundingClientRect().width ?? 0);
      onMeasuredWidthChange(width > 0 ? width : fallbackWidth);
      onMeasuredRailWidthChange(railWidth > 0 ? railWidth : fallbackRailWidth);
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        window.removeEventListener("resize", measure);
      };
    }

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(controlsElement);
    return () => {
      resizeObserver.disconnect();
    };
  }, [
    entries.length,
    fallbackRailWidth,
    fallbackWidth,
    measurementKey,
    onMeasuredRailWidthChange,
    onMeasuredWidthChange,
  ]);

  return (
    <>
      <div
        ref={probeRef}
        aria-hidden="true"
        className={cn(
          "invisible pointer-events-none fixed top-0 left-0 min-w-max [&_*]:![view-transition-name:none]",
          paddingClassName,
        )}
      >
        <HeaderActionRail entries={entries} railRef={railProbeRef} />
      </div>
      <div
        data-test-id="header-shell-slot"
        className={cn(
          "pointer-events-none relative h-full shrink-0 [container-type:inline-size]",
          side === "right" && "ml-auto",
          paddingClassName,
        )}
        style={{ width: slotWidth, minWidth } satisfies CSSProperties}
      >
        <HeaderActionRail entries={entries} fillSlot />
      </div>
    </>
  );
}

function HeaderActionRail({
  entries,
  fillSlot = false,
  railRef,
}: {
  entries: readonly HeaderActionEntry[];
  fillSlot?: boolean;
  railRef?: Ref<HTMLDivElement>;
}) {
  const startEntries = entries.filter((entry) => entry.align === "start");
  const endEntries = entries.filter((entry) => entry.align === "end");

  return (
    <div
      ref={railRef}
      data-workbench-header-action-rail={fillSlot ? "visible" : "measure"}
      className={cn(
        "inline-flex h-full items-center gap-1.5",
        fillSlot ? "pointer-events-none w-full" : "no-drag pointer-events-auto w-auto",
      )}
    >
      {startEntries.map((entry) => renderHeaderActionEntry(entry, false))}
      {endEntries.map((entry, index) => renderHeaderActionEntry(entry, index === 0))}
    </div>
  );
}

function renderHeaderActionEntry(entry: HeaderActionEntry, pushToEnd: boolean) {
  return (
    <div
      key={entry.actionId}
      className={cn(
        "no-drag pointer-events-auto flex shrink-0 items-center",
        pushToEnd && "ms-auto",
      )}
    >
      {entry.children}
    </div>
  );
}

function sortHeaderActions(entries: readonly HeaderActionEntry[]): HeaderActionEntry[] {
  const entriesById = new Map<string, HeaderActionEntry>();
  entries.forEach((entry) => {
    entriesById.set(entry.actionId, entry);
  });

  return Array.from(entriesById.values()).sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    return left.actionId.localeCompare(right.actionId);
  });
}

function getElementChildren(element: ReactElement): ReactNode {
  const props = element.props;
  if (typeof props !== "object" || props === null || !("children" in props)) return null;

  return (props as { children?: ReactNode }).children;
}

function resolveHeaderSlotPaddingClassName(side: HeaderActionSlotPosition, entryCount: number) {
  if (entryCount === 0) return null;
  if (side === "left") return "ps-[max(var(--spacing-token-safe-header-left),0.5rem)]";
  if (side === "right") return "pe-2";
  return null;
}
