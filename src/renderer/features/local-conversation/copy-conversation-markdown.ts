import { toast } from "@/components/ui/toast";
import { writeTextToClipboardStrict } from "@/lib/clipboard";
import {
  readLocalConversation,
  requestLocalConversationCompleteHistory,
  requestLocalConversationResume,
} from "./local-conversation-store";
import { selectVisibleConversationTurnEntries } from "./selectors";

export interface CopyConversationMarkdownInput {
  conversationId: string;
  parentConversationId?: string | null;
  title: string;
}

interface CopyConversationMarkdownDependencies {
  ensureCompleteHistory: () => Promise<void>;
  getMarkdown: () => Promise<string | null>;
  writeText: (value: string) => Promise<void>;
  showSuccess: () => void;
  showError: () => void;
}

export async function runCopyConversationMarkdown(
  dependencies: CopyConversationMarkdownDependencies,
): Promise<void> {
  try {
    await dependencies.ensureCompleteHistory();
    const markdown = await dependencies.getMarkdown();
    if (markdown == null || markdown.trim().length === 0) return;
    await dependencies.writeText(markdown);
    dependencies.showSuccess();
  } catch {
    dependencies.showError();
  }
}

async function ensureOneConversationHistoryLoaded(conversationId: string): Promise<void> {
  const current = readLocalConversation(conversationId);
  if (!current || current.resumeState !== "resumed") {
    await requestLocalConversationResume(conversationId);
  }
  await requestLocalConversationCompleteHistory(conversationId);
}

export async function copyConversationMarkdown({
  conversationId,
  parentConversationId = null,
  title,
}: CopyConversationMarkdownInput): Promise<void> {
  await runCopyConversationMarkdown({
    ensureCompleteHistory: async () => {
      await ensureOneConversationHistoryLoaded(conversationId);
      if (parentConversationId) {
        await ensureOneConversationHistoryLoaded(parentConversationId);
      }
    },
    getMarkdown: async () => {
      const conversation = readLocalConversation(conversationId);
      if (!conversation) return null;
      const parentTurns = parentConversationId
        ? readLocalConversation(parentConversationId)?.turns ?? []
        : [];
      const turns = selectVisibleConversationTurnEntries({ conversation, parentTurns });
      if (turns.length === 0) return null;
      const { renderConversationMarkdown } = await import("./conversation-markdown");
      return renderConversationMarkdown({
        cwd: conversation.cwd,
        title,
        turns,
      });
    },
    writeText: writeTextToClipboardStrict,
    showSuccess: () => toast.success("Conversation copied as Markdown"),
    showError: () => toast.danger("Failed to copy conversation as Markdown"),
  });
}
