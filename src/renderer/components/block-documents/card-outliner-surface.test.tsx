import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import {
  ReferenceExpansionStore,
  ReferenceSurfaceActivationBudget,
} from "@/lib/reference-surface-state";
import { render } from "@/test/dom";
import {
  CardOutlinerRow,
  useCardOutlinerActivation,
} from "./card-outliner-surface";
import { PortableRichTitle } from "./portable-rich-title";

function ActivationHarness({
  activationKey = "card:block:target",
  title = "Rich title",
  expansionStore,
  activationBudget,
  renderActive,
}: {
  readonly activationKey?: string;
  readonly title?: string;
  readonly expansionStore: ReferenceExpansionStore;
  readonly activationBudget: ReferenceSurfaceActivationBudget;
  readonly renderActive: () => React.ReactNode;
}) {
  const activation = useCardOutlinerActivation({
    activationKey,
    expandable: true,
    expansionStore,
    activationBudget,
    visibilityOverride: true,
  });
  return (
    <CardOutlinerRow
      targetBlockId="target"
      projectId="project"
      plainTitle={title}
      title={<PortableRichTitle value={plainTextToPortableRichText(title)} />}
      expanded={activation.expanded}
      expandable
      active={activation.active}
      sectionRef={activation.sectionRef}
      onExpandedChange={activation.setExpanded}
      onTouch={activation.touch}
    >
      {activation.active ? renderActive() : null}
    </CardOutlinerRow>
  );
}

describe("CardOutlinerRow", () => {
  test("admits target content only while the local row is expanded", async () => {
    const expansionStore = new ReferenceExpansionStore();
    const activationBudget = new ReferenceSurfaceActivationBudget(1);
    const renderActive = vi.fn(() => <div data-testid="target-runtime" />);
    const view = render(
      <ActivationHarness
        expansionStore={expansionStore}
        activationBudget={activationBudget}
        renderActive={renderActive}
      />,
    );

    expect(view.queryByTestId("target-runtime")).toBeNull();
    expect(renderActive).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Expand Rich title" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(view.getByTestId("target-runtime")).toBeTruthy();
      expect(renderActive).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: "Collapse Rich title" }),
      );
      await Promise.resolve();
    });
    expect(view.queryByTestId("target-runtime")).toBeNull();
  });

  test("keeps navigation available when inline expansion is disabled", () => {
    const open = vi.fn();
    const view = render(
      <CardOutlinerRow
        targetBlockId="cycle"
        plainTitle="Cycle Card"
        title="Cycle Card"
        stateLabel="Cycle"
        expanded={false}
        expandable={false}
        active={false}
        onExpandedChange={() => undefined}
        onOpenCard={open}
      />,
    );

    expect(
      (
        view.getByRole("button", {
          name: "Expand Cycle Card",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Open Cycle Card" }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  test("treats duplicate target rows as independent mounted surfaces", async () => {
    const expansionStore = new ReferenceExpansionStore();
    const activationBudget = new ReferenceSurfaceActivationBudget(2);
    const view = render(
      <>
        <ActivationHarness
          title="First instance"
          activationKey="same-semantic-reference"
          expansionStore={expansionStore}
          activationBudget={activationBudget}
          renderActive={() => <div data-testid="duplicate-runtime">First</div>}
        />
        <ActivationHarness
          title="Second instance"
          activationKey="same-semantic-reference"
          expansionStore={expansionStore}
          activationBudget={activationBudget}
          renderActive={() => <div data-testid="duplicate-runtime">Second</div>}
        />
      </>,
    );

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: "Expand First instance" }),
      );
      fireEvent.click(
        view.getByRole("button", { name: "Expand Second instance" }),
      );
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(view.getAllByTestId("duplicate-runtime")).toHaveLength(2);
      expect(activationBudget.getActiveKeys()).toHaveLength(2);
    });
  });

  test("renders portable formatting and title-safe atoms without a provider", () => {
    const view = render(
      <PortableRichTitle
        value={[
          { type: "text", text: "Bold", styles: { bold: true } },
          {
            type: "link",
            text: " link",
            href: "https://nodex.dev",
            styles: {},
          },
          { type: "threadMention", uuid: "thread-123456789" },
        ]}
      />,
    );

    expect(view.getByText("Bold")).toBeTruthy();
    expect(
      view.container
        .querySelector("[data-portable-rich-title-link]")
        ?.getAttribute("data-portable-rich-title-link"),
    ).toBe("https://nodex.dev");
    expect(view.getByText("@thread-1")).toBeTruthy();
  });
});
