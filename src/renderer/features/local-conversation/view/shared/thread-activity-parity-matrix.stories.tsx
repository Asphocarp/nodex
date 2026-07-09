import type { Meta, StoryObj } from "@storybook/react-vite";

interface StoryMatrixState {
  href: string;
  label: string;
}

interface ThreadActivityStoryMatrixRow {
  family: string;
  packet: `L-${string}`;
  evidence: string;
  states: readonly StoryMatrixState[];
}

const EXACT_BUNDLE_PROVENANCE = {
  version: "26.707.30751",
  build: "5018",
  asarSha256: "bf6a8d30300c95cd12eb51fc39ea462a3b1bd4719a4ab260b22194340d0b2959",
} as const;

const THREAD_ACTIVITY_STORY_MATRIX = [
  {
    family: "Command dispatch",
    packet: "L-01",
    evidence: "g4rafana · Pp, dh/fh/ph, hh/Sh/Dh",
    states: [
      { label: "Structured command", href: "?path=/story/workbench-threads-tool-calls--command-execution" },
      { label: "Exploration actions", href: "?path=/story/workbench-threads-tool-calls--exploration-group" },
      { label: "Long command expanded", href: "?path=/story/workbench-threads-tool-calls--command-execution-long-command-expanded" },
    ],
  },
  {
    family: "Command lifecycle",
    packet: "L-02",
    evidence: "g4rafana · ph/Nh/Rh/qh",
    states: [
      { label: "Running", href: "?path=/story/workbench-threads-tool-calls--command-execution-in-progress-no-output" },
      { label: "Failed exit", href: "?path=/story/workbench-threads-tool-calls--command-execution-failed-exit-code" },
      { label: "Stopped", href: "?path=/story/workbench-threads-tool-calls--command-execution-stopped" },
      { label: "Truncated output", href: "?path=/story/workbench-threads-tool-calls--command-execution-truncated-output" },
    ],
  },
  {
    family: "Patch / file change",
    packet: "L-03",
    evidence: "g4rafana · e_/n_/a_/o_/s_/c_, sh/rh/ut/Ll",
    states: [
      { label: "Completed", href: "?path=/story/workbench-threads-tool-calls--file-change" },
      { label: "Live patch", href: "?path=/story/workbench-threads-tool-calls--file-change-live-patch-update" },
      { label: "Visualization", href: "?path=/story/workbench-threads-tool-calls--file-change-visualization-only" },
      { label: "Semantic fallback", href: "?path=/story/workbench-threads-tool-calls--file-change-semantic-fallback" },
      { label: "Review states", href: "?path=/story/workbench-threads-tool-calls--file-change-auto-review-states" },
    ],
  },
  {
    family: "Web search",
    packet: "L-04",
    evidence: "g4rafana · R2/Pp/ld/AJn, I/fe",
    states: [
      { label: "Completed", href: "?path=/story/workbench-threads-tool-calls--web-search" },
      { label: "Find in page", href: "?path=/story/workbench-threads-tool-calls--web-search-find-in-page" },
      { label: "Running", href: "?path=/story/workbench-threads-tool-calls--web-search-in-progress" },
      { label: "Settled current group", href: "?path=/story/workbench-threads-tool-calls--web-search-completed-current-collapsed-activity" },
    ],
  },
  {
    family: "MCP tool call",
    packet: "L-05",
    evidence: "k0ede4gb · aJn/Lqn/Rqn/cJn/QJ",
    states: [
      { label: "Collapsed", href: "?path=/story/workbench-threads-tool-calls--mcp-tool-call-collapsed" },
      { label: "Expanded", href: "?path=/story/workbench-threads-tool-calls--mcp-tool-call-expanded" },
      { label: "Running", href: "?path=/story/workbench-threads-tool-calls--mcp-tool-call-in-progress" },
      { label: "Protocol error", href: "?path=/story/workbench-threads-tool-calls--mcp-tool-call-protocol-error" },
      { label: "Rare content blocks", href: "?path=/story/workbench-threads-tool-calls--mcp-tool-call-rare-content-blocks" },
      { label: "No content", href: "?path=/story/workbench-threads-tool-calls--mcp-tool-call-no-content" },
      { label: "Malformed block", href: "?path=/story/workbench-threads-tool-calls--mcp-tool-call-unknown-block" },
      { label: "MCP app + review", href: "?path=/story/workbench-threads-tool-calls--mcp-tool-call-app-with-auto-review" },
      { label: "Raw output", href: "?path=/story/workbench-threads-tool-calls--mcp-raw-output-dialog" },
    ],
  },
  {
    family: "Dynamic tool registry",
    packet: "L-06",
    evidence: "k0ede4gb · Pwn/Fwn/Iwn/Gwn, eTn/tTn, o6/DTn/OTn/kTn/ATn",
    states: [
      { label: "Read task", href: "?path=/story/workbench-threads-tool-calls--dynamic-tool-call-read-thread" },
      { label: "Task controls", href: "?path=/story/workbench-threads-tool-calls--codex-app-meta-thread-tools" },
      { label: "Registered renderers", href: "?path=/story/workbench-threads-tool-calls--dynamic-tool-registry-renderers" },
      { label: "Fallback rows", href: "?path=/story/workbench-threads-tool-calls--dynamic-tool-call-fallback-rows" },
      { label: "Group headers", href: "?path=/story/workbench-threads-tool-calls--dynamic-tool-call-group-headers" },
    ],
  },
  {
    family: "Automatic review",
    packet: "L-07",
    evidence: "g4rafana · Pp/oV/sV/pp/zm, $zn/eBn/tBn",
    states: [
      { label: "Denied standalone", href: "?path=/story/workbench-threads-transcript-specials--automatic-approval-review-denied" },
      { label: "Running groupable", href: "?path=/story/workbench-threads-transcript-specials--automatic-approval-review-in-progress" },
      { label: "Attached terminal states", href: "?path=/story/workbench-threads-tool-calls--file-change-auto-review-states" },
    ],
  },
  {
    family: "Multi-agent action",
    packet: "L-08",
    evidence: "g4rafana · Pp/by, yg/wg/Tg",
    states: [
      { label: "Completed", href: "?path=/story/workbench-threads-transcript-specials--multi-agent-action-completed" },
      { label: "Expanded", href: "?path=/story/workbench-threads-transcript-specials--multi-agent-action-completed-expanded" },
      { label: "Running", href: "?path=/story/workbench-threads-transcript-specials--multi-agent-action-in-progress" },
      { label: "Failed", href: "?path=/story/workbench-threads-transcript-specials--multi-agent-action-failed" },
      { label: "Prompt metadata", href: "?path=/story/workbench-threads-transcript-specials--multi-agent-action-prompt-metadata" },
    ],
  },
  {
    family: "Subagent activity",
    packet: "L-08",
    evidence: "g4rafana · eV/lv/sv/mV/hV/fv",
    states: [
      { label: "Compact overflow group", href: "?path=/story/workbench-threads-transcript-specials--subagent-activity-compact-group" },
    ],
  },
  {
    family: "Inspected images",
    packet: "L-09",
    evidence: "h59fr3q5 + g4rafana + k0ede4gb · raw-turn accumulator, rg/VWn/HWn",
    states: [
      { label: "Aggregated gallery", href: "?path=/story/workbench-threads-transcript-specials--inspected-images" },
    ],
  },
  {
    family: "Completed MCP elicitation",
    packet: "L-09",
    evidence: "g4rafana · Pp/Ty/Ey/Dy/g_",
    states: [
      { label: "Permission accepted", href: "?path=/story/workbench-threads-transcript-specials--completed-mcp-elicitation" },
      { label: "Unsupported form hidden", href: "?path=/story/workbench-threads-transcript-specials--unsupported-mcp-elicitation-hidden" },
    ],
  },
] as const satisfies readonly ThreadActivityStoryMatrixRow[];

