import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, textContent } from "../../test/dom";
import type { Card } from "@/lib/types";
import { writeCardStageShowRawContentPreference } from "@/lib/card-stage-layout";
import { NodexTooltipProvider } from "@/components/ui/tooltip";

let lastNfmEditorProps: Record<string, unknown> | null = null;

mock.module("./editor/nfm-editor", () => ({
  NfmEditor: (props: Record<string, unknown>) => {
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

describe("card stage", () => {
  beforeEach(() => {
    localStorage.clear();
    lastNfmEditorProps = null;
  });

  test("renders the rich editor when raw mode is disabled", async () => {
    writeCardStageShowRawContentPreference(false);
    const { CardStage, CARD_STAGE_SCROLL_CONTAINER_TEST_ID } = await import("./card-stage");
    const { container, getByText, queryByText } = render(
      <NodexTooltipProvider>
        <CardStage
          onClose={() => undefined}
          card={buildCard()}
          columnId="in_progress"
          columnName="In progress"
          projectId="default"
          availableTags={[]}
          onUpdate={async () => ({ status: "updated", card: {} as never })}
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
    const editorProps = lastNfmEditorProps as { flushHandleRef?: unknown } | null;
    expect(typeof editorProps?.flushHandleRef).toBe("object");
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
          availableTags={[]}
          onUpdate={async () => ({ status: "updated", card: {} as never })}
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
});
