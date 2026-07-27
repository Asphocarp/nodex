import type { PanelTabDropIntent } from "./panel-tab-dnd";

type PanelTabRowDropIntent = Extract<PanelTabDropIntent, { kind: "tab-row" }>;

export function PanelTabInsertionIndicator({
  intent,
}: {
  intent: PanelTabRowDropIntent;
}) {
  return (
    <div
      aria-hidden="true"
      data-panel-tab-insertion-marker={`${intent.panelId}:${intent.leafId}:${intent.targetIndex}`}
      className="pointer-events-none absolute top-1/2 z-30 h-6 w-0 -translate-x-1/2 -translate-y-1/2 before:absolute before:inset-y-1 before:left-[-1px] before:w-0.5 before:rounded-full before:bg-token-text-link-foreground before:content-[''] after:absolute after:top-0 after:left-[-4px] after:size-2 after:rounded-full after:border-2 after:border-token-text-link-foreground after:bg-token-main-surface-primary after:content-['']"
      role="presentation"
      style={{ left: intent.markerLeft }}
    />
  );
}
