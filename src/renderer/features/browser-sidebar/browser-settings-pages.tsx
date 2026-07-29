import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Download,
  Puzzle,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { NodexButton, NodexSwitch } from "@/components/ui/button";
import {
  NodexSettingsPageSurface,
  NodexSettingsRow,
  NodexSettingsSection,
} from "@/components/ui/settings";
import { invoke } from "@/lib/api";
import type {
  BrowserCapabilityStatus,
  BrowserContactInfo,
  BrowserContactInfoUpsertInput,
  BrowserCredentialSummary,
  BrowserExtensionsSnapshot,
  BrowserHistoryRecord,
  BrowserProfileCapabilities,
} from "../../../shared/browser-profile";
import {
  DEFAULT_BROWSER_USE_POLICY,
  type BrowserUseApprovalMode,
  type BrowserUseOriginRuleUpdate,
  type BrowserUsePolicyResource,
  type BrowserUsePolicySnapshot,
} from "../../../shared/browser-use-policy";
import { BrowserProfileImportDialog } from "./browser-profile-import-dialog";

export type BrowserSettingsDestination =
  | "browser-settings"
  | "browser-passwords"
  | "browser-contact-info"
  | "browser-history"
  | "browser-extensions";

const EMPTY_CAPABILITY: BrowserCapabilityStatus = {
  available: false,
  provider: "unavailable",
  reason: "Checking availability…",
};
const EMPTY_CAPABILITIES: BrowserProfileCapabilities = {
  contactInfo: EMPTY_CAPABILITY,
  credentialVault: EMPTY_CAPABILITY,
  extensions: EMPTY_CAPABILITY,
  history: EMPTY_CAPABILITY,
  profileImport: EMPTY_CAPABILITY,
  siteInfo: EMPTY_CAPABILITY,
};

export function BrowserSettingsPage({ open }: { open: boolean }) {
  const [capabilities, setCapabilities] =
    useState<BrowserProfileCapabilities>(EMPTY_CAPABILITIES);
  const [importOpen, setImportOpen] = useState(false);
  const [usePolicy, setUsePolicy] =
    useState<BrowserUsePolicySnapshot>(DEFAULT_BROWSER_USE_POLICY);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    void Promise.all([
      invoke("browser-profile-capabilities"),
      invoke("browser-use-policy-get"),
    ]).then(([nextCapabilities, nextPolicy]) => {
      setCapabilities(nextCapabilities);
      setUsePolicy(nextPolicy);
    });
  }, [open]);

  const clearData = async (
    kind: "cache" | "cookies" | "downloads" | "history" | "site-data",
  ) => {
    const result = await invoke("browser-browsing-data-clear", kind);
    setStatus(result.ok ? "Built-in Browser Profile data cleared." : result.message);
  };

  return (
    <NodexSettingsPageSurface
      title="Browser"
      subtitle="Shared Profile data, imports, and provider availability."
    >
      <NodexSettingsSection title="Profile">
        <NodexSettingsRow
          label="Import browser data"
          description="Import cookies and saved passwords from a local Chrome or ChatGPT Atlas Profile."
        >
          <NodexButton
            size="sm"
            variant="secondary"
            disabled={!capabilities.profileImport.available}
            onClick={() => setImportOpen(true)}
          >
            <Download />
            Import
          </NodexButton>
        </NodexSettingsRow>
        <CapabilityRow label="Credential storage" capability={capabilities.credentialVault} />
        <CapabilityRow label="Contact info" capability={capabilities.contactInfo} />
        <CapabilityRow label="Site information" capability={capabilities.siteInfo} />
        <CapabilityRow label="History" capability={capabilities.history} />
        <CapabilityRow label="Extensions" capability={capabilities.extensions} />
      </NodexSettingsSection>
      <NodexSettingsSection title="Browsing data">
        <NodexSettingsRow
          label="Cookies"
          description="Signs out sites across every built-in Browser window."
        >
          <NodexButton size="sm" variant="secondary" onClick={() => void clearData("cookies")}>
            Clear
          </NodexButton>
        </NodexSettingsRow>
        <NodexSettingsRow
          label="Site data"
          description="Clears local storage, IndexedDB, service workers, and site files from the shared Profile."
        >
          <NodexButton size="sm" variant="secondary" onClick={() => void clearData("site-data")}>
            Clear
          </NodexButton>
        </NodexSettingsRow>
        <NodexSettingsRow label="Cache">
          <NodexButton size="sm" variant="secondary" onClick={() => void clearData("cache")}>
            Clear
          </NodexButton>
        </NodexSettingsRow>
        <NodexSettingsRow label="History">
          <NodexButton size="sm" variant="secondary" onClick={() => void clearData("history")}>
            Clear
          </NodexButton>
        </NodexSettingsRow>
        <NodexSettingsRow label="Download history">
          <NodexButton size="sm" variant="secondary" onClick={() => void clearData("downloads")}>
            Clear
          </NodexButton>
        </NodexSettingsRow>
      </NodexSettingsSection>
      <BrowserUsePolicySettings
        policy={usePolicy}
        onChange={setUsePolicy}
        onStatus={setStatus}
      />
      {status ? <SettingsStatus>{status}</SettingsStatus> : null}
      <BrowserProfileImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </NodexSettingsPageSurface>
  );
}

