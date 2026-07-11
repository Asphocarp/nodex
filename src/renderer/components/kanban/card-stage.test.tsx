import { beforeEach, describe, expect, mock, test } from "bun:test";
import { act } from "@testing-library/react";
import { render, textContent } from "../../test/dom";
import type { Card, CardUpdateMutationResult } from "@/lib/types";
import {
  writeCardStageContentWidthPreference,
  writeCardStageShowRawContentPreference,
} from "@/lib/card-stage-layout";
import { NodexTooltipProvider } from "@/components/ui/tooltip";

let lastNfmEditorProps: Record<string, unknown> | null = null;
let nfmEditorRenderCount = 0;

mock.module("./editor/nfm-editor", () => ({
  NfmEditor: (props: Record<string, unknown>) => {
    nfmEditorRenderCount += 1;
    lastNfmEditorProps = props;
    return <div>Mock editor</div>;
  },
}));

mock.module("./card-stage/inline-property-strip", () => ({
  CardStageInlinePropertyStrip: () => <div>Inline property strip</div>,
}));

mock.module("./card-stage/properties-section", () => ({
  CardStagePropertiesSection: () => <div>Properties section</div>,
}));

function buildCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    status: "in_progress",
    archived: false,
    title: "Task",
    description: "# Raw card\n\n- item",
    tags: [],
    agentBlocked: false,
    created: new Date("2026-01-01T00:00:00.000Z"),
    order: 1,
    ...overrides,
  };
}

function buildUpdateAck(card: Card = buildCard({ revision: 2 })): CardUpdateMutationResult {
  const { description, ...summary } = card;
  return {
    status: "updated",
    projectId: "default",
    cardId: card.id,
    revision: card.revision ?? 2,
    summary: {
      ...summary,
      descriptionPreview: description,
      descriptionLength: description.length,
      hasDescription: description.trim().length > 0,
    },
    changedFields: [],
    didMutate: true,
  };
}

