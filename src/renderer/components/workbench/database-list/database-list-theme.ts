/**
 * List owns semantic roles for its dense interaction states, while their colors
 * derive from the app surface contract so the view remains part of the same
 * visual system as Board and PageStage in every theme. The hierarchy guide is
 * preblended against the surface so its one-pixel stem/elbow overlap cannot
 * accumulate alpha and create a brighter seam.
 */
export const DATABASE_LIST_THEME_CLASS_NAME = [
  "[--database-list-surface:var(--color-token-main-surface-primary)]",
  "[--database-list-row-hover:color-mix(in_srgb,var(--color-token-foreground)_4%,var(--color-token-main-surface-primary))]",
  "[--database-list-row-selected:color-mix(in_srgb,var(--color-token-charts-blue)_14%,var(--color-token-main-surface-primary))]",
  "[--database-list-subgroup:color-mix(in_srgb,var(--color-token-foreground)_2.5%,var(--color-token-main-surface-primary))]",
  "[--database-list-group-start:color-mix(in_srgb,var(--color-token-foreground)_5%,var(--color-token-main-surface-primary))]",
  "[--database-list-group-end:color-mix(in_srgb,var(--color-token-foreground)_5%,var(--color-token-main-surface-primary))]",
  "[--database-list-text-primary:var(--color-token-text-primary)]",
  "[--database-list-group-text:var(--color-token-text-primary)]",
  "[--database-list-text-muted:var(--color-token-text-secondary)]",
  "[--database-list-group-count:var(--color-token-description-foreground)]",
  "[--database-list-icon-muted:var(--color-token-description-foreground)]",
  "[--database-list-nesting-line:color-mix(in_srgb,var(--color-token-foreground)_10%,var(--database-list-surface))]",
  "[--database-list-chip-border:var(--color-token-border)]",
  "[--database-property-chip-border:var(--database-list-chip-border)]",
  "[--database-property-chip-background:var(--database-list-surface)]",
  "[--database-property-chip-hover-background:color-mix(in_srgb,var(--color-token-foreground)_5%,var(--database-list-surface))]",
  "[--database-property-chip-hover-border:var(--color-token-border-heavy)]",
  "[--database-property-chip-hover-text:var(--database-list-text-primary)]",
  "[--database-property-chip-surface:var(--database-list-surface)]",
  "[--database-property-icon-muted:var(--database-list-icon-muted)]",
  "[--database-property-chip-text:var(--database-list-text-muted)]",
  "[--database-property-chip-focus:var(--database-list-focus)]",
  "[--database-list-checkbox-border:var(--color-token-description-foreground)]",
  "[--database-list-focus:var(--color-token-focus-border)]",
  "[--database-list-drop-indicator:var(--color-token-charts-blue)]",
].join(" ");