function BrowserUsePolicySettings({
  policy,
  onChange,
  onStatus,
}: {
  policy: BrowserUsePolicySnapshot;
  onChange: (policy: BrowserUsePolicySnapshot) => void;
  onStatus: (status: string) => void;
}) {
  const [origin, setOrigin] = useState("");
  const [resource, setResource] =
    useState<BrowserUsePolicyResource>("origin");
  const [kind, setKind] =
    useState<BrowserUseOriginRuleUpdate["kind"]>("allowed");

  const updateModes = async (
    input: Partial<Pick<
      BrowserUsePolicySnapshot,
      | "approvalMode"
      | "historyApprovalMode"
      | "downloadApprovalMode"
      | "uploadApprovalMode"
      | "fullCdpAccessEnabled"
    >>,
  ) => {
    try {
      onChange(await invoke("browser-use-policy-update-modes", input));
      onStatus("Browser Use policy updated.");
    } catch (error) {
      onStatus(readErrorMessage(error, "Unable to update Browser Use policy."));
    }
  };
  const updateRule = async (input: BrowserUseOriginRuleUpdate) => {
    try {
      onChange(await invoke("browser-use-policy-update-origin-rule", input));
      if (input.action === "add") setOrigin("");
      onStatus("Browser Use origin policy updated.");
    } catch (error) {
      onStatus(readErrorMessage(error, "Unable to update origin policy."));
    }
  };

  return (
    <>
      <NodexSettingsSection title="Browser Use">
        <ApprovalModeRow
          label="Website access"
          description="Ask before Browser Use accesses a site without a remembered decision."
          value={policy.approvalMode}
          onChange={(approvalMode) => void updateModes({ approvalMode })}
        />
        <ApprovalModeRow
          label="Browsing history"
          description="Control whether Browser Use asks before reading user history."
          value={policy.historyApprovalMode}
          onChange={(historyApprovalMode) =>
            void updateModes({ historyApprovalMode })}
        />
        <ApprovalModeRow
          label="Downloads"
          description="Control approval prompts before an agent downloads a file."
          value={policy.downloadApprovalMode}
          onChange={(downloadApprovalMode) =>
            void updateModes({ downloadApprovalMode })}
        />
        <ApprovalModeRow
          label="Uploads"
          description="Control approval prompts before an agent uploads a file."
          value={policy.uploadApprovalMode}
          onChange={(uploadApprovalMode) =>
            void updateModes({ uploadApprovalMode })}
        />
        <NodexSettingsRow
          label="Full CDP access"
          description="Expose raw Chrome DevTools Protocol only when the bundled runtime and enterprise policy also allow it."
        >
          <NodexSwitch
            ariaLabel="Full CDP access"
            checked={policy.fullCdpAccessEnabled}
            onCheckedChange={(fullCdpAccessEnabled) =>
              void updateModes({ fullCdpAccessEnabled })}
          />
        </NodexSettingsRow>
      </NodexSettingsSection>
      <NodexSettingsSection title="Remembered origins">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <input
            className="h-8 min-w-48 flex-1 rounded-lg border border-token-border bg-token-main-surface-primary px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-token-focus"
            value={origin}
            placeholder="example.com"
            onChange={(event) => setOrigin(event.target.value)}
          />
          <PolicySelect
            ariaLabel="Browser Use resource"
            value={resource}
            onChange={(value) => setResource(value as BrowserUsePolicyResource)}
          >
            <option value="origin">Website</option>
            <option value="download">Download</option>
            <option value="upload">Upload</option>
            <option value="fullCdp">Full CDP</option>
          </PolicySelect>
          <PolicySelect
            ariaLabel="Browser Use origin decision"
            value={kind}
            onChange={(value) =>
              setKind(value as BrowserUseOriginRuleUpdate["kind"])}
          >
            <option value="allowed">Allow</option>
            <option value="denied">Deny</option>
          </PolicySelect>
          <NodexButton
            size="sm"
            disabled={!origin.trim()}
            onClick={() => void updateRule({
              action: "add",
              kind,
              origin,
              resource,
            })}
          >
            Add
          </NodexButton>
        </div>
        <OriginRuleRows policy={policy} onRemove={updateRule} />
      </NodexSettingsSection>
    </>
  );
}

