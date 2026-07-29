import { createRef } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { IntelligenceSelectorTrigger } from "./intelligence-selector-trigger";
import "../../../../globals.css";

describe("IntelligenceSelectorTrigger layout", () => {
  test("measures every label candidate without adding scrollable height", async () => {
    const view = render(
      <div
        className="relative h-7 w-80 overflow-y-auto"
        data-testid="composer-control-row"
      >
        <IntelligenceSelectorTrigger
          geometry={{
            alignOffset: undefined,
            expandedContentWidth: undefined,
            measurementRef: createRef<HTMLSpanElement>(),
            triggerRef: createRef<HTMLButtonElement>(),
            wrapperRef: createRef<HTMLSpanElement>(),
          }}
          isOpen={false}
          labelCandidates={[
            {
              id: "openai:gpt-5.6-sol:low",
              modelLabel: "GPT-5.6-Sol",
              reasoningLabel: "Low",
            },
            {
              id: "openai:gpt-5.6-sol:xhigh",
              modelLabel: "GPT-5.6-Sol",
              reasoningLabel: "Extra High",
            },
            {
              id: "anthropic:claude-opus:high",
              modelLabel: "Claude Opus",
              reasoningLabel: "High",
            },
          ]}
          modelLabel="GPT-5.6-Sol"
          reasoningLabel="Extra High"
          showFastIndicator={false}
          title="OpenAI · GPT-5.6-Sol · Extra High"
        />
      </div>,
    );

    await waitFor(() => {
      const measurement = view.container.querySelector<HTMLElement>(
        "[data-intelligence-selector-label-measurement=true]",
      );
      if (!measurement) {
        throw new Error("Expected the intelligence selector measurement stack.");
      }

      const candidates = Array.from(
        measurement.children,
      ).filter((candidate): candidate is HTMLElement => candidate instanceof HTMLElement);
      const candidateWidths = candidates.map(
        (candidate) => candidate.getBoundingClientRect().width,
      );
      const candidateHeights = candidates.map(
        (candidate) => candidate.getBoundingClientRect().height,
      );
      const controlRow = view.getByTestId("composer-control-row");
      const trigger = view.getByRole("button", { name: "Select model" });

      expect(candidates).toHaveLength(3);
      expect(measurement.getBoundingClientRect().width).toBeCloseTo(
        Math.max(...candidateWidths),
        1,
      );
      expect(measurement.clientHeight).toBe(Math.max(...candidateHeights));
      expect(measurement.scrollHeight).toBe(measurement.clientHeight);
      expect(trigger.scrollHeight).toBeLessThanOrEqual(trigger.clientHeight);
      expect(controlRow.scrollHeight).toBe(controlRow.clientHeight);
    });
  });
});
