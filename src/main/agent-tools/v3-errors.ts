import type { ToolFailure } from "../../shared/nodex-agent-tools";

export function publicV3Failure(error: ToolFailure["error"]): ToolFailure["error"] {
  const code = error.code === "invalid_nfm"
    ? "invalid_arguments"
    : error.code === "nfm_patch_mismatch" || error.code === "nfm_patch_overlap"
      ? "conflict"
      : error.code;
  return {
    ...error,
    code,
    recovery: error.recovery === "get_block_again" ? "fetch_again" : error.recovery,
    message: error.message.replace(/nfm/giu, "Nested Markdown"),
    ...(error.details?.domainCode
      ? {
          details: {
            ...error.details,
            domainCode: error.details.domainCode.replaceAll("nfm", "nested_markdown"),
          },
        }
      : {}),
  };
}