function ApprovalModeRow({
  description,
  label,
  onChange,
  value,
}: {
  description: string;
  label: string;
  onChange: (mode: BrowserUseApprovalMode) => void;
  value: BrowserUseApprovalMode;
}) {
  return (
    <NodexSettingsRow label={label} description={description}>
      <PolicySelect
        ariaLabel={`${label} approval mode`}
        value={value}
        onChange={(nextValue) => onChange(nextValue as BrowserUseApprovalMode)}
      >
        <option value="alwaysAsk">Always ask</option>
        <option value="neverAsk">Never ask</option>
      </PolicySelect>
    </NodexSettingsRow>
  );
}

function PolicySelect({
  ariaLabel,
  children,
  onChange,
  value,
}: {
  ariaLabel: string;
  children: ReactNode;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      className="h-8 rounded-lg border border-token-border bg-token-main-surface-primary px-2 text-sm text-token-text-primary outline-none focus-visible:ring-1 focus-visible:ring-token-focus"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}

function OriginRuleRows({
  onRemove,
  policy,
}: {
  onRemove: (input: BrowserUseOriginRuleUpdate) => Promise<void>;
  policy: BrowserUsePolicySnapshot;
}) {
  const groups: Array<{
    kind: BrowserUseOriginRuleUpdate["kind"];
    origins: string[];
    resource: BrowserUsePolicyResource;
  }> = [
    { kind: "allowed", origins: policy.allowedOrigins, resource: "origin" },
    { kind: "denied", origins: policy.deniedOrigins, resource: "origin" },
    {
      kind: "allowed",
      origins: policy.allowedDownloadOrigins,
      resource: "download",
    },
    {
      kind: "denied",
      origins: policy.deniedDownloadOrigins,
      resource: "download",
    },
    {
      kind: "allowed",
      origins: policy.allowedUploadOrigins,
      resource: "upload",
    },
    {
      kind: "denied",
      origins: policy.deniedUploadOrigins,
      resource: "upload",
    },
    {
      kind: "allowed",
      origins: policy.allowedFullCdpOrigins,
      resource: "fullCdp",
    },
    {
      kind: "denied",
      origins: policy.deniedFullCdpOrigins,
      resource: "fullCdp",
    },
  ];
  const rules = groups.flatMap((group) =>
    group.origins.map((origin) => ({ ...group, origin }))
  );
  if (rules.length === 0) {
    return <EmptySettingsRow message="No remembered Browser Use decisions." />;
  }
  return rules.map(({ kind, origin, resource }) => (
    <NodexSettingsRow
      key={`${resource}:${kind}:${origin}`}
      label={origin}
      description={`${resourceLabel(resource)} · ${
        kind === "allowed" ? "Allowed" : "Denied"
      }`}
    >
      <NodexButton
        size="icon-xs"
        variant="ghost"
        aria-label={`Remove ${origin} ${resource} policy`}
        onClick={() => void onRemove({
          action: "remove",
          kind,
          origin,
          resource,
        })}
      >
        <Trash2 />
      </NodexButton>
    </NodexSettingsRow>
  ));
}

function resourceLabel(resource: BrowserUsePolicyResource): string {
  if (resource === "origin") return "Website";
  if (resource === "download") return "Download";
  if (resource === "upload") return "Upload";
  return "Full CDP";
}

export function BrowserPasswordsSettingsPage({ open }: { open: boolean }) {
  const [credentials, setCredentials] = useState<BrowserCredentialSummary[]>([]);
  const [capability, setCapability] =
    useState<BrowserCapabilityStatus>(EMPTY_CAPABILITY);
  const [importOpen, setImportOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const [capabilities, nextCredentials] = await Promise.all([
      invoke("browser-profile-capabilities"),
      invoke("browser-credentials-list-all"),
    ]);
    setCapability(capabilities.credentialVault);
    setCredentials(nextCredentials);
  }, []);
  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  const remove = async (credentialId: string) => {
    const result = await invoke("browser-credential-remove", credentialId);
    setStatus(result.ok ? "Password removed." : result.message ?? "Unable to remove password.");
    if (result.ok) await refresh();
  };

  return (
    <NodexSettingsPageSurface
      title="Passwords"
      subtitle="Saved passwords stay encrypted and are revealed only to the selected site’s guest page."
      action={(
        <NodexButton
          size="sm"
          variant="secondary"
          disabled={!capability.available}
          onClick={() => setImportOpen(true)}
        >
          <Download />
          Import
        </NodexButton>
      )}
    >
      {!capability.available ? (
        <UnavailableCapability capability={capability} />
      ) : (
        <NodexSettingsSection title="Saved passwords">
          {credentials.length === 0 ? (
            <EmptySettingsRow message="No saved passwords." />
          ) : credentials.map((credential) => (
            <NodexSettingsRow
              key={credential.id}
              label={credential.label}
              description={`${credential.username || "No username"} · ${credential.origin}`}
            >
              <NodexButton
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove password for ${credential.origin}`}
                onClick={() => void remove(credential.id)}
              >
                <Trash2 />
              </NodexButton>
            </NodexSettingsRow>
          ))}
        </NodexSettingsSection>
      )}
      {status ? <SettingsStatus>{status}</SettingsStatus> : null}
      <BrowserProfileImportDialog
        open={importOpen}
        onOpenChange={(nextOpen) => {
          setImportOpen(nextOpen);
          if (!nextOpen) void refresh();
        }}
      />
    </NodexSettingsPageSurface>
  );
}

export function BrowserContactInfoSettingsPage({ open }: { open: boolean }) {
  const [contacts, setContacts] = useState<BrowserContactInfo[]>([]);
  const [capability, setCapability] =
    useState<BrowserCapabilityStatus>(EMPTY_CAPABILITY);
  const [draft, setDraft] =
    useState<BrowserContactInfoUpsertInput | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const [capabilities, nextContacts] = await Promise.all([
      invoke("browser-profile-capabilities"),
      invoke("browser-contact-info-list"),
    ]);
    setCapability(capabilities.contactInfo);
    setContacts(nextContacts);
  }, []);
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const save = async () => {
    if (!draft) return;
    try {
      await invoke("browser-contact-info-upsert", draft);
      setDraft(null);
      setStatus("Contact info saved.");
      await refresh();
    } catch (error) {
      setStatus(readErrorMessage(error, "Unable to save contact info."));
    }
  };
  const remove = async (contactInfoId: string) => {
    const result = await invoke("browser-contact-info-remove", contactInfoId);
    setStatus(result.ok
      ? "Contact info removed."
      : result.message ?? "Unable to remove contact info.");
    if (result.ok) await refresh();
  };

  return (
    <NodexSettingsPageSurface
      title="Contact info"
      subtitle="Choose a saved contact from Browser chrome to fill recognized form fields."
      action={capability.available ? (
        <NodexButton
          size="sm"
          variant="secondary"
          onClick={() => setDraft(emptyContactDraft())}
        >
          Add contact
        </NodexButton>
      ) : null}
    >
      {!capability.available ? (
        <UnavailableCapability capability={capability} />
      ) : (
        <>
          {draft ? (
            <ContactInfoEditor
              draft={draft}
              onChange={setDraft}
              onCancel={() => setDraft(null)}
              onSave={() => void save()}
            />
          ) : null}
          <NodexSettingsSection title="Saved contact info">
            {contacts.length === 0 ? (
              <EmptySettingsRow message="No saved contact info." />
            ) : contacts.map((contact) => (
              <NodexSettingsRow
                key={contact.id}
                label={contact.label}
                description={[
                  contact.fullName,
                  contact.email,
                  contact.phone,
                  contact.city,
                  contact.country,
                ].filter(Boolean).join(" · ")}
              >
                <NodexButton
                  size="sm"
                  variant="ghost"
                  onClick={() => setDraft(contactToDraft(contact))}
                >
                  Edit
                </NodexButton>
                <NodexButton
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove ${contact.label}`}
                  onClick={() => void remove(contact.id)}
                >
                  <Trash2 />
                </NodexButton>
              </NodexSettingsRow>
            ))}
          </NodexSettingsSection>
        </>
      )}
      {status ? <SettingsStatus>{status}</SettingsStatus> : null}
    </NodexSettingsPageSurface>
  );
}

