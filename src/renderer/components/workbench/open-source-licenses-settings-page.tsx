import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { NodexButton } from "@/components/ui/button";
import {
  NodexSettingsPageSurface as SettingsPageSurface,
  NodexSettingsSection as SettingsSection,
} from "@/components/ui/settings";
import { queryKeys } from "@/lib/query-keys";
import { invoke } from "./workbench-settings-overlay-deps";

export function OpenSourceLicensesSettingsPage({
  onBack,
}: {
  onBack: () => void;
}) {
  const noticesQuery = useQuery({
    queryKey: queryKeys.settings.thirdPartyNotices(),
    queryFn: () => invoke("settings:third-party-notices:get"),
    staleTime: 60_000,
  });
  const noticesText = noticesQuery.data?.text;

  let content;
  if (noticesQuery.isLoading) {
    content = (
      <div className="text-sm text-token-text-secondary" role="status">
        Loading…
      </div>
    );
  } else {
    content = (
      <SettingsSection cardClassName="overflow-hidden rounded-2xl">
        {noticesText ? (
          <div role="document" aria-label={noticesText}>
            <pre
              aria-hidden="true"
              className="rounded bg-token-surface-secondary p-3 text-xs leading-relaxed break-words whitespace-pre-wrap text-token-text-primary"
            >
              {noticesText}
            </pre>
          </div>
        ) : (
          <div className="text-sm text-token-text-secondary">
            No third-party notices were found.
          </div>
        )}
      </SettingsSection>
    );
  }

  return (
    <SettingsPageSurface
      title="Open source licenses"
      subtitle="Third-party notices for dependencies included in this app"
      contentClassName="max-w-3xl"
      backSlot={(
        <NodexButton
          aria-label="Back to General"
          className="no-drag"
          variant="ghost"
          size="xs"
          onClick={onBack}
        >
          <ArrowLeft className="icon-xs" />
          Back
        </NodexButton>
      )}
    >
      {content}
    </SettingsPageSurface>
  );
}