describe("card stage", () => {
  beforeEach(() => {
    localStorage.clear();
    lastNfmEditorProps = null;
    nfmEditorRenderCount = 0;
  });

  test("renders the rich editor when raw mode is disabled", async () => {
    writeCardStageContentWidthPreference(true);
    writeCardStageShowRawContentPreference(false);
    const { CardStage, CARD_STAGE_SCROLL_CONTAINER_TEST_ID } = await import("./card-stage");
    const onOpenCard = () => undefined;
    const { container, getByText, queryByText } = render(
      <NodexTooltipProvider>
        <CardStage
          onClose={() => undefined}
          card={buildCard()}
          columnId="in_progress"
          columnName="In progress"
          projectId="default"
          projectName="Default"
          documentAuthority={{ kind: "legacy_shadow" }}
          availableTags={[]}
          sessionId="session-current"
          canStartThreadInSession
          onOpenCard={onOpenCard}
          onUpdate={async () => buildUpdateAck()}
          onPatch={() => undefined}
          onDelete={async () => undefined}
          onMove={async () => undefined}
        />
      </NodexTooltipProvider>,
    );

    expect(getByText("Mock editor").textContent).toBe("Mock editor");
    expect(queryByText("Raw format")).toBe(null);
    const scrollContainer = container.querySelector(`[data-testid="${CARD_STAGE_SCROLL_CONTAINER_TEST_ID}"]`) as HTMLElement | null;
    expect(scrollContainer).not.toBeNull();
    expect(scrollContainer?.style.getPropertyValue("overflow-anchor")).toBe("none");
    const body = container.querySelector('[data-card-stage-body="true"]');
    expect(body).not.toBeNull();
    expect(body?.getAttribute("data-card-stage-body-width")).toBe("constrained");
    expect(body?.className.includes("max-w-(--card-stage-body-max-width)")).toBeTrue();
    const editorProps = lastNfmEditorProps as {
      source?: { flushHandleRef?: unknown };
      projectName?: unknown;
      sessionId?: unknown;
      canStartThreadInSession?: unknown;
      onOpenCard?: unknown;
      headingRail?: {
        portalElement?: unknown;
        scrollContainerRef?: unknown;
      };
    } | null;
    expect(typeof editorProps?.source?.flushHandleRef).toBe("object");
    expect(editorProps?.projectName).toBe("Default");
    expect(editorProps?.sessionId).toBe("session-current");
    expect(editorProps?.canStartThreadInSession).toBe(true);
    expect(editorProps?.onOpenCard).toBe(onOpenCard);
    expect(typeof editorProps?.headingRail?.portalElement).toBe("object");
    expect(typeof editorProps?.headingRail?.scrollContainerRef).toBe("object");
    expect(container.querySelector('[data-card-stage-heading-navigation-portal-target="true"]')).not.toBeNull();
  });

  test("full width expands the body lane without changing the card-stage surface", async () => {
    writeCardStageContentWidthPreference(true);
    writeCardStageShowRawContentPreference(false);
    const { CardStage } = await import("./card-stage");
    const { container, getByRole } = render(
      <NodexTooltipProvider>
        <CardStage
          onClose={() => undefined}
          card={buildCard()}
          columnId="in_progress"
          columnName="In progress"
          projectId="default"
          documentAuthority={{ kind: "legacy_shadow" }}
          availableTags={[]}
          onUpdate={async () => buildUpdateAck()}
          onPatch={() => undefined}
          onDelete={async () => undefined}
          onMove={async () => undefined}
        />
      </NodexTooltipProvider>,
    );

    const surface = container.querySelector('[data-card-stage-surface="true"]');
    const body = container.querySelector('[data-card-stage-body="true"]');
    const fullWidthButton = getByRole("button", { name: "Full width" });

    expect(surface).not.toBeNull();
    expect(surface?.className.includes("w-full")).toBeTrue();
    expect(body?.getAttribute("data-card-stage-body-width")).toBe("constrained");
    expect(fullWidthButton.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      (fullWidthButton as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(surface?.className.includes("w-full")).toBeTrue();
    expect(body?.getAttribute("data-card-stage-body-width")).toBe("full");
    expect(body?.className.includes("max-w-(--card-stage-body-max-width)")).toBeFalse();
    expect(fullWidthButton.getAttribute("aria-pressed")).toBe("true");
  });

  test("renders read-only raw content when raw mode is enabled", async () => {
    writeCardStageShowRawContentPreference(true);
    const { CardStage } = await import("./card-stage");
    const { container, getByText, queryByText } = render(
      <NodexTooltipProvider>
        <CardStage
          onClose={() => undefined}
          card={buildCard()}
          columnId="in_progress"
          columnName="In progress"
          projectId="default"
          documentAuthority={{ kind: "legacy_shadow" }}
          availableTags={[]}
          onUpdate={async () => buildUpdateAck()}
          onPatch={() => undefined}
          onDelete={async () => undefined}
          onMove={async () => undefined}
        />
      </NodexTooltipProvider>,
    );

    expect(getByText("Raw format").textContent).toBe("Raw format");
    expect(getByText("Read-only").textContent).toBe("Read-only");
    expect(queryByText("Mock editor")).toBe(null);
    expect(textContent(container).includes("# Raw card")).toBeTrue();
  });

  test("does not rerender the rich editor when only saving state changes", async () => {
    writeCardStageShowRawContentPreference(false);
    const { CardStage } = await import("./card-stage");
    let resolveUpdate: ((value: CardUpdateMutationResult) => void) | null = null;
    const view = render(
      <NodexTooltipProvider>
        <CardStage
          onClose={() => undefined}
          card={buildCard()}
          columnId="in_progress"
          columnName="In progress"
          projectId="default"
          documentAuthority={{ kind: "legacy_shadow" }}
          availableTags={[]}
          onUpdate={async () => new Promise<CardUpdateMutationResult>((resolve) => {
            resolveUpdate = resolve;
          })}
          onPatch={() => undefined}
          onDelete={async () => undefined}
          onMove={async () => undefined}
        />
      </NodexTooltipProvider>,
    );

    const editorSource = lastNfmEditorProps?.source as {
      onChange?: (value: string) => void;
      onBlur?: () => void;
    } | undefined;
    const onChange = editorSource?.onChange;
    const onBlur = editorSource?.onBlur;
    expect(typeof onChange).toBe("function");
    expect(typeof onBlur).toBe("function");
    const renderCountAfterMount = nfmEditorRenderCount;
    expect(renderCountAfterMount > 0).toBeTrue();

    await act(async () => {
      onChange?.("Updated body");
      await Promise.resolve();
    });
    const renderCountAfterContentChange = nfmEditorRenderCount;

    await act(async () => {
      onBlur?.();
      await Promise.resolve();
    });

    expect(view.getByText("Saving...").textContent).toBe("Saving...");
    expect(nfmEditorRenderCount).toBe(renderCountAfterContentChange);

    await act(async () => {
      resolveUpdate?.(buildUpdateAck(buildCard({ description: "Updated body", revision: 2 })));
      await Promise.resolve();
    });
    view.unmount();
  });
});
