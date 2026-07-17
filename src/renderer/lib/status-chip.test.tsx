import { describe, expect, test } from "vitest";
import {
  StatusChip,
  StatusIcon,
  createStatusIconElement,
  getStatusAccentColorByLabel,
  getStatusIdByLabel,
} from "./status-chip";
import { render } from "../test/dom";

type MockSvgNode = {
  namespaceURI: string | null;
  tagName: string;
  style: Record<string, string>;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  appendChild: (child: MockSvgNode) => MockSvgNode;
  querySelectorAll: (selector: string) => MockSvgNode[];
};

function createMockDocument(): Document {
  const createNode = (tagName: string, namespaceURI: string | null): MockSvgNode => {
    const attributes = new Map<string, string>();
    const children: MockSvgNode[] = [];

    return {
      namespaceURI,
      style: {},
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
      },
      getAttribute(name: string) {
        return attributes.get(name) ?? null;
      },
      appendChild(child: ReturnType<typeof createNode>) {
        children.push(child);
        return child;
      },
      querySelectorAll(selector: string) {
        return children.filter((child) => child.tagName === selector);
      },
      tagName,
    };
  };

  return {
    createElementNS(namespaceURI: string, qualifiedName: string) {
      return createNode(qualifiedName, namespaceURI);
    },
  } as unknown as Document;
}

describe("status chip", () => {
  test("renders the shared in-review chip with an icon and label", () => {
    const { container, getByText } = render(<StatusChip statusId="review" />);

    expect(getByText("Review").textContent).toBe("Review");
    expect(container.querySelector("svg")).not.toBeNull();
  });

  test("renders the triage icon as decorative svg markup", () => {
    const { container } = render(<StatusIcon statusId="triage" />);
    const icon = container.querySelector("svg");

    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("path")).not.toBeNull();
  });

  test("creates a DOM icon element for editor-rendered status chips", () => {
    const icon = createStatusIconElement("ship", {
      documentRef: createMockDocument(),
    });

    expect(icon.getAttribute("viewBox")).toBe("0 0 20 20");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.querySelectorAll("path").length).toBe(2);
  });

  test("maps status labels back to shared status metadata", () => {
    expect(getStatusIdByLabel("Plan")).toBe("plan");
    expect(getStatusAccentColorByLabel("Ship")).toBe("var(--status-ship-dot)");
  });
});
