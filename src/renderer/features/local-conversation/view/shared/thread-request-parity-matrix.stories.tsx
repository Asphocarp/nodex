import type { Meta, StoryObj } from "@storybook/react-vite";

interface StoryMatrixLink {
  href: string;
  label: string;
}

interface ThreadRequestStoryMatrixRow {
  family: string;
  packet: `Q-${string}`;
  evidence: string;
  direct: readonly StoryMatrixLink[];
  placement: readonly StoryMatrixLink[];
  actions: readonly StoryMatrixLink[];
}

const EXACT_BUNDLE_PROVENANCE = {
  version: "26.707.30751",
  build: "5018",
  asarSha256: "bf6a8d30300c95cd12eb51fc39ea462a3b1bd4719a4ab260b22194340d0b2959",
} as const;

const REQUEST_STORY = "?path=/story/workbench-threads-request-cards--";
const STAGE_STORY = "?path=/story/workbench-threads-stage-screen--";

const THREAD_REQUEST_STORY_MATRIX = [
  {
    family: "Command and file approval",
    packet: "Q-02B",
    evidence: "dKe/YV/aU · composer lt/it/ot",
    direct: [
      { label: "Command approval", href: `${REQUEST_STORY}approval` },
      { label: "File preview", href: `${REQUEST_STORY}file-approval-preview` },
      { label: "Background actor", href: `${REQUEST_STORY}background-approval` },
    ],
    placement: [
      { label: "Active command", href: `${STAGE_STORY}approval-lane` },
      { label: "Active file", href: `${STAGE_STORY}file-approval-lane` },
      { label: "Background + active", href: `${STAGE_STORY}background-activity` },
    ],
    actions: [
      { label: "Allow / decline / feedback", href: `${REQUEST_STORY}approval` },
      { label: "Patch inspection", href: `${REQUEST_STORY}file-approval-preview` },
    ],
  },
  {
    family: "Permission request",
    packet: "Q-01",
    evidence: "bKe/yKe/eV · owner predicate ot",
    direct: [
      { label: "Permission", href: `${REQUEST_STORY}permission-request` },
    ],
    placement: [
      { label: "Active permission", href: `${STAGE_STORY}permission-lane` },
      { label: "Background permission + active option", href: `${STAGE_STORY}background-permission-option` },
    ],
    actions: [
      { label: "Turn / session access", href: `${REQUEST_STORY}permission-request` },
    ],
  },
  {
    family: "Ordinary and onboarding input",
    packet: "Q-02D",
    evidence: "b6/S4/gQe · _Ke onboarding owner",
    direct: [
      { label: "Ordinary input", href: `${REQUEST_STORY}user-input` },
      { label: "Onboarding input", href: `${REQUEST_STORY}onboarding-dynamic-input` },
    ],
    placement: [
      { label: "Active input lane", href: `${STAGE_STORY}user-input-lane` },
      { label: "Onboarding input lane", href: `${STAGE_STORY}onboarding-input-lane` },
    ],
    actions: [
      { label: "Options + freeform", href: `${REQUEST_STORY}user-input` },
      { label: "Forced Something else", href: `${REQUEST_STORY}onboarding-dynamic-input` },
    ],
  },
  {
    family: "MCP elicitation",
    packet: "Q-02B",
    evidence: "Ty/Ey/Dy · pKe/QW/ot",
    direct: [
      { label: "Pending elicitation", href: `${REQUEST_STORY}mcp-server-elicitation` },
    ],
    placement: [
      { label: "Active MCP lane", href: `${STAGE_STORY}mcp-elicitation-lane` },
    ],
    actions: [
      { label: "Continue / skip / cancel", href: `${REQUEST_STORY}mcp-server-elicitation` },
      { label: "Completed transcript", href: "?path=/story/workbench-threads-transcript-specials--completed-mcp-elicitation" },
    ],
  },
  {
    family: "Option picker",
    packet: "Q-02C",
    evidence: "g2/_2 · canonical option response handlers",
    direct: [
      { label: "Option picker", href: `${REQUEST_STORY}option-picker` },
    ],
    placement: [
      { label: "Active option lane", href: `${STAGE_STORY}option-picker-lane` },
      { label: "With background permission", href: `${STAGE_STORY}background-permission-option` },
    ],
    actions: [
      { label: "Select / freeform / skip", href: `${REQUEST_STORY}option-picker` },
    ],
  },
  {
    family: "Setup role / task / context",
    packet: "Q-02E",
    evidence: "o6/f6/K3 · setup request switch",
    direct: [
      { label: "Role", href: `${REQUEST_STORY}setup-role` },
      { label: "First task", href: `${REQUEST_STORY}setup-task` },
      { label: "Context sources", href: `${REQUEST_STORY}setup-context` },
    ],
    placement: [
      { label: "Role lane", href: `${STAGE_STORY}setup-role-lane` },
      { label: "Task lane", href: `${STAGE_STORY}setup-task-lane` },
      { label: "Context lane", href: `${STAGE_STORY}setup-context-lane` },
    ],
    actions: [
      { label: "Role selection", href: `${REQUEST_STORY}setup-role` },
      { label: "Task suggestion", href: `${REQUEST_STORY}setup-task` },
      { label: "Source connection", href: `${REQUEST_STORY}setup-context` },
    ],
  },
  {
    family: "Implement-plan follow-up",
    packet: "Q-02A",
    evidence: "TKe · plan fallback and request key aU",
    direct: [
      { label: "Implement plan", href: `${REQUEST_STORY}implement-plan` },
    ],
    placement: [
      { label: "Completed-turn fallback", href: `${STAGE_STORY}implement-plan` },
    ],
    actions: [
      { label: "Implement / dismiss", href: `${REQUEST_STORY}implement-plan` },
    ],
  },
  {
    family: "Auto-review approval nudge",
    packet: "Q-02F",
    evidence: "manual_approval_threshold=3 · composer ct/lt",
    direct: [
      { label: "Nudge", href: `${REQUEST_STORY}auto-review-approval-nudge` },
    ],
    placement: [
      { label: "Exclusive replacement", href: `${STAGE_STORY}auto-review-nudge` },
    ],
    actions: [
      { label: "Keep manual / approve for me", href: `${REQUEST_STORY}auto-review-approval-nudge` },
    ],
  },
  {
    family: "Replacement priority and coexistence",
    packet: "Q-02F",
    evidence: "ct exclusive · !ct && it before !ct && ot",
    direct: [
      { label: "Background approval", href: `${REQUEST_STORY}background-approval` },
      { label: "Nudge", href: `${REQUEST_STORY}auto-review-approval-nudge` },
    ],
    placement: [
      { label: "Background before active", href: `${STAGE_STORY}background-activity` },
      { label: "Permission before option", href: `${STAGE_STORY}background-permission-option` },
      { label: "Nudge suppresses request stack", href: `${STAGE_STORY}auto-review-nudge` },
    ],
    actions: [
      { label: "Active request", href: `${STAGE_STORY}approval-lane` },
      { label: "Request stack", href: `${STAGE_STORY}background-activity` },
    ],
  },
] as const satisfies readonly ThreadRequestStoryMatrixRow[];

