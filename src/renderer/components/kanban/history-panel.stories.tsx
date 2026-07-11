import type { Meta, StoryObj } from "@storybook/react-vite";

import type { CardHistoryEntry } from "../../../shared/card-history";
import { HistoryTimelineDetails } from "./history-panel";

const mutationEntry: Extract<CardHistoryEntry, { kind: "block_mutation" }> = {
  id: "change-log:42",
  kind: "block_mutation",
  projectId: "project-1",
  cardBlockId: "card-1",
  documentId: "document-1",
  occurredAt: "2026-07-12T08:30:00.000Z",
  display: {
    category: "property",
    title: "Changed Card properties",
    detail: "Updated status and priority in the primary Database.",
    actorLabel: "This window",
  },
  evidence: { status: "verified" },
  recovery: { kind: "unavailable", reason: "no_inverse_contract" },
  changeSeq: 42,
  mutationId: "mutation-42",
  mutationKind: "database_mutation",
  affectedBlockCount: 1,
  fieldIntentCount: 2,
};

const incompleteRelocationEntry: Extract<
  CardHistoryEntry,
  { kind: "block_relocation" }
> = {
  id: "change-log:41",
  kind: "block_relocation",
  projectId: "project-1",
  cardBlockId: "card-1",
  documentId: "document-1",
  occurredAt: "2026-07-12T08:00:00.000Z",
  display: {
    category: "location",
    title: "Moved blocks into Card",
    detail: "The durable event survived, but its relocation ledger is unavailable.",
    actorLabel: null,
  },
  evidence: { status: "unavailable", reason: "missing_ledger" },
  recovery: { kind: "unavailable", reason: "insufficient_evidence" },
  changeSeq: 41,
  relocationId: null,
  direction: "into_card",
  movedBlockCount: 3,
};

const meta = {
  title: "Kanban/Card History Evidence",
  component: HistoryTimelineDetails,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-[42rem] max-w-[calc(100vw-2rem)] bg-token-main-surface-primary p-5">
        <Story />
      </div>
    ),
  ],
  args: { entry: mutationEntry },
} satisfies Meta<typeof HistoryTimelineDetails>;

export default meta;

type Story = StoryObj<typeof meta>;

export const VerifiedMutation: Story = {};

export const IncompleteRelocation: Story = {
  args: { entry: incompleteRelocationEntry },
};
