import { BudgetedMarkdownRenderer } from "@/features/local-conversation/view/shared/markdown/budgeted-markdown-renderer";

export function PlanSidePanelTab({ content }: { content: string }) {
  return (
    <div className="h-full min-h-0 overflow-y-auto px-1">
      <div className="px-4 py-3">
        <BudgetedMarkdownRenderer
          content={content}
          parseIncompleteMarkdown={false}
          className="codex-markdown-plan text-size-chat"
          sourceAriaLabel="Plan source"
        />
      </div>
    </div>
  );
}
