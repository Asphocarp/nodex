import { act, fireEvent, waitFor } from "@testing-library/react";
import { FileIcon } from "@/components/shared/icons";
import { describe, expect, test } from "vitest";

import {
  BlockDisclosureStateStore,
} from "@/lib/block-disclosure-state";
import {
  ReferenceSurfaceActivationBudget,
} from "@/lib/reference-surface-state";
import { render } from "@/test/dom";
import { OwnedDocumentReferenceSurface } from "./owned-document-reference-surface";

const renderIcon = () => <FileIcon aria-hidden="true" className="size-3.5" />;

describe("OwnedDocumentReferenceSurface", () => {
  test("does not mount the foreign provider surface until local expansion", async () => {
    const disclosureStore = new BlockDisclosureStateStore();
    const activationBudget = new ReferenceSurfaceActivationBudget(1);
    const view = render(
      <OwnedDocumentReferenceSurface
        disclosureKey="host:template-shell"
        ownerBlockId="template-owner"
        icon={renderIcon()}
        label="Document"
        detail="Architecture notes"
        disclosureStore={disclosureStore}
        activationBudget={activationBudget}
        visibilityOverride
        renderDocument={({ ownerBlockId }) => (
          <div data-testid="owned-document-provider">{ownerBlockId}</div>
        )}
      />,
    );

    expect(view.queryByTestId("owned-document-provider") === null).toBe(true);

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: "Expand Document: Architecture notes",
        }),
      );
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(view.getByTestId("owned-document-provider").textContent).toBe(
        "template-owner",
      );
    });

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: "Collapse Document: Architecture notes",
        }),
      );
      await Promise.resolve();
    });
    expect(view.queryByTestId("owned-document-provider") === null).toBe(true);
    expect(activationBudget.getActiveKeys().length).toBe(0);
  });

  test("keeps a cycle-marked owner non-expandable", () => {
    const view = render(
      <OwnedDocumentReferenceSurface
        disclosureKey="recursive-template"
        ownerBlockId="template-owner"
        icon={renderIcon()}
        label="Template"
        detail="Incident review"
        disabledReason="Cycle"
        visibilityOverride
        renderDocument={() => (
          <div data-testid="must-not-mount">Recursive provider</div>
        )}
      />,
    );

    expect(
      (
        view.getByRole("button", {
          name: "Expand Template: Incident review",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(view.getByText("Cycle").textContent).toBe("Cycle");
    expect(view.queryByTestId("must-not-mount") === null).toBe(true);
  });

  test("unmounts an expanded provider as soon as its shell leaves view", async () => {
    const disclosureStore = new BlockDisclosureStateStore();
    const activationBudget = new ReferenceSurfaceActivationBudget(1);
    const makeSurface = (visible: boolean) => (
      <OwnedDocumentReferenceSurface
        disclosureKey="visible-template"
        ownerBlockId="template-owner"
        icon={renderIcon()}
        label="Template"
        detail="Release checklist"
        disclosureStore={disclosureStore}
        activationBudget={activationBudget}
        visibilityOverride={visible}
        renderDocument={() => (
          <div data-testid="visible-provider">Collaborative template</div>
        )}
      />
    );
    const view = render(makeSurface(true));

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: "Expand Template: Release checklist",
        }),
      );
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(view.queryByTestId("visible-provider") === null).toBe(false);
    });

    view.rerender(makeSurface(false));
    expect(view.queryByTestId("visible-provider") === null).toBe(true);
  });
});