export function BrowserHistorySettingsPage({ open }: { open: boolean }) {
  const [entries, setEntries] = useState<BrowserHistoryRecord[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const refresh = useCallback(async (nextQuery: string) => {
    const snapshot = await invoke("browser-history-list", {
      ...(nextQuery.trim() ? { query: nextQuery.trim() } : {}),
      limit: 500,
    });
    setEntries(snapshot.entries);
  }, []);
  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => void refresh(query), 120);
    return () => window.clearTimeout(timeout);
  }, [open, query, refresh]);

  const remove = async (historyId: string) => {
    const result = await invoke("browser-history-delete", historyId);
    setStatus(result.ok ? "History entry removed." : result.message ?? "Unable to remove history entry.");
    if (result.ok) await refresh(query);
  };
  const clear = async () => {
    const result = await invoke("browser-browsing-data-clear", "history");
    setStatus(result.ok ? "Browser history cleared." : result.message ?? "Unable to clear history.");
    if (result.ok) await refresh(query);
  };

  return (
    <NodexSettingsPageSurface
      title="History"
      subtitle="Visits from the shared built-in Browser Profile."
      action={(
        <NodexButton size="sm" variant="secondary" onClick={() => void clear()}>
          <Trash2 />
          Clear
        </NodexButton>
      )}
    >
      <label className="flex h-9 items-center gap-2 rounded-lg border border-token-border bg-token-main-surface-primary px-3">
        <Search className="size-4 text-token-text-tertiary" />
        <input
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-token-text-tertiary"
          value={query}
          placeholder="Search history"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <NodexSettingsSection>
        {entries.length === 0 ? (
          <EmptySettingsRow message={query ? "No matching visits." : "No Browser history yet."} />
        ) : entries.map((entry) => (
          <NodexSettingsRow
            key={entry.id}
            label={entry.title || entry.url}
            description={`${entry.url} · ${formatVisitTime(entry.lastVisitedAt)}`}
          >
            <NodexButton
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove ${entry.title || entry.url} from history`}
              onClick={() => void remove(entry.id)}
            >
              <Trash2 />
            </NodexButton>
          </NodexSettingsRow>
        ))}
      </NodexSettingsSection>
      {status ? <SettingsStatus>{status}</SettingsStatus> : null}
    </NodexSettingsPageSurface>
  );
}

export function BrowserExtensionsSettingsPage({ open }: { open: boolean }) {
  const [snapshot, setSnapshot] = useState<BrowserExtensionsSnapshot>({
    capability: EMPTY_CAPABILITY,
    extensions: [],
  });
  const [status, setStatus] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setSnapshot(await invoke("browser-extensions-list"));
  }, []);
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const load = async () => {
    try {
      const extension = await invoke("browser-extension-load");
      if (!extension) return;
      setStatus(`${extension.name} loaded.`);
      await refresh();
    } catch (error) {
      setStatus(readErrorMessage(error, "Unable to load extension."));
    }
  };
  const remove = async (extensionId: string) => {
    const result = await invoke("browser-extension-remove", extensionId);
    setStatus(result.ok ? "Extension removed." : result.message ?? "Unable to remove extension.");
    if (result.ok) await refresh();
  };

  return (
    <NodexSettingsPageSurface
      title="Extensions"
      subtitle="Unpacked extensions loaded into the shared built-in Browser Profile."
      action={snapshot.capability.available ? (
        <NodexButton size="sm" variant="secondary" onClick={() => void load()}>
          <Puzzle />
          Load unpacked
        </NodexButton>
      ) : null}
    >
      {!snapshot.capability.available ? (
        <UnavailableCapability capability={snapshot.capability} />
      ) : (
        <NodexSettingsSection>
          {snapshot.extensions.length === 0 ? (
            <EmptySettingsRow message="No extensions loaded." />
          ) : snapshot.extensions.map((extension) => (
            <NodexSettingsRow
              key={extension.id}
              label={`${extension.name} ${extension.version}`}
              description={extension.path}
            >
              <NodexButton
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove ${extension.name}`}
                onClick={() => void remove(extension.id)}
              >
                <Trash2 />
              </NodexButton>
            </NodexSettingsRow>
          ))}
        </NodexSettingsSection>
      )}
      {status ? <SettingsStatus>{status}</SettingsStatus> : null}
    </NodexSettingsPageSurface>
  );
}

