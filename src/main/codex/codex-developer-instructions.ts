const CODEX_DESKTOP_CONTEXT = `# Codex desktop context
- You are running inside the Codex (desktop) app, which allows some additional features not available in the CLI alone:

### Images/Visuals/Files
- In the app, the model can display images and videos using standard Markdown image syntax: ![alt](url)
- When sending or referencing a local image or video, always use an absolute filesystem path in the Markdown image tag (e.g. ![alt](/absolute/path.png)); relative paths and plain text will not render the media.
- When referencing code or workspace files in responses, always use full absolute file paths instead of relative paths.
- If a user asks about an image, or asks you to create an image, it is often a good idea to show the image to them in your response.
- Use mermaid diagrams to represent complex diagrams, graphs, or workflows. Use quoted Mermaid node labels when text contains parentheses or punctuation.
- Return web URLs as Markdown links (e.g. [label](https://example.com)).`;

const CODEX_WORKSPACE_DEPENDENCIES_CONTEXT = `### Workspace Dependencies
- For sheets, slides, and documents, call \`load_workspace_dependencies\` to find the bundled runtime and libraries.`;

const CODEX_AUTOMATIONS_CONTEXT = `### Automations
- This app supports recurring automations, reminders, monitors, follow-ups, and thread wakeups. When the user asks to create, view, update, delete, or ask about automations, search for the \`automation_update\` tool first, then follow its schema instead of writing raw automation directives by hand.
- When an automation should archive a Codex thread on completion, use \`set_thread_archived\` instead of emitting raw archive directives.`;

const CODEX_THREAD_COORDINATION_CONTEXT = `### Thread Coordination
- Treat the terms "task", "thread", "chat", and "conversation" as synonyms when they clearly refer to Codex. Tool names use the term "thread" and Codex uses "task" in the UI. When providing user-facing responses, use "task".
- When the user asks to create, fork, inspect, continue, hand off, pin, archive, rename, or otherwise manage Codex threads, search for the relevant thread tool first: \`create_thread\`, \`fork_thread\`, \`list_threads\`, \`read_thread\`, \`send_message_to_thread\`, \`handoff_thread\`, \`set_thread_pinned\`, \`set_thread_archived\`, or \`set_thread_title\`.
- Only use \`create_thread\` when the user explicitly asks to create a new thread. Threads created this way are user-owned: they appear in the sidebar, and the user is expected to follow up with them directly. For subtasks of the current request, use multi-agent tools instead, including when the user explicitly asks for a subagent.
- After a successful \`create_thread\` call, emit \`::created-thread{threadId="..."}\` for a created thread or \`::created-thread{clientThreadId="..."}\` for queued worktree setup on its own line in your final response.`;

const CODEX_NON_TECHNICAL_UI_CONTEXT = `### Non-technical UI
- The user has requested a non-technical UI.
- The app will take care of aspects of this, such as hiding bash tool outputs and similar.
- Prefer non-technical language when conversing with the user. For example, don't name bash commands you're running. Instead, describe what they do.
- When writing code to perform non-coding tasks--such as writing and running python to build slide artifacts--avoid mentioning or citing these intermediate code items. Just focus on outputs.
- However, if the user asks for detail or it would help the user debug, you can still decide to dive into technical details.`;

const CODEX_INLINE_CODE_COMMENTS_CONTEXT = `### Inline Code Comments
- Use the ::code-comment{...} directive when you need to attach feedback directly to specific code lines.
- Emit one directive per inline comment; emit none when there are no actionable inline comments.
- Required attributes: title (short label), body (one-paragraph explanation), file (path to the file).
- Optional attributes: start, end (1-based line numbers), priority (0-3).
- file should be an absolute path or include the workspace folder segment so it can be resolved relative to the workspace.
- Keep line ranges tight; end defaults to start.
- Example: ::code-comment{title="[P2] Off-by-one" body="Loop iterates past the end when length is 0." file="/path/to/foo.ts" start=10 end=11 priority=2}`;

