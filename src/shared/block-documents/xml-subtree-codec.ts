import * as Y from "yjs";

export type PortableXmlValue =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | readonly PortableXmlValue[]
  | { readonly [key: string]: PortableXmlValue };

export interface PortableXmlTextDelta {
  readonly insert: string;
  readonly attributes?: Readonly<Record<string, PortableXmlValue>>;
}

export type PortableXmlSubtree =
  | {
      readonly kind: "element";
      readonly nodeName: string;
      readonly attributes: Readonly<Record<string, PortableXmlValue>>;
      readonly children: readonly PortableXmlSubtree[];
    }
  | {
      readonly kind: "text";
      readonly delta: readonly PortableXmlTextDelta[];
    };

export type XmlSubtreeParent = Y.XmlFragment | Y.XmlElement;
export type SupportedXmlNode = Y.XmlElement | Y.XmlText;

interface YXmlTextOperation {
  readonly insert: unknown;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export class UnsupportedXmlNodeError extends TypeError {
  constructor(node: unknown) {
    const nodeType =
      typeof node === "object" && node !== null
        ? node.constructor.name
        : typeof node;
    super(`Unsupported Y.Xml subtree node: ${nodeType}`);
    this.name = "UnsupportedXmlNodeError";
  }
}

const clonePortableValue = (
  value: unknown,
  ancestors = new Set<object>(),
): PortableXmlValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Portable Y.Xml values must contain finite numbers");
    }
    return value;
  }

  if (value instanceof Uint8Array) {
    return value.slice();
  }

  if (value instanceof Y.AbstractType) {
    throw new TypeError("Nested Yjs shared types are not portable XML values");
  }

  if (typeof value !== "object") {
    throw new TypeError(`Unsupported portable Y.Xml value: ${typeof value}`);
  }

  if (ancestors.has(value)) {
    throw new TypeError("Portable Y.Xml values must not contain cycles");
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => clonePortableValue(entry, nextAncestors));
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(
      `Unsupported portable Y.Xml object: ${value.constructor.name}`,
    );
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      clonePortableValue(entry, nextAncestors),
    ]),
  );
};

const cloneAttributeRecord = (
  attributes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, PortableXmlValue>> =>
  Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      clonePortableValue(value),
    ]),
  );

export const assertPortableXmlAttributes = (
  attributes: Readonly<Record<string, unknown>>,
): void => {
  cloneAttributeRecord(attributes);
};

export const encodeXmlSubtree = (node: unknown): PortableXmlSubtree => {
  if (node instanceof Y.XmlText) {
    const sourceDelta = node.toDelta() as readonly YXmlTextOperation[];
    const delta = sourceDelta.map((operation): PortableXmlTextDelta => {
      if (typeof operation.insert !== "string") {
        throw new TypeError("Y.XmlText embeds are not supported by the subtree codec");
      }

      const attributes = operation.attributes
        ? cloneAttributeRecord(operation.attributes)
        : undefined;
      return attributes
        ? { insert: operation.insert, attributes }
        : { insert: operation.insert };
    });
    return { kind: "text", delta };
  }

  if (!(node instanceof Y.XmlElement)) {
    throw new UnsupportedXmlNodeError(node);
  }

  if (node.nodeName.trim().length === 0) {
    throw new TypeError("Portable Y.Xml elements must have a nodeName");
  }

  return {
    kind: "element",
    nodeName: node.nodeName,
    attributes: cloneAttributeRecord(node.getAttributes()),
    children: node.toArray().map((child) => encodeXmlSubtree(child)),
  };
};

const setPortableAttribute = (
  element: Y.XmlElement,
  key: string,
  value: PortableXmlValue,
): void => {
  // Yjs' default XmlElement generic narrows attributes to string even though
  // its runtime contract supports JSON-like values and Uint8Array.
  element.setAttribute(key, value as unknown as string);
};

export const decodeXmlSubtree = (
  subtree: PortableXmlSubtree,
): SupportedXmlNode => {
  if (subtree.kind === "text") {
    const text = new Y.XmlText();
    text.applyDelta(
      subtree.delta.map((operation) => ({
        insert: operation.insert,
        ...(operation.attributes
          ? { attributes: cloneAttributeRecord(operation.attributes) }
          : {}),
      })),
    );
    return text;
  }

  if (subtree.nodeName.trim().length === 0) {
    throw new TypeError("Portable Y.Xml elements must have a nodeName");
  }

  const element = new Y.XmlElement(subtree.nodeName);
  Object.entries(subtree.attributes).forEach(([key, value]) => {
    setPortableAttribute(element, key, clonePortableValue(value));
  });
  element.insert(0, subtree.children.map(decodeXmlSubtree));
  return element;
};

export const cloneXmlSubtree = (node: unknown): SupportedXmlNode =>
  decodeXmlSubtree(encodeXmlSubtree(node));

const assertCaptureIndex = (parent: XmlSubtreeParent, index: number): void => {
  if (Number.isInteger(index) && index >= 0 && index < parent.length) {
    return;
  }

  throw new RangeError(
    `Y.Xml subtree index ${index} is outside parent length ${parent.length}`,
  );
};

const assertInsertIndex = (parent: XmlSubtreeParent, index: number): void => {
  if (Number.isInteger(index) && index >= 0 && index <= parent.length) {
    return;
  }

  throw new RangeError(
    `Y.Xml insertion index ${index} is outside parent length ${parent.length}`,
  );
};

export const captureXmlSubtreeAt = (
  parent: XmlSubtreeParent,
  index: number,
): PortableXmlSubtree => {
  assertCaptureIndex(parent, index);
  return encodeXmlSubtree(parent.toArray()[index]);
};

export const insertPortableXmlSubtree = (
  parent: XmlSubtreeParent,
  index: number,
  subtree: PortableXmlSubtree,
): SupportedXmlNode => {
  assertInsertIndex(parent, index);
  const node = decodeXmlSubtree(subtree);
  parent.insert(index, [node]);
  return node;
};

export const deleteXmlSubtreeAt = (
  parent: XmlSubtreeParent,
  index: number,
): void => {
  assertCaptureIndex(parent, index);
  parent.delete(index, 1);
};