function CapabilityRow({
  capability,
  label,
}: {
  capability: BrowserCapabilityStatus;
  label: string;
}) {
  return (
    <NodexSettingsRow
      label={label}
      description={
        capability.available
          ? `Available through ${capability.provider}.`
          : capability.reason ?? "Unavailable."
      }
    >
      <span
        className={
          capability.available
            ? "text-xs text-token-success-foreground"
            : "text-xs text-token-text-tertiary"
        }
      >
        {capability.available ? "Available" : "Unavailable"}
      </span>
    </NodexSettingsRow>
  );
}

function ContactInfoEditor({
  draft,
  onCancel,
  onChange,
  onSave,
}: {
  draft: BrowserContactInfoUpsertInput;
  onCancel: () => void;
  onChange: (draft: BrowserContactInfoUpsertInput) => void;
  onSave: () => void;
}) {
  const setField = (
    field: keyof BrowserContactInfoUpsertInput,
    value: string,
  ) => {
    onChange({ ...draft, [field]: value });
  };
  const fields: Array<{
    field: Exclude<keyof BrowserContactInfoUpsertInput, "id">;
    label: string;
    placeholder?: string;
  }> = [
    { field: "label", label: "Label", placeholder: "Home" },
    { field: "fullName", label: "Full name" },
    { field: "email", label: "Email" },
    { field: "phone", label: "Phone" },
    { field: "addressLine1", label: "Address line 1" },
    { field: "addressLine2", label: "Address line 2" },
    { field: "city", label: "City" },
    { field: "region", label: "State or region" },
    { field: "postalCode", label: "Postal code" },
    { field: "country", label: "Country" },
  ];
  const hasValue = [
    draft.fullName,
    draft.email,
    draft.phone,
    draft.addressLine1,
    draft.addressLine2,
    draft.city,
    draft.region,
    draft.postalCode,
    draft.country,
  ].some((value) => value.trim());
  return (
    <NodexSettingsSection title={draft.id ? "Edit contact" : "New contact"}>
      {fields.map(({ field, label, placeholder }) => (
        <NodexSettingsRow key={field} label={label}>
          <input
            className="h-8 w-64 max-w-[45vw] rounded-lg border border-token-border bg-token-main-surface-primary px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-token-focus"
            value={draft[field]}
            placeholder={placeholder}
            onChange={(event) => setField(field, event.target.value)}
          />
        </NodexSettingsRow>
      ))}
      <div className="flex justify-end gap-2 p-3">
        <NodexButton size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </NodexButton>
        <NodexButton size="sm" disabled={!hasValue} onClick={onSave}>
          Save
        </NodexButton>
      </div>
    </NodexSettingsSection>
  );
}