function StoryLinks({ links }: { links: readonly StoryMatrixLink[] }) {
  if (links.length === 0) {
    return <span className="text-token-description-foreground">Not indexed</span>;
  }

  return (
    <div className="flex flex-wrap gap-x-2 gap-y-1">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="text-xs text-token-text-secondary underline decoration-token-foreground/20 underline-offset-2 hover:text-token-text-primary hover:decoration-token-foreground/50"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}

function ThreadRequestParityMatrix() {
  return (
    <main className="min-h-screen bg-(--background) p-5 text-(--foreground)">
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-base font-medium">Thread request parity matrix</h1>
            <p className="mt-1 max-w-3xl text-xs text-token-text-secondary">
              Manual review index for pending request surfaces, their canonical composer placement, and response actions.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-token-description-foreground">
            <span data-parity-provenance="exact-bundle">Exact bundle {EXACT_BUNDLE_PROVENANCE.version} / {EXACT_BUNDLE_PROVENANCE.build}</span>
            <span aria-hidden="true">·</span>
            <span data-parity-runtime="pending">Runtime visual sign-off pending E-05</span>
          </div>
        </header>

        <div className="overflow-x-auto rounded-lg border-[0.5px] border-token-border bg-token-bg-fog">
          <table className="w-full min-w-[1240px] table-fixed border-collapse text-left text-xs">
            <caption className="sr-only">
              Frozen bundle evidence mapped to direct request surfaces, production placement, and action coverage.
            </caption>
            <thead className="text-token-description-foreground">
              <tr className="border-b-[0.5px] border-token-border">
                <th className="w-20 px-3 py-2 font-medium">Packet</th>
                <th className="w-52 px-3 py-2 font-medium">Family</th>
                <th className="w-[290px] px-3 py-2 font-medium">Exact evidence</th>
                <th className="w-56 px-3 py-2 font-medium">Direct surface</th>
                <th className="w-60 px-3 py-2 font-medium">Production placement</th>
                <th className="px-3 py-2 font-medium">Action / state proof</th>
              </tr>
            </thead>
            <tbody className="divide-y-[0.5px] divide-token-border">
              {THREAD_REQUEST_STORY_MATRIX.map((row) => (
                <tr
                  key={`${row.packet}:${row.family}`}
                  data-evidence-packet={row.packet}
                  data-provenance="exact-bundle"
                  className="align-top"
                >
                  <td className="px-3 py-2 font-medium text-token-text-primary tabular-nums">{row.packet}</td>
                  <td className="px-3 py-2 text-token-text-primary">{row.family}</td>
                  <td className="px-3 py-2 font-mono text-[11px] leading-4 text-token-description-foreground">{row.evidence}</td>
                  <td className="px-3 py-2"><StoryLinks links={row.direct} /></td>
                  <td className="px-3 py-2"><StoryLinks links={row.placement} /></td>
                  <td className="px-3 py-2"><StoryLinks links={row.actions} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-[11px] leading-4 text-token-description-foreground">
          ASAR SHA-256: <span className="font-mono">{EXACT_BUNDLE_PROVENANCE.asarSha256}</span>. Bundle provenance is frozen; exact runtime visual sign-off remains pending until E-05 can capture the target build.
        </p>
      </div>
    </main>
  );
}

const meta = {
  title: "Workbench/Threads/Request Parity Matrix",
  component: ThreadRequestParityMatrix,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Bundle-provenance index for manual review of direct request surfaces, composer placement, and response-state coverage.",
      },
    },
  },
} satisfies Meta<typeof ThreadRequestParityMatrix>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ExactBundleCoverage: Story = {};
