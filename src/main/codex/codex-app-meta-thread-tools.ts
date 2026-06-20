import type { DynamicToolCallResponse } from "@nodex/codex-app-server-protocol/v2/DynamicToolCallResponse";
import type { DynamicToolSpec } from "@nodex/codex-app-server-protocol/v2/DynamicToolSpec";

export const CODEX_APP_TOOL_NAMESPACE = "codex_app";
export const CODEX_APP_LOCAL_HOST_ID = "local";
export const CODEX_APP_LOCAL_HOST_DISPLAY_NAME = null;
export const CODEX_APP_READ_THREAD_DEFAULT_TURN_LIMIT = 1;
export const CODEX_APP_READ_THREAD_MAX_TURN_LIMIT = 10;
export const CODEX_APP_READ_THREAD_DEFAULT_MAX_OUTPUT_CHARS = 2_000;
export const CODEX_APP_READ_THREAD_MAX_OUTPUT_CHARS = 20_000;
export const CODEX_APP_HANDOFF_MAX_WAIT_MS = 60_000;

const MODEL_DESCRIPTION =
  "Do not specify a model unless the user explicitly requests a specific model. Otherwise omit this field so the new thread uses the user's configured default model.";

const THINKING_SCHEMA = {
  type: "string",
  description: "Optional reasoning effort override.",
  enum: ["low", "medium", "high", "xhigh", "max"],
};

const STARTING_STATE_SCHEMA = {
  description: "Starting state for the new worktree.",
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: ["working-tree"],
        },
      },
      required: ["type"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: ["branch"],
        },
        branchName: {
          type: "string",
        },
      },
      required: ["type", "branchName"],
    },
  ],
};

const PROJECT_ENVIRONMENT_SCHEMA = {
  description: "Project execution environment.",
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: ["local"],
        },
      },
      required: ["type"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: ["worktree"],
        },
        startingState: STARTING_STATE_SCHEMA,
      },
      required: ["type"],
    },
  ],
};

const FORK_ENVIRONMENT_SCHEMA = {
  description: "Where the fork should run. Omit for a same-directory fork.",
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: ["same-directory"],
        },
      },
      required: ["type"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: ["worktree"],
        },
        startingState: STARTING_STATE_SCHEMA,
      },
      required: ["type"],
    },
  ],
};

type CodexAppMetaThreadToolSpec = Extract<DynamicToolSpec, { type: "namespace" }>["tools"][number];

function withOptionalDeferLoading(
  spec: CodexAppMetaThreadToolSpec,
  deferLoading: boolean,
): CodexAppMetaThreadToolSpec {
  return deferLoading ? { ...spec, deferLoading: true } : spec;
}

