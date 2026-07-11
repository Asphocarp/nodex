import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test } from "bun:test";
import {
  CARD_DOCUMENT_SCHEMA_KEY,
  CARD_DOCUMENT_SCHEMA_VERSION,
  type OwnedBlockDocumentDescriptor,
} from "../../../shared/block-documents";
import { render } from "@/test/dom";
import { TestQueryProvider } from "@/test/query";
import { OwnedBlockDocumentBoundary } from "./owned-block-document-boundary";

const descriptor = (): OwnedBlockDocumentDescriptor => ({
  projectId: "project-1",
  ownerBlockId: "card-1",
  ownerType: "card",
  ownerLifecycle: "active",
  documentId: "document:card-1",
  storeEpoch: "store-1",
  generation: 1,
  headSeq: 0,
  schemaKey: CARD_DOCUMENT_SCHEMA_KEY,
  schemaVersion: CARD_DOCUMENT_SCHEMA_VERSION,
  readiness: "ready",
  authority: "ydoc_primary",
  stateVector: new Uint8Array([0]),
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
      expect(view.getByTestId("authority").textContent).toBe("ydoc_primary");
    });
    expect(fetches).toBe(1);

    fireEvent.click(view.getByRole("button", { name: "Reload descriptor" }));
    await waitFor(() => expect(fetches).toBe(2));
    expect(view.getByTestId("authority").textContent).toBe("ydoc_primary");
  });
});