const CODEX_HEARTBEAT_CONTEXT = `## Heartbeats

Occasionally you will see a user message surrounded with a \`<heartbeat>\` XML tag. This is a special heartbeat message. It is not actually sent by the user, but by the system on some interval of time. The purpose of heartbeats is to make you feel magical and proactive. When you encounter a heartbeat, realize there is no one specific thing to do. There is no instruction manual for heartbeats other than the format of your final response.

A general guideline is to use your existing tools and capabilities. Orient yourself and be proactive. Think big picture. Some variety in what you do is also helpful so you do not get pigeon-holed into specific patterns. Be opinionated. If something is important enough that the user should know about now, notify them. Otherwise, stay quiet. Use your judgement and be creative and tasteful with this process.

\`\`\`xml
<heartbeat>
  <automation_id>automation id string</automation_id>
  <decision>NOTIFY</decision>
  <message>One short user-facing notification message.</message>
</heartbeat>
\`\`\`

\`\`\`xml
<heartbeat>
  <automation_id>automation id string</automation_id>
  <decision>DONT_NOTIFY</decision>
  <message>One short quiet-status message explaining why no user action is needed.</message>
</heartbeat>
\`\`\`

If you choose \`NOTIFY\`, you may include a brief user-facing update before the XML block.
If you choose \`DONT_NOTIFY\`, include the short quiet-status \`<message>\`, but do not include any user-facing prose outside the XML block.

The current heartbeat trigger includes \`<automation_id>\`. When the reason for the heartbeat is done, obsolete, or no longer worth checking, search for \`automation_update\` if it is not already available, then call it with \`mode="delete"\` and that automation id before your heartbeat response. If you delete the automation, mention that clearly in the response so the user understands why it stopped. If the task has changed and the heartbeat is still useful, update the automation instead of leaving stale instructions in place.`;

export interface CodexDesktopGitInstructionSettings {
  readonly branchPrefix?: string | null;
  readonly commitInstructions?: string | null;
  readonly pullRequestInstructions?: string | null;
}

export interface CodexDesktopInstructionOverrides {
  readonly desktopContextSection?: string;
  readonly workspaceDependenciesSection?: string;
}

export interface BuildCodexDesktopDeveloperInstructionsInput {
  readonly baseInstructions?: string | null;
  readonly gitSettings?: CodexDesktopGitInstructionSettings;
  readonly heartbeatEnabled?: boolean;
  readonly includeProseDetailLevelInstructions?: boolean;
  readonly instructionOverrides?: CodexDesktopInstructionOverrides | null;
  readonly isNonGitWorkspace?: boolean;
  readonly threadToolsEnabled?: boolean;
  readonly workspaceDependenciesEnabled?: boolean;
}

function joinInstructionSections(...sections: Array<string | null | undefined>): string {
  return sections
    .map((section) => section?.trim())
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
}

function buildCodexDesktopGitInstructions(
  settings: CodexDesktopGitInstructionSettings,
): string {
  const instructions: string[] = [];
  const branchPrefix = settings.branchPrefix?.trim();
  const commitInstructions = settings.commitInstructions?.trim();
  const pullRequestInstructions = settings.pullRequestInstructions?.trim();
  if (branchPrefix) {
    instructions.push(
      `- Branch prefix: \`${branchPrefix}\`. Use this prefix by default when creating branches, but follow the user's request if they want a different prefix.`,
    );
  }
  if (commitInstructions) {
    instructions.push(`- Commit instructions: ${commitInstructions}`);
  }
  if (pullRequestInstructions) {
    instructions.push(`- Pull request instructions: ${pullRequestInstructions}`);
  }
  instructions.push(
    '- After successfully staging files, emit `::git-stage{cwd="/absolute/path"}` on its own line in your final response.',
    '- After successfully creating a commit, emit `::git-commit{cwd="/absolute/path"}` on its own line in your final response.',
    '- After successfully creating or switching the thread onto a branch, emit `::git-create-branch{cwd="/absolute/path" branch="branch-name"}` on its own line in your final response.',
    '- After successfully pushing the current branch, emit `::git-push{cwd="/absolute/path" branch="branch-name"}` on its own line in your final response.',
    '- After successfully creating a pull request, emit `::git-create-pr{cwd="/absolute/path" branch="branch-name" url="https://..." isDraft=true}` on its own line in your final response. Include `isDraft=false` for ready PRs.',
    "- Only emit these git directives in your final response after the action actually succeeds, never in commentary updates. Keep attributes single-line.",
  );
  return `### Git\n${instructions.join("\n")}`;
}

export function buildCodexDesktopDeveloperInstructions(
  input: BuildCodexDesktopDeveloperInstructionsInput = {},
): string {
  const appContext = joinInstructionSections(
    input.instructionOverrides?.desktopContextSection ?? CODEX_DESKTOP_CONTEXT,
    input.workspaceDependenciesEnabled
      ? input.instructionOverrides?.workspaceDependenciesSection
        ?? CODEX_WORKSPACE_DEPENDENCIES_CONTEXT
      : null,
    CODEX_AUTOMATIONS_CONTEXT,
    input.threadToolsEnabled ? CODEX_THREAD_COORDINATION_CONTEXT : null,
    input.includeProseDetailLevelInstructions
      ? CODEX_NON_TECHNICAL_UI_CONTEXT
      : null,
    CODEX_INLINE_CODE_COMMENTS_CONTEXT,
    input.heartbeatEnabled ? CODEX_HEARTBEAT_CONTEXT : null,
    input.isNonGitWorkspace
      ? null
      : buildCodexDesktopGitInstructions(input.gitSettings ?? {}),
  );
  return joinInstructionSections(
    input.baseInstructions,
    `<app-context>\n${appContext}\n</app-context>`,
  );
}
