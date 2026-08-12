/**
 * List owns semantic roles for its dense interaction states, while their colors
 * derive from the app surface contract so the view remains part of the same
 * visual system as Board and PageStage in every theme.
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
  "[--database-list-chip-border:var(--color-token-border)]",
  "[--database-list-chip-background:color-mix(in_srgb,var(--color-token-foreground)_2.5%,var(--color-token-main-surface-primary))]",
  "[--database-list-chip-hover:color-mix(in_srgb,var(--color-token-foreground)_5%,var(--color-token-main-surface-primary))]",
  "[--database-list-checkbox-border:var(--color-token-description-foreground)]",
  "[--database-list-focus:var(--color-token-focus-border)]",
  "[--database-list-drop-indicator:var(--color-token-charts-blue)]",
].join(" ");