function UnavailableCapability({
  capability,
}: {
  capability: BrowserCapabilityStatus;
}) {
  return (
    <NodexSettingsSection>
      <NodexSettingsRow
        label="Unavailable"
        description={capability.reason ?? "This provider is not available in the current runtime."}
      >
        <RotateCcw className="size-4 text-token-text-tertiary" />
      </NodexSettingsRow>
    </NodexSettingsSection>
  );
}

function EmptySettingsRow({ message }: { message: string }) {
  return <div className="p-3 text-sm text-token-text-secondary">{message}</div>;
}

function SettingsStatus({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-token-border px-3 py-2 text-sm text-token-text-secondary">
      {children}
    </div>
  );
}

function formatVisitTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function readErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function emptyContactDraft(): BrowserContactInfoUpsertInput {
  return {
    label: "",
    fullName: "",
    email: "",
    phone: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    region: "",
    postalCode: "",
    country: "",
  };
}

function contactToDraft(
  contact: BrowserContactInfo,
): BrowserContactInfoUpsertInput {
  return {
    id: contact.id,
    label: contact.label,
    fullName: contact.fullName,
    email: contact.email,
    phone: contact.phone,
    addressLine1: contact.addressLine1,
    addressLine2: contact.addressLine2,
    city: contact.city,
    region: contact.region,
    postalCode: contact.postalCode,
    country: contact.country,
  };
}
