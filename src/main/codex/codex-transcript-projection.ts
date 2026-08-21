import type { CodexItemView, CodexTranscriptEntry } from "../../shared/types";

export function projectTranscriptEntryToItemView(entry: CodexTranscriptEntry): CodexItemView {
  const { entryId: _entryId, kind, source: _source, sequence: _sequence, ...shared } = entry;
  void _entryId;
  void _source;
  void _sequence;

  return {
    ...shared,
    normalizedKind: kind,
  };
}
