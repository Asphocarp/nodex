import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  PAGE_DOCUMENT_SCHEMA_KEY,
  PAGE_DOCUMENT_SCHEMA_VERSION,
  SYNCED_BLOCK_DOCUMENT_SCHEMA_KEY,
  SYNCED_BLOCK_DOCUMENT_SCHEMA_VERSION,
  SYNCED_BLOCK_SOURCE_TYPE,
  type OwnedDocumentDescriptor,
} from "../../../shared/block-documents";
import { render } from "@/test/dom";
import { TestQueryProvider } from "@/test/query";
import {
  OwnedBlockDocumentBoundary,
  RegisteredOwnedBlockDocumentBoundary,
} from "./owned-block-document-boundary";

const descriptor = (): OwnedDocumentDescriptor => ({
  projectId: "project-1",
  ownerBlockId: "card-1",
  ownerType: "page",
  ownerLifecycle: "active",
  documentId: "document:card-1",
  storeEpoch: "store-1",
  generation: 1,
  headSeq: 0,
  schemaKey: PAGE_DOCUMENT_SCHEMA_KEY,
  schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION,
  readiness: "ready",
  sync: { kind: "yjs", stateVector: new Uint8Array([0]) },
});

describe("OwnedBlockDocumentBoundary", () => {
  test("renders the explicit authority model and can prepare it again after reload", async () => {
    let fetches = 0;
    const fetchDescriptor = async () => {
      fetches += 1;
      return descriptor();
    };
    const view = render(
      <TestQueryProvider>
        <OwnedBlockDocumentBoundary
          projectId="project-1"
          ownerBlockId="card-1"
          dependencies={{ fetchDescriptor }}
        >
          {(model, controls) => (
            <div>
              <span data-testid="authority">{model.status}</span>
              <button type="button" onClick={() => void controls.reload()}>
                Reload descriptor
              </button>
            </div>
          )}
        </OwnedBlockDocumentBoundary>
      </TestQueryProvider>,
    );

    await waitFor(() => {
      expect(view.getByTestId("authority").textContent).toBe("ready");
    });
    expect(fetches).toBe(1);

    fireEvent.click(view.getByRole("button", { name: "Reload descriptor" }));
    await waitFor(() => expect(fetches).toBe(2));
    expect(view.getByTestId("authority").textContent).toBe("ready");
  });

  test("opens a registered non-Page document-bearing Block descriptor", async () => {
    const view = render(
      <TestQueryProvider>
        <RegisteredOwnedBlockDocumentBoundary
          projectId="project-1"
          ownerBlockId="synced-source-1"
          dependencies={{
            fetchDescriptor: async () => ({
              ...descriptor(),
              ownerBlockId: "synced-source-1",
              ownerType: SYNCED_BLOCK_SOURCE_TYPE,
              documentId: "document:synced-source-1",
              schemaKey: SYNCED_BLOCK_DOCUMENT_SCHEMA_KEY,
              schemaVersion: SYNCED_BLOCK_DOCUMENT_SCHEMA_VERSION,
            }),
          }}
        >
          {(model) => <span data-testid="authority">{model.status}</span>}
        </RegisteredOwnedBlockDocumentBoundary>
      </TestQueryProvider>,
    );

    await waitFor(() => {
      expect(view.getByTestId("authority").textContent).toBe("ready");
    });
  });
});
