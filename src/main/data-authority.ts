export const NODEX_CORE_BACKEND_ENV = "NODEX_CORE_BACKEND";

export type DataAuthorityBackend = "typescript" | "rust";

export interface DataAuthoritySelection {
  readonly get: () => DataAuthorityBackend | null;
  readonly select: (environment?: NodeJS.ProcessEnv) => DataAuthorityBackend;
}

export function resolveDataAuthorityBackend(
  environment: NodeJS.ProcessEnv = process.env,
): DataAuthorityBackend {
  const configured = environment[NODEX_CORE_BACKEND_ENV]?.trim().toLowerCase();
  if (!configured || configured === "typescript") return "typescript";
  if (configured === "rust") return "rust";
  throw new Error(
    `${NODEX_CORE_BACKEND_ENV} must be either "typescript" or "rust"`,
  );
}

export function createDataAuthoritySelection(): DataAuthoritySelection {
  let selected: DataAuthorityBackend | null = null;
  return {
    get: () => selected,
    select: (environment = process.env) => {
      const requested = resolveDataAuthorityBackend(environment);
      if (selected === null) {
        selected = requested;
        return selected;
      }
      if (selected === requested) return selected;
      throw new Error(
        `Nodex cannot switch its data authority from ${selected} to ${requested} at runtime`,
      );
    },
  };
}

const processSelection = createDataAuthoritySelection();

export const selectDataAuthorityBackend = (
  environment: NodeJS.ProcessEnv = process.env,
): DataAuthorityBackend => processSelection.select(environment);

export const getSelectedDataAuthorityBackend = (): DataAuthorityBackend | null =>
  processSelection.get();

export function requireTypeScriptDataAuthority(): void {
  const selected = selectDataAuthorityBackend();
  if (selected === "typescript") return;
  throw new Error(
    "The TypeScript SQLite authority is disabled because native Rust Core owns this Profile",
  );
}