function StoryStateLinks({ states }: { states: readonly StoryMatrixState[] }) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-1">
      {states.map((state) => (
        <a
          key={state.href}
          href={state.href}
          className="text-xs text-token-text-secondary underline decoration-token-foreground/20 underline-offset-2 hover:text-token-text-primary hover:decoration-token-foreground/50"
        >
          {state.label}
        </a>
      ))}
    </div>
  );
}

function ThreadActivityParityMatrix() {
  return (
    <main className="min-h-screen bg-(--background) p-5 text-(--foreground)">
      <div className="mx-auto max-w-6xl">
        <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-base font-medium">Thread activity parity matrix</h1>
            <p className="mt-1 max-w-3xl text-xs text-token-text-secondary">
              Manual visual index for every completed leaf evidence packet. Each row maps frozen implementation evidence to the Storybook states used for review.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-token-description-foreground">
            <div className="flex items-center gap-2 tabular-nums">
              <span data-parity-provenance="exact-bundle">Exact bundle {EXACT_BUNDLE_PROVENANCE.version} / {EXACT_BUNDLE_PROVENANCE.build}</span>
              <span aria-hidden="true">·</span>
              <span data-parity-runtime="equivalent-version-authorized">Equivalent installed-runtime CDP authorized</span>
            </div>
            <a
              href="?path=/story/workbench-threads-tool-calls--cross-theme-leaf-bodies"
              className="text-token-text-secondary underline decoration-token-foreground/20 underline-offset-2 hover:text-token-text-primary hover:decoration-token-foreground/50"
            >
              Cross-theme leaf canvas
            </a>
          </div>
        </header>

        <div className="overflow-x-auto rounded-lg border-[0.5px] border-token-border bg-token-bg-fog">
          <table className="w-full min-w-[960px] table-fixed border-collapse text-left text-xs">
            <caption className="sr-only">
              Frozen bundle evidence mapped to thread activity Storybook coverage.
            </caption>
            <thead className="text-token-description-foreground">
              <tr className="border-b-[0.5px] border-token-border">
                <th className="w-20 px-3 py-2 font-medium">Packet</th>
                <th className="w-44 px-3 py-2 font-medium">Family</th>
                <th className="w-[360px] px-3 py-2 font-medium">Exact evidence</th>
                <th className="px-3 py-2 font-medium">Story states</th>
              </tr>
            </thead>
            <tbody className="divide-y-[0.5px] divide-token-border">
              {THREAD_ACTIVITY_STORY_MATRIX.map((row) => (
                <tr
                  key={`${row.packet}:${row.family}`}
                  data-evidence-packet={row.packet}
                  data-provenance="exact-bundle"
                  className="align-top"
                >
                  <td className="px-3 py-2 font-medium text-token-text-primary tabular-nums">{row.packet}</td>
                  <td className="px-3 py-2 text-token-text-primary">{row.family}</td>
                  <td className="px-3 py-2 font-mono text-[11px] leading-4 text-token-description-foreground">{row.evidence}</td>
                  <td className="px-3 py-2"><StoryStateLinks states={row.states} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-[11px] leading-4 text-token-description-foreground">
          ASAR SHA-256: <span className="font-mono">{EXACT_BUNDLE_PROVENANCE.asarSha256}</span>. By explicit user direction, installed 26.707.62119 runtime captures are treated as feature-equivalent to the readable 26.707.30751 bundle; the P0 runtime matrix remains open until its capture is complete.
        </p>
      </div>
    </main>
  );
}

const meta = {
  title: "Workbench/Threads/Activity Parity Matrix",
  component: ThreadActivityParityMatrix,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Bundle-provenance index for manual review of the complete thread activity leaf Storybook matrix.",
      },
    },
  },
} satisfies Meta<typeof ThreadActivityParityMatrix>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ExactBundleCoverage: Story = {};
