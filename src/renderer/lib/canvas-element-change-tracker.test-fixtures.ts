export const canvasElement = (
  id: string,
  version = 1,
  overrides: Readonly<Record<string, unknown>> = {},
) => ({
  id,
  type: "rectangle",
  index: `a${id.padStart(5, "0")}`,
  version,
  versionNonce: 10,
  isDeleted: false,
  x: Number(id.replace(/\D/gu, "")) || 0,
  ...overrides,
});

export const representativeCanvasElements = (count: number) =>
  Array.from({ length: count }, (_, index) => canvasElement(`element-${index}`));
