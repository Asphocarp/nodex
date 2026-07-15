import type { ToolFailure } from "./base-schemas";
import type { NodexAgentAccess } from "./read-runtime";
import type {
  AdvancedQueryDatabaseV3InputSchema,
  FetchV3InputSchema,
  FetchV3OutputSchema,
  GetContextV3InputSchema,
  GetContextV3OutputSchema,
  QueryDatabaseV3OutputSchema,
  QueryDatabaseViewV3InputSchema,
  SearchV3InputSchema,
  SearchV3OutputSchema,
} from "./v3-read-schemas";
import type { z } from "zod";

export type NodexAgentV3ReadRequest =
  | {
      readonly tool: "get_context";
      readonly projectId: string | null;
      readonly access: NodexAgentAccess;
      readonly input: z.infer<typeof GetContextV3InputSchema>;
    }
  | {
      readonly tool: "fetch";
      readonly projectId: string;
      readonly input: z.infer<typeof FetchV3InputSchema>;
    }
  | {
      readonly tool: "search";
      readonly projectId: string;
      readonly input: z.infer<typeof SearchV3InputSchema>;
    }
  | {
      readonly tool: "query_database_view";
      readonly projectId: string;
      readonly input: z.infer<typeof QueryDatabaseViewV3InputSchema>;
    }
  | {
      readonly tool: "advanced_query_database";
      readonly projectId: string;
      readonly input: z.infer<typeof AdvancedQueryDatabaseV3InputSchema>;
    };

export type NodexAgentV3ReadSuccess =
  | {
      readonly ok: true;
      readonly tool: "get_context";
      readonly output: z.infer<typeof GetContextV3OutputSchema>;
    }
  | {
      readonly ok: true;
      readonly tool: "fetch";
      readonly output: z.infer<typeof FetchV3OutputSchema>;
    }
  | {
      readonly ok: true;
      readonly tool: "search";
      readonly output: z.infer<typeof SearchV3OutputSchema>;
    }
  | {
      readonly ok: true;
      readonly tool: "query_database_view" | "advanced_query_database";
      readonly output: z.infer<typeof QueryDatabaseV3OutputSchema>;
    };

export type NodexAgentV3ReadCommandResult =
  | NodexAgentV3ReadSuccess
  | { readonly ok: false; readonly error: ToolFailure["error"] };
