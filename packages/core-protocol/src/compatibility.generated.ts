import type { components } from "./generated";

export const CORE_CLIENT_REQUIREMENTS = {
  "transport": {
    "min": 12,
    "max": 12
  },
  "event_version": 9,
  "modules": [
    {
      "module": "library",
      "contract_version": 44
    },
    {
      "module": "database",
      "contract_version": 24
    },
    {
      "module": "owned_document",
      "contract_version": 10
    },
    {
      "module": "project_workspace",
      "contract_version": 20
    },
    {
      "module": "automation",
      "contract_version": 4
    },
    {
      "module": "store_administration",
      "contract_version": 8
    }
  ],
  "accepted_store_formats": [
    {
      "lineage": "nodex-rust-core",
      "version": 148,
      "schema_fingerprint": "ef41917e003824e075ffbe7bde8852283a97612cc068d5c4a3308d9b360fc5bb"
    }
  ]
} as const satisfies components["schemas"]["CoreClientRequirements"];

export const CORE_TRANSPORT_BUDGETS = {
  "ordinary_json_request_bytes": 2097152,
  "ordinary_json_response_bytes": 16777216,
  "event_frame_bytes": 2359296,
  "document_json_request_bytes": 67108864,
  "document_response_bytes": 25165832,
  "page_file_blob_bytes": 67108864,
  "request_deadline_min_ms": 250,
  "request_deadline_max_ms": 300000,
  "interactive_request_deadline_ms": 20000,
  "background_request_deadline_ms": 60000,
  "maintenance_request_deadline_ms": 120000
} as const satisfies components["schemas"]["CoreTransportBudgets"];
