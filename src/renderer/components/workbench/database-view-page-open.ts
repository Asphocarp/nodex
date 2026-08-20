export type DatabaseViewPageOpenMode = "preview" | "durable";

export type DatabaseViewPageOpenHandler = (
  pageId: string,
  titleSnapshot: string,
  openMode: DatabaseViewPageOpenMode,
) => void;
