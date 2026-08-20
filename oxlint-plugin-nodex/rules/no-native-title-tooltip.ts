import { defineRule } from "@oxlint/plugins";

const INTRINSIC_ELEMENT_PATTERN = /^[a-z]/u;
const TITLE_IS_AN_ACCESSIBLE_NAME = new Set(["embed", "frame", "iframe", "math", "object"]);

// Existing native tooltips remain visible debt. Each file may only move this
// number down; new files start at zero.
const LEGACY_BASELINE = new Map<string, number>([
  ["src/renderer/components/block-documents/block-document-sync-status.tsx", 1],
  ["src/renderer/components/block-documents/page-outliner-surface.tsx", 1],
  ["src/renderer/components/block-documents/portable-rich-title.tsx", 2],
  ["src/renderer/components/block-documents/reference-block-surfaces.tsx", 2],
  ["src/renderer/components/board/calendar/calendar-toolbar.tsx", 1],
  ["src/renderer/components/board/column-action-popover.tsx", 1],
  ["src/renderer/components/board/editor/agent-config-chip.tsx", 1],
  ["src/renderer/components/board/editor/attachment-chip.tsx", 1],
  ["src/renderer/components/board/editor/canvas-block.tsx", 2],
  ["src/renderer/components/board/editor/nfm-editor.tsx", 6],
  ["src/renderer/components/board/editor/nfm-link-toolbar-surface.tsx", 2],
  ["src/renderer/components/board/editor/nfm-link-toolbar.tsx", 1],
  ["src/renderer/components/board/editor/nfm-side-menu.tsx", 1],
  ["src/renderer/components/board/editor/nfm-text-action-menu.tsx", 1],
  ["src/renderer/components/board/editor/projection-drag-handle.tsx", 1],
  ["src/renderer/components/board/editor/readonly-nfm-blocknote-preview.tsx", 2],
  ["src/renderer/components/board/editor/thread-section-row.tsx", 2],
  ["src/renderer/components/board/nfm-renderer.tsx", 4],
  ["src/renderer/components/board/page-stage/breadcrumb.tsx", 3],
  ["src/renderer/components/board/page-stage/properties-section.tsx", 2],
  ["src/renderer/components/board/page-stage/toolbar.tsx", 1],
  ["src/renderer/components/board/toggle-list-rules-body.tsx", 9],
  ["src/renderer/components/canvas/canvas-document-surface.tsx", 1],
  ["src/renderer/components/database/data-source-property-value-editor.tsx", 1],
  ["src/renderer/components/database/property-option-picker.tsx", 1],
  ["src/renderer/components/shared/file-link-anchor.tsx", 2],
  ["src/renderer/components/ui/button.tsx", 1],
  ["src/renderer/components/ui/destination-picker.tsx", 1],
  ["src/renderer/components/workbench/codex-sidebar.tsx", 1],
  ["src/renderer/components/workbench/command-palette-surface.tsx", 2],
  ["src/renderer/components/workbench/database-board/database-board-card.tsx", 1],
  ["src/renderer/components/workbench/database-list/database-list-property-cells.tsx", 2],
  ["src/renderer/components/workbench/database-list/database-list-row.tsx", 1],
  ["src/renderer/components/workbench/database-view-surface.tsx", 1],
  ["src/renderer/components/workbench/db-view-toolbar.tsx", 1],
  ["src/renderer/components/workbench/left-sidebar-footer.tsx", 1],
  ["src/renderer/components/workbench/left-sidebar.tsx", 1],
  ["src/renderer/components/workbench/managed-worktrees-settings-control.tsx", 3],
  ["src/renderer/components/workbench/pages-tab-picker.tsx", 1],
  ["src/renderer/components/workbench/sidebar-new-chat-controls.tsx", 1],
  ["src/renderer/components/workbench/stage-tab-strip.tsx", 2],
  ["src/renderer/components/workbench/workbench-automations-overlay.tsx", 2],
  ["src/renderer/components/workbench/workbench-hooks-settings-page.tsx", 2],
  ["src/renderer/components/workbench/workbench-panel-controls.tsx", 2],
  ["src/renderer/components/workbench/workbench-panel-new-tab-button.tsx", 1],
  ["src/renderer/components/workbench/workbench-process-manager-dialog.tsx", 2],
  ["src/renderer/components/workbench/workbench-runtime-panel-surfaces.tsx", 2],
  ["src/renderer/components/workbench/workbench-runtime.tsx", 2],
  ["src/renderer/components/workbench/workbench-session-sidebar.tsx", 1],
  ["src/renderer/features/browser-sidebar/browser-sidebar-panel.tsx", 6],
  ["src/renderer/features/local-conversation/view/composer/composer-add-context-menu.tsx", 1],
  ["src/renderer/features/local-conversation/view/composer/intelligence-selector-trigger.tsx", 1],
  [
    "src/renderer/features/local-conversation/view/composer/local-conversation-thread-composer.tsx",
    10,
  ],
  [
    "src/renderer/features/local-conversation/view/composer/request-cards/codex-permission-request-card.tsx",
    1,
  ],
  ["src/renderer/features/local-conversation/view/local-conversation-stage-header.tsx", 1],
  ["src/renderer/features/local-conversation/view/shared/account-rate-limit-ring.tsx", 1],
  ["src/renderer/features/local-conversation/view/shared/collaboration-mode-dropdown.tsx", 1],
  [
    "src/renderer/features/local-conversation/view/shared/request-cards/local-conversation-request-cards.tsx",
    1,
  ],
  [
    "src/renderer/features/local-conversation/view/summary-panel/thread-floating-summary-panel.tsx",
    3,
  ],
  ["src/renderer/features/local-conversation/view/summary-panel/thread-summary-panel-row.tsx", 1],
  [
    "src/renderer/features/local-conversation/view/summary-panel/thread-summary-panel-toggle.tsx",
    1,
  ],
]);

const baselineFor = (filename: string): number => {
  const normalized = filename.replaceAll("\\", "/");
  for (const [suffix, count] of LEGACY_BASELINE) {
    if (normalized.endsWith(suffix)) return count;
  }
  return 0;
};

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Keep product tooltips on the app-owned accessible tooltip surface.",
    },
  },
  create(context) {
    const allowedCount = baselineFor(context.filename);
    let occurrenceCount = 0;

    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        if (!INTRINSIC_ELEMENT_PATTERN.test(node.name.name)) return;
        if (TITLE_IS_AN_ACCESSIBLE_NAME.has(node.name.name)) return;

        for (const attribute of node.attributes) {
          if (attribute.type !== "JSXAttribute") continue;
          if (attribute.name.type !== "JSXIdentifier" || attribute.name.name !== "title") continue;

          occurrenceCount += 1;
          if (occurrenceCount <= allowedCount) continue;

          context.report({
            node: attribute,
            message:
              "Do not use the native title attribute as a tooltip. Wrap the trigger with NodexTooltip from @/components/ui/tooltip.",
          });
        }
      },
    };
  },
});
