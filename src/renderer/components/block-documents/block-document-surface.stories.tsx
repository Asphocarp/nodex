import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  CARD_DOCUMENT_SCHEMA_KEY,
  CARD_DOCUMENT_SCHEMA_VERSION,
  type DocumentSyncCommandError,
} from "../../../shared/block-documents";
import { BlockDocumentSurfaceError } from "@/lib/block-document-surface-failure";
import {
  BlockDocumentSurfaceFailureState,
  type PrimaryCardBlockDocumentDescriptor,
} from "./block-document-surface";

const descriptor: PrimaryCardBlockDocumentDescriptor = {
  projectId: "project:launch",
  ownerBlockId: "card:sync-design",
  ownerType: "card",
  ownerLifecycle: "active",
  documentId: "document:sync-design",
  storeEpoch: "store:local",
  generation: 4,
  headSeq: 27,
  schemaKey: CARD_DOCUMENT_SCHEMA_KEY,
  schemaVersion: CARD_DOCUMENT_SCHEMA_VERSION,
  readiness: "ready",
  sync: { kind: "yjs", stateVector: new Uint8Array([0]) },
};

const makeFailure = (
  syncError: DocumentSyncCommandError,
): BlockDocumentSurfaceError =>
  new BlockDocumentSurfaceError(syncError.message, { syncError });

function SurfaceFailureStory({ resetRequired = false }) {
  const error = resetRequired
    ? makeFailure({
        code: "document_generation_mismatch",
        message: "The Card changed while this editor was opening.",
        retryable: false,
        resetRequired: true,
      })
    : makeFailure({
        code: "document_state_corrupt",
        message: "The collaborative body is missing its registered root.",
        retryable: false,
        resetRequired: false,
        recoveryArtifactId: "recovery:018f2",
      });

  return (
    <div className="min-h-screen bg-token-main-surface-primary px-10 py-16">
      <div className="mx-auto w-full max-w-(--card-stage-body-max-width)">
        <BlockDocumentSurfaceFailureState
          descriptor={descriptor}
          error={error}
          reason={resetRequired ? "reset-required" : "fatal"}
          reloading={false}
          reload={async () => undefined}
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Card Stage/Document Surface Failure",
  component: SurfaceFailureStory,
  parameters: { layout: "fullscreen" },
  render: () => <SurfaceFailureStory />,
} satisfies Meta<typeof SurfaceFailureStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const InvalidContent: Story = {};

export const ResyncRequired: Story = {
  render: () => <SurfaceFailureStory resetRequired />,
};
