export const NODEX_CORE_BACKEND_ENV = "NODEX_CORE_BACKEND";

export function assertRustDataAuthorityEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const configured = environment[NODEX_CORE_BACKEND_ENV]?.trim().toLowerCase();
  if (!configured || configured === "rust") return;
  throw new Error(
    `${NODEX_CORE_BACKEND_ENV}=${configured} is no longer supported; Rust Core is the only production data authority`,
  );
}