export function buildCodexAppMetaThreadToolSpecs(options?: {
  availableHandoffHosts?: Array<{ id: string; displayName: string }>;
  crossHostHandoffEnabled?: boolean;
  deferLoading?: boolean;
}): DynamicToolSpec[] {
  const deferLoading = options?.deferLoading === true;
  const handoffHosts = options?.availableHandoffHosts ?? [
    { id: CODEX_APP_LOCAL_HOST_ID, displayName: "Local" },
  ];
  const crossHostHandoffEnabled = options?.crossHostHandoffEnabled === true;
  const handoffDestinationHostSchema = crossHostHandoffEnabled
    ? {
        destinationHostId: {
          type: "string",
          description: `Optional host that should run the thread after handoff. Omit to move between the source thread's checkout and Codex worktree on its current host. Choose another host to move to a matching saved-project worktree. Available hosts: ${handoffHosts.map((host) => `${host.displayName} (${host.id})`).join(", ")}.`,
          enum: handoffHosts.map((host) => host.id),
        },
      }
    : {};

  const tools: CodexAppMetaThreadToolSpec[] = [
    {
      type: "function",
      name: "fork_thread",
      description:
        "Fork a Codex thread. Omit threadId to fork the calling thread, or pass a threadId to fork that specific thread. A same-directory fork returns a child threadId immediately; a worktree fork returns only a pendingWorktreeId until worktree setup creates the child. Forks contain completed history only: if the source thread is running, the active turn and unfinished response are not copied. Send a follow-up message to the child only if the task requires work to continue there.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          threadId: {
            type: "string",
            description: "Optional source thread id to fork. Omit to fork the calling thread.",
          },
          environment: FORK_ENVIRONMENT_SCHEMA,
        },
      },
    },
    {
      type: "function",
      name: "handoff_thread",
      description:
        "Move another Codex thread and its associated git state between its checkout and Codex worktree on its current host. Running threads are interrupted before handoff. Omit destinationHostId for this current-host toggle. The calling thread cannot move itself, and cloud handoff is not supported. Returns quickly with an operationId and revision. The UI continues to show live progress in the original handoff item. For model-visible completion, call get_handoff_status with afterRevision and a 30000-60000 waitMs, then back off if the revision does not change.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          threadId: {
            type: "string",
            description: "Other thread id to hand off.",
          },
          ...handoffDestinationHostSchema,
          followUpPrompt: {
            type: "string",
            description: "Optional prompt to send to the destination thread after handoff succeeds.",
          },
        },
        required: ["threadId"],
      },
    },
    {
      type: "function",
      name: "get_handoff_status",
      description:
        "Read status for a handoff_thread operation. The user-facing UI already updates in the original handoff item, so avoid frequent polling. Prefer afterRevision with a 30000-60000 waitMs so the call returns only when progress changes or the timeout expires. Poll once after dispatch, then wait longer/back off; do not repeatedly poll unchanged state or narrate unchanged polls.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          operationId: {
            type: "string",
            description: "operationId returned by handoff_thread.",
          },
          afterRevision: {
            type: "number",
            description: "Optional last revision already seen. When provided with waitMs, wait until the operation revision is greater than this value or the timeout expires.",
          },
          waitMs: {
            type: "number",
            description: `Optional maximum milliseconds to wait for a status change, from 0 to ${CODEX_APP_HANDOFF_MAX_WAIT_MS}.`,
          },
        },
        required: ["operationId"],
      },
    },
    {
      type: "function",
      name: "list_projects",
      description: "List available Codex projects, including project ids for create_thread targets.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    {
      type: "function",
      name: "create_thread",
      description:
        "Create a separate Codex thread only when the user explicitly asks for a new or background thread. Use list_projects first, then pass its projectId for repo-scoped work in any local or remote project. Use projectless targets for general tasks. Project targets must choose a local or worktree environment.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          prompt: {
            type: "string",
            description: "Initial prompt for the new thread.",
          },
          target: {
            description: "Where to create the thread.",
            anyOf: [
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  type: {
                    type: "string",
                    enum: ["project"],
                  },
                  projectId: {
                    type: "string",
                    description: "Project id returned by list_projects.",
                  },
                  environment: PROJECT_ENVIRONMENT_SCHEMA,
                },
                required: ["type", "projectId", "environment"],
              },
              {
                type: "object",
                additionalProperties: false,
                properties: {
                  type: {
                    type: "string",
                    enum: ["projectless"],
                  },
                  directoryName: {
                    type: "string",
                    description: "Optional projectless output directory name.",
                  },
                },
                required: ["type"],
              },
            ],
          },
          model: {
            type: "string",
            description: MODEL_DESCRIPTION,
          },
          thinking: THINKING_SCHEMA,
        },
        required: ["prompt", "target"],
      },
    },
    {
      type: "function",
      name: "list_threads",
      description:
        "List recent Codex threads across the local host and connected remote hosts. Use an optional query to find a specific thread before reading or steering it.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description: "Optional thread search query.",
          },
          limit: {
            type: "number",
            description: "Maximum number of thread summaries to return.",
          },
        },
      },
    },
    {
      type: "function",
      name: "read_thread",
      description:
        "Read recent status and turn summaries for one Codex thread without opening it. Use page cursors from earlier responses to read older turns.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          threadId: {
            type: "string",
            description: "Thread id to inspect.",
          },
          cursor: {
            type: "string",
            description: "Optional cursor for older turns.",
          },
          turnLimit: {
            type: "number",
            description: "Maximum number of turns to return.",
          },
          includeOutputs: {
            type: "boolean",
            description: "Whether to include truncated tool or command outputs.",
          },
          maxOutputCharsPerItem: {
            type: "number",
            description: "Maximum output characters to keep for each included output item.",
          },
        },
        required: ["threadId"],
      },
    },
    {
      type: "function",
      name: "send_message_to_thread",
      description:
        "Send a follow-up prompt to an existing Codex thread in the background. Omit model and thinking to keep the thread's current settings.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          threadId: {
            type: "string",
            description: "Thread id to continue.",
          },
          prompt: {
            type: "string",
            description: "Follow-up prompt to send.",
          },
          model: {
            type: "string",
            description: "Optional model override.",
          },
          thinking: THINKING_SCHEMA,
        },
        required: ["threadId", "prompt"],
      },
    },
    {
      type: "function",
      name: "set_thread_pinned",
      description: "Pin or unpin a Codex thread in the background.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          threadId: {
            type: "string",
            description: "Thread id to pin or unpin.",
          },
          pinned: {
            type: "boolean",
            description: "Whether the thread should be pinned.",
          },
        },
        required: ["threadId", "pinned"],
      },
    },
    {
      type: "function",
      name: "set_thread_archived",
      description: "Archive or unarchive a Codex thread in the background.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          threadId: {
            type: "string",
            description: "Thread id to archive or unarchive. Omit to target the calling thread.",
          },
          archived: {
            type: "boolean",
            description: "Whether the thread should be archived.",
          },
        },
        required: ["archived"],
      },
    },
    {
      type: "function",
      name: "set_thread_title",
      description: "Rename a Codex thread in the background.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          threadId: {
            type: "string",
            description: "Thread id to rename.",
          },
          title: {
            type: "string",
            description: "New thread title.",
          },
        },
        required: ["threadId", "title"],
      },
    },
    {
      type: "function",
      name: "read_thread_terminal",
      description:
        "Read the app terminal session attached to the current thread, including cwd, shell, and the latest terminal buffer.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  ];

  return [
    {
      type: "namespace",
      name: CODEX_APP_TOOL_NAMESPACE,
      description: "Nodex app controls for creating, listing, reading, updating, and handing off Codex threads.",
      tools: tools.map((tool) => withOptionalDeferLoading(tool, deferLoading)),
    },
  ];
}

export function buildCodexAppDynamicToolSuccess(value: unknown): DynamicToolCallResponse {
  return {
    contentItems: [{ type: "inputText", text: JSON.stringify(value ?? null) }],
    success: true,
  };
}

export function buildCodexAppDynamicToolFailure(message: string): DynamicToolCallResponse {
  return {
    contentItems: [{ type: "inputText", text: message }],
    success: false,
  };
}
