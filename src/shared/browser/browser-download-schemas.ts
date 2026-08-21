import { z } from "zod";
import type { BrowserDownloadActionRequest } from "../browser-download";

export const BrowserDownloadActionRequestSchema = z
  .object({
    action: z.enum(["pause", "resume", "cancel", "open", "show-in-folder", "remove"]),
    downloadId: z.string().trim().min(1).max(512),
  })
  .strict() satisfies z.ZodType<BrowserDownloadActionRequest>;
