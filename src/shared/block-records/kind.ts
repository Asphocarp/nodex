import type { BlockRecordKind } from "./contracts";

/** Canonical Core spelling for a BlockNote/editor block type. */
export const blockKindToCore = (value: string): string => {
  switch (value) {
    case "listItem":
    case "list_item":
      return "list_item";
    case "toggleListItem":
      return "toggle";
    case "codeBlock":
      return "code";
    case "image":
    case "file":
    case "video":
    case "audio":
      return "media";
    default:
      return value;
  }
};

/** Editor spelling for the canonical Core BlockRecord kind. */
export const blockKindFromCore = (
  value: BlockRecordKind,
  properties?: Readonly<Record<string, unknown>>,
): string => {
  switch (value) {
    case "list_item":
      return "listItem";
    case "toggle":
      return "toggleListItem";
    case "code":
      return "codeBlock";
    case "media": {
      const legacyType = properties?.legacyType;
      return typeof legacyType === "string" && legacyType.trim()
        ? legacyType
        : "image";
    }
    default:
      return value;
  }
};
