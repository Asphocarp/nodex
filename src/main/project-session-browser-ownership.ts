export interface ProjectSessionBrowserRuntime {
  closeBrowserConversation(browserConversationId: string): void | Promise<void>;
  closeBrowserProject?(projectId: string): void | Promise<void>;
}

export interface DeleteProjectSessionWithBrowserCleanupInput {
  readonly sessionId: string;
  readonly browserRuntime: ProjectSessionBrowserRuntime;
  readonly deleteProjectSession: (sessionId: string) => boolean | Promise<boolean>;
}

export async function deleteProjectSessionWithBrowserCleanupUsing(
  input: DeleteProjectSessionWithBrowserCleanupInput,
): Promise<boolean> {
  const deleted = await input.deleteProjectSession(input.sessionId);
  if (!deleted) return false;

  await input.browserRuntime.closeBrowserConversation(input.sessionId);
  return true;
}
