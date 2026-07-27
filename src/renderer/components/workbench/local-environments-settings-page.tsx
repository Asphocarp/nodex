import { startTransition, useCallback, useEffect, useEffectEvent, useId, useMemo, useState, type ReactNode, type SVGProps } from "react";
import {
  ChevronLeft,
  Plus,
  Trash2,
} from "lucide-react";
import { SpinnerIcon } from "@/components/shared/icons";
import { NodexButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LazySourceViewer } from "@/components/ui/lazy-source-viewer";
import {
  NodexDropdownItem,
  NodexDropdownMenu,
} from "@/components/ui/dropdown";
import {
  NodexPopover,
  NodexPopoverContent,
  NodexPopoverTrigger,
} from "@/components/ui/popover";
import { invoke } from "@/lib/api";
import type {
  Project,
  UpdateWorktreeEnvironmentConfigInput,
  WorktreeEnvironmentActionDefinition,
  WorktreeEnvironmentActionIcon,
  WorktreeEnvironmentConfigRecord,
  WorktreeEnvironmentDefinition,
  WorktreeEnvironmentPlatform,
  WorktreeEnvironmentSettingsSnapshot,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProjectMarker } from "./project-marker";

interface LocalEnvironmentsSettingsService {
  listConfigs: (
    projectId: string,
  ) => Promise<WorktreeEnvironmentConfigRecord[]>;
  readConfig: (
    projectId: string,
    configPath?: string | null,
  ) => Promise<WorktreeEnvironmentSettingsSnapshot>;
  saveConfig: (
    input: UpdateWorktreeEnvironmentConfigInput,
  ) => Promise<WorktreeEnvironmentSettingsSnapshot>;
}

interface LocalEnvironmentsSettingsPageProps {
  open: boolean;
  active: boolean;
  projects: Project[];
  activeProjectId: string | null;
  initialProjectId?: string | null;
  initialConfigPath?: string | null;
  onAddProject?: () => void;
  renderShell?: (shell: LocalEnvironmentsSettingsShellProps) => ReactNode;
  service?: LocalEnvironmentsSettingsService;
}

type LocalEnvironmentsPageMode = "workspace" | "summary" | "edit";

export interface LocalEnvironmentsSettingsShellProps {
  title: string;
  subtitle?: ReactNode;
  backSlot?: ReactNode;
  children: ReactNode;
}

const PLATFORM_OPTIONS: Array<{
  value: WorktreeEnvironmentPlatform;
  label: string;
}> = [
    { value: "darwin", label: "macOS" },
    { value: "linux", label: "Linux" },
    { value: "win32", label: "Windows" },
  ];

function LocalEnvironmentProjectIcon({
  project,
  className,
}: {
  project: Project;
  className?: string;
}) {
  return (
    <ProjectMarker
      appearance={project.appearance}
      className={className}
    />
  );
}

function CodexToolActionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="21" height="21" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M10.7228 2.53564C11.5515 2.53564 12.3183 2.97502 12.7374 3.68994L13.5587 5.09033L13.6124 5.15967C13.6736 5.22007 13.7566 5.2556 13.8448 5.25635L15.4601 5.26904L15.6144 5.27588C16.3826 5.33292 17.0775 5.76649 17.465 6.43994L17.7931 7.01123L17.8663 7.14697C18.1815 7.78943 18.1843 8.54208 17.8741 9.18701L17.8028 9.32275L17.0001 10.7446C16.9427 10.8467 16.9426 10.9717 17.0001 11.0737L17.8028 12.4946L17.8741 12.6313C18.1842 13.2763 18.1816 14.029 17.8663 14.6714L17.7931 14.8071L17.465 15.3784C17.0774 16.0517 16.3825 16.4855 15.6144 16.5425L15.4601 16.5483L13.8448 16.562C13.7565 16.5628 13.6736 16.5982 13.6124 16.6587L13.5587 16.7271L12.7374 18.1284C12.3183 18.8432 11.5514 19.2827 10.7228 19.2827H10.0763C9.29958 19.2826 8.57714 18.8964 8.14465 18.2593L8.06261 18.1284L7.24133 16.7271C7.1966 16.6509 7.12417 16.5966 7.04113 16.5737L6.95519 16.562L5.33996 16.5483C4.56297 16.542 3.84347 16.1503 3.41613 15.5093L3.33508 15.3784L3.00695 14.8071C2.59564 14.0921 2.59168 13.2129 2.99719 12.4946L3.79894 11.0737L3.83215 10.9937C3.84657 10.9383 3.84652 10.88 3.83215 10.8247L3.79894 10.7446L2.99719 9.32275C2.59184 8.60451 2.59571 7.72612 3.00695 7.01123L3.33508 6.43994L3.41613 6.30908C3.84345 5.66796 4.56288 5.27538 5.33996 5.26904L6.95519 5.25635L7.04113 5.24463C7.12427 5.22177 7.1966 5.16664 7.24133 5.09033L8.06261 3.68994L8.14465 3.55908C8.57712 2.92179 9.29949 2.5358 10.0763 2.53564H10.7228ZM10.0763 3.86572C9.76448 3.86587 9.47308 4.01039 9.28429 4.25244L9.21008 4.36279L8.38879 5.76318C8.12941 6.20571 7.68297 6.49995 7.18273 6.56982L6.96594 6.58643L5.3507 6.59912C5.03877 6.60167 4.74854 6.74903 4.56164 6.99268L4.48742 7.10303L4.15929 7.67432C3.98236 7.98202 3.98089 8.36033 4.15539 8.66943L4.95715 10.0903L5.05187 10.2856C5.21318 10.6851 5.21302 11.1323 5.05187 11.5317L4.95715 11.728L4.15539 13.1489C3.98092 13.4581 3.98228 13.8363 4.15929 14.144L4.48742 14.7144L4.56164 14.8247C4.74853 15.0686 5.03859 15.2157 5.3507 15.2183L6.96594 15.2319L7.18273 15.2476C7.68301 15.3174 8.12939 15.6126 8.38879 16.0552L9.21008 17.4556L9.28429 17.5649C9.47307 17.8072 9.76431 17.9525 10.0763 17.9526H10.7228C11.0794 17.9526 11.4096 17.7632 11.59 17.4556L12.4112 16.0552L12.5333 15.8745C12.8433 15.4758 13.3212 15.2361 13.8341 15.2319L15.4493 15.2183L15.5812 15.2085C15.8855 15.1657 16.1569 14.985 16.3126 14.7144L16.6407 14.144L16.6984 14.0259C16.7984 13.7835 16.8 13.5113 16.7023 13.2681L16.6446 13.1489L15.8419 11.728C15.5551 11.2201 15.5552 10.5983 15.8419 10.0903L16.6446 8.66943L16.7023 8.55029C16.8001 8.30708 16.7983 8.03486 16.6984 7.79248L16.6407 7.67432L16.3126 7.10303C16.1569 6.8324 15.8856 6.65166 15.5812 6.60889L15.4493 6.59912L13.8341 6.58643C13.3213 6.58224 12.8433 6.34243 12.5333 5.94385L12.4112 5.76318L11.59 4.36279C11.4096 4.05506 11.0795 3.86572 10.7228 3.86572H10.0763ZM11.9855 10.9087C11.9853 10.0336 11.2755 9.32399 10.4005 9.32373C9.52524 9.32373 8.81474 10.0335 8.81457 10.9087C8.81457 11.7841 9.52513 12.4937 10.4005 12.4937C11.2757 12.4934 11.9855 11.7839 11.9855 10.9087ZM13.3146 10.9087C13.3146 12.5184 12.0102 13.8235 10.4005 13.8237C8.7906 13.8237 7.48547 12.5186 7.48547 10.9087C7.48564 9.29893 8.7907 7.99365 10.4005 7.99365C12.0101 7.99391 13.3144 9.29909 13.3146 10.9087Z" fill="currentColor" />
    </svg>
  );
}

function CodexRunActionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M3.82422 4.74933C3.82427 3.32901 5.39273 2.46804 6.59102 3.23058L13.2698 7.48185C14.3813 8.18917 14.3813 9.81116 13.2698 10.5185L6.59102 14.7689C5.39281 15.5314 3.82448 14.6711 3.82422 13.251V4.74933ZM5.17422 13.251C5.17448 13.6058 5.56646 13.8211 5.86592 13.6307L12.5456 9.37941C12.8232 9.20249 12.8234 8.79681 12.5456 8.62004L5.86592 4.36964C5.56636 4.17902 5.17427 4.39428 5.17422 4.74933V13.251Z" fill="currentColor" />
    </svg>
  );
}

function CodexDebugActionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="21" height="20" viewBox="0 0 21 20" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M10.2 12.083C10.8904 12.083 11.45 12.8295 11.45 13.75C11.45 14.6705 10.8904 15.417 10.2 15.417C9.50966 15.417 8.95001 14.6705 8.95001 13.75C8.95003 12.8295 9.50967 12.083 10.2 12.083Z" fill="currentColor" />
      <path d="M8.117 9.16699C8.80708 9.16713 9.36678 9.63296 9.367 10.208C9.367 10.7832 8.80722 11.2499 8.117 11.25C7.42665 11.25 6.867 10.7833 6.867 10.208C6.86723 9.63287 7.42679 9.16699 8.117 9.16699Z" fill="currentColor" />
      <path d="M12.283 9.16699C12.9732 9.16699 13.5328 9.63287 13.533 10.208C13.533 10.7833 12.9734 11.25 12.283 11.25C11.5928 11.2499 11.033 10.7832 11.033 10.208C11.0332 9.63296 11.5929 9.16713 12.283 9.16699Z" fill="currentColor" />
      <path fillRule="evenodd" clipRule="evenodd" d="M15.1356 1.83496C16.0895 1.83496 16.7003 2.36544 17.0438 2.83887C17.2139 3.07346 17.3281 3.30439 17.3992 3.47461C17.435 3.56037 17.4606 3.6336 17.4783 3.6875C17.4872 3.71448 17.4948 3.73684 17.4998 3.75391C17.5023 3.76229 17.5041 3.76965 17.5057 3.77539C17.5065 3.7782 17.5071 3.78106 17.5076 3.7832C17.5079 3.7842 17.5084 3.78528 17.5086 3.78613L17.5096 3.78809C17.5062 3.78919 17.461 3.8011 16.866 3.95801L16.617 4.02344L17.5096 3.78809C17.603 4.1431 17.391 4.50793 17.0359 4.60156C16.6809 4.695 16.3171 4.48291 16.2234 4.12793V4.12988L16.2244 4.13086V4.13281C16.2243 4.13251 16.2239 4.13143 16.2234 4.12988C16.2222 4.12556 16.2198 4.11621 16.2156 4.10352C16.2071 4.07776 16.1927 4.03673 16.1717 3.98633C16.1286 3.88318 16.0617 3.74891 15.9676 3.61914C15.7822 3.36365 15.5274 3.16504 15.1356 3.16504C14.3975 3.16516 13.8581 3.58082 13.4207 4.30273C13.3067 4.491 13.2038 4.69355 13.1111 4.9043C15.6971 5.96132 17.5311 8.38367 17.5311 11.25C17.5311 15.1087 14.208 18.1649 10.2 18.165C6.19206 18.1649 2.86798 15.1087 2.86798 11.25C2.86798 8.38418 4.70168 5.96162 7.28693 4.9043C7.19434 4.69371 7.0923 4.49087 6.97833 4.30273C6.54095 3.58089 6.00159 3.16504 5.26349 3.16504C4.87181 3.16524 4.61679 3.36363 4.43146 3.61914C4.33733 3.74896 4.27044 3.88319 4.22736 3.98633C4.20628 4.0368 4.1919 4.07779 4.18341 4.10352C4.17947 4.11549 4.17694 4.12438 4.1756 4.12891C4.17561 4.12887 4.17593 4.12831 4.17462 4.12793C4.08077 4.48278 3.71807 4.69518 3.3631 4.60156C3.00839 4.5077 2.79702 4.14392 2.89044 3.78906L3.74689 4.01465C3.68504 3.99833 3.61397 3.97936 3.53302 3.95801C2.936 3.80055 2.89338 3.79012 2.89044 3.78906V3.78613C2.89067 3.78527 2.89113 3.78423 2.89142 3.7832C2.892 3.78105 2.89258 3.77824 2.89337 3.77539C2.89498 3.76964 2.89772 3.76233 2.90021 3.75391C2.90523 3.73688 2.91185 3.71438 2.92072 3.6875C2.9385 3.63356 2.96494 3.56051 3.00079 3.47461C3.07186 3.30444 3.18519 3.07343 3.35529 2.83887C3.69862 2.36548 4.30975 1.83519 5.26349 1.83496C6.64054 1.83496 7.54382 2.66973 8.11603 3.61426C8.2881 3.89836 8.434 4.20218 8.56232 4.50977C9.08979 4.39594 9.6384 4.33498 10.2 4.33496C10.7611 4.33498 11.3088 4.39615 11.8358 4.50977C11.9641 4.20208 12.1109 3.89845 12.283 3.61426C12.8552 2.66975 13.7586 1.83509 15.1356 1.83496ZM10.2 5.66504C9.78619 5.66506 9.38256 5.70388 8.99396 5.77734C8.99966 5.79796 9.00597 5.8184 9.01154 5.83887L9.18146 6.51758L9.19806 6.65039C9.20595 6.95974 8.99569 7.24216 8.68243 7.31445C8.36933 7.38653 8.05697 7.22473 7.92853 6.94336L7.88458 6.81641L7.7254 6.17871C7.72389 6.17318 7.72204 6.16765 7.72052 6.16211C5.62919 7.0461 4.19806 9.01126 4.19806 11.25C4.19806 14.2946 6.84445 16.8348 10.2 16.835C13.5556 16.8348 16.201 14.2946 16.201 11.25C16.201 9.01078 14.7696 7.04582 12.6776 6.16211C12.6166 6.38459 12.5633 6.60491 12.5145 6.81641L12.4715 6.94336C12.343 7.22493 12.0299 7.38675 11.7166 7.31445C11.3592 7.23167 11.1363 6.87512 11.2186 6.51758L11.3875 5.83887C11.393 5.81848 11.3984 5.79788 11.4041 5.77734C11.016 5.70407 10.6133 5.66506 10.2 5.66504Z" fill="currentColor" />
    </svg>
  );
}

function CodexTestActionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M16.0013 14.4404C16.0012 13.9504 15.8514 13.4739 15.5736 13.0742L15.4467 12.9082L15.0121 12.3877C13.8615 12.8911 12.9154 13.1121 12.0619 13.1562C11.1476 13.2035 10.3805 13.0475 9.66541 12.8857C8.9421 12.7221 8.28162 12.5562 7.47302 12.5146C6.70041 12.475 5.77589 12.5504 4.56873 12.8887L4.5531 12.9082C4.19469 13.3383 3.99852 13.8806 3.99841 14.4404C3.99841 15.7627 5.07071 16.835 6.39294 16.835H13.6078C14.9299 16.8349 16.0013 15.7626 16.0013 14.4404ZM11.8353 3.16504H8.16541V7.72949C8.16541 8.20671 8.01889 8.6713 7.74841 9.06055L7.62439 9.22266L5.93396 11.25C6.52127 11.1756 7.05057 11.1614 7.54041 11.1865C8.48678 11.2351 9.2693 11.432 9.95837 11.5879C10.6557 11.7456 11.272 11.8653 11.9926 11.8281C12.5792 11.7978 13.2617 11.6591 14.1215 11.3184L12.3754 9.22266C12.0262 8.80363 11.8353 8.27494 11.8353 7.72949V3.16504ZM13.1654 7.72949C13.1654 7.96372 13.247 8.19111 13.3969 8.37109L16.4681 12.0566L16.6654 12.3154C17.0976 12.9371 17.3313 13.6782 17.3314 14.4404C17.3314 16.4971 15.6645 18.1649 13.6078 18.165H6.39294C4.33617 18.165 2.66833 16.4972 2.66833 14.4404C2.66844 13.5694 2.97398 12.7258 3.53162 12.0566L6.60291 8.37109L6.65564 8.30176C6.77198 8.13447 6.83533 7.93464 6.83533 7.72949V3.16504H6.66638C6.29926 3.16486 6.00134 2.86716 6.00134 2.5C6.00134 2.13284 6.29926 1.83514 6.66638 1.83496H13.3334L13.4672 1.84863C13.7703 1.91057 13.9984 2.17857 13.9984 2.5C13.9984 2.82143 13.7703 3.08943 13.4672 3.15137L13.3334 3.16504H13.1654V7.72949Z" fill="currentColor" />
    </svg>
  );
}

function CodexCheckboxCheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M12.8961 3.64101C13.1297 3.41418 13.4984 3.37523 13.7779 3.56581C14.0571 3.75635 14.1554 4.11331 14.0299 4.41347L13.9615 4.53847L7.71151 13.7045C7.59411 13.8767 7.4063 13.9877 7.19881 14.0072C6.99136 14.0267 6.78564 13.9533 6.63826 13.806L2.88826 10.056L2.79842 9.9457C2.6192 9.67407 2.64927 9.30496 2.88826 9.06581C3.12738 8.82669 3.49647 8.79676 3.76815 8.97597L3.8785 9.06581L7.03084 12.2182L12.8053 3.74941L12.8961 3.64101Z" fill="currentColor" />
    </svg>
  );
}

type ActionIconComponent = (props: SVGProps<SVGSVGElement>) => ReactNode;

const ACTION_ICON_OPTIONS: Array<{
  value: WorktreeEnvironmentActionIcon;
  label: string;
  icon: ActionIconComponent;
}> = [
    { value: "tool", label: "Tool", icon: CodexToolActionIcon },
    { value: "run", label: "Run", icon: CodexRunActionIcon },
    { value: "debug", label: "Debug", icon: CodexDebugActionIcon },
    { value: "test", label: "Test", icon: CodexTestActionIcon },
  ];

const DEFAULT_LOCAL_ENVIRONMENTS_SETTINGS_SERVICE: LocalEnvironmentsSettingsService = {
  async listConfigs(projectId) {
    return invoke("worktrees:environments:configs:list", projectId) as Promise<WorktreeEnvironmentConfigRecord[]>;
  },
  async readConfig(projectId, configPath) {
    return invoke("worktrees:environments:config:read", projectId, configPath) as Promise<WorktreeEnvironmentSettingsSnapshot>;
  },
  async saveConfig(input) {
    return invoke("worktrees:environments:config:save", input) as Promise<WorktreeEnvironmentSettingsSnapshot>;
  },
};

function getPrimaryWorkspaceRoot(project: Project): string {
  return project.primaryWorkspaceRoot?.trim() || project.sources[0]?.root.trim() || "";
}

function buildEmptyEnvironmentDefinition(project: Project): WorktreeEnvironmentDefinition {
  const primaryWorkspaceRoot = getPrimaryWorkspaceRoot(project);
  const fallbackName = primaryWorkspaceRoot
    ? primaryWorkspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? project.name
    : project.name;

  return {
    version: 1,
    name: fallbackName.trim() || "local",
    setup: {
      script: null,
      platformScripts: {},
    },
    cleanup: {
      script: null,
      platformScripts: {},
    },
    actions: [],
  };
}

function cloneEnvironmentDefinition(environment: WorktreeEnvironmentDefinition): WorktreeEnvironmentDefinition {
  return {
    version: environment.version,
    name: environment.name,
    setup: {
      script: environment.setup.script,
      platformScripts: { ...environment.setup.platformScripts },
    },
    cleanup: {
      script: environment.cleanup.script,
      platformScripts: { ...environment.cleanup.platformScripts },
    },
    actions: environment.actions.map((action) => ({ ...action })),
  };
}

function createActionDraft(): WorktreeEnvironmentActionDefinition {
  return {
    id: `action-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`}`,
    name: "",
    icon: "tool",
    command: "",
    platform: null,
  };
}

function hasPlatformOverrides(environment: WorktreeEnvironmentDefinition, key: "setup" | "cleanup"): boolean {
  return Object.keys(environment[key].platformScripts).length > 0;
}

function normalizeEnvironmentForSave(environment: WorktreeEnvironmentDefinition): WorktreeEnvironmentDefinition {
  return {
    version: environment.version > 0 ? environment.version : 1,
    name: environment.name.trim(),
    setup: {
      script: environment.setup.script?.trim() || null,
      platformScripts: Object.fromEntries(
        Object.entries(environment.setup.platformScripts)
          .map(([platform, script]) => [platform, script.trim()])
          .filter(([, script]) => script.length > 0),
      ) as Partial<Record<WorktreeEnvironmentPlatform, string>>,
    },
    cleanup: {
      script: environment.cleanup.script?.trim() || null,
      platformScripts: Object.fromEntries(
        Object.entries(environment.cleanup.platformScripts)
          .map(([platform, script]) => [platform, script.trim()])
          .filter(([, script]) => script.length > 0),
      ) as Partial<Record<WorktreeEnvironmentPlatform, string>>,
    },
    actions: environment.actions.map((action) => ({
      ...action,
      name: action.name.trim(),
      command: action.command.trim(),
    })),
  };
}

function MultiLineCodePreview({
  script,
  emptyLabel,
}: {
  script: string | null;
  emptyLabel: string;
}) {
  if (!script?.trim()) {
    return <div className="text-sm text-token-text-secondary">{emptyLabel}</div>;
  }

  return (
    <div className="h-48 overflow-hidden rounded-lg border-[0.5px] border-token-border bg-token-input-background">
      <LazySourceViewer
        value={script}
        ariaLabel="Environment script"
        className="h-full"
      />
    </div>
  );
}

function humanizeConfigFileName(configPath: string): string {
  const normalizedPath = configPath.trim().split("/").filter(Boolean).at(-1) ?? configPath.trim();
  return normalizedPath.length > 0 ? normalizedPath : "environment.toml";
}

function preferredConfigPath(configs: WorktreeEnvironmentConfigRecord[]): string | null {
  const preferredConfig =
    configs.find((config) => config.fileName === "environment.toml" && config.state === "success")
    ?? configs.find((config) => config.state === "success")
    ?? configs[0]
    ?? null;

  return preferredConfig?.configPath ?? null;
}

function configPrimaryLabel(config: WorktreeEnvironmentConfigRecord): string {
  if (config.state === "tooLarge") {
    return "Environment file is too large";
  }
  if (config.state !== "success") {
    return "Environment needs attention";
  }

  return config.environment?.name?.trim() || config.name || humanizeConfigFileName(config.configPath);
}

function configSecondaryLabel(config: WorktreeEnvironmentConfigRecord): string | null {
  const fileName = humanizeConfigFileName(config.configPath);
  const primary = configPrimaryLabel(config);

  if (config.state !== "success") {
    return fileName;
  }

  return fileName !== primary ? fileName : null;
}

function PageSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <div className="flex h-toolbar items-center justify-between gap-2 px-0 py-0">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="text-base font-medium text-token-text-primary">{title}</div>
          {description ? (
            <div className="text-sm text-token-text-secondary">{description}</div>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-token-border flex flex-col divide-y-[0.5px] divide-token-border rounded-lg border",
        className,
      )}
      style={{ backgroundColor: "var(--color-background-panel, var(--color-token-bg-fog))" }}
    >
      {children}
    </div>
  );
}

function ActionIconPreview({
  icon,
  className,
}: {
  icon: WorktreeEnvironmentActionIcon;
  className?: string;
}) {
  const Icon =
    ACTION_ICON_OPTIONS.find((option) => option.value === icon)?.icon
    ?? CodexToolActionIcon;

  return <Icon className={cn("icon-sm", className)} />;
}

function CodexCheckbox({
  id,
  checked,
  onCheckedChange,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-state={checked ? "checked" : "unchecked"}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "border-token-border peer inline-flex items-center justify-center",
        "data-[state=checked]:bg-token-checkbox-background data-[state=checked]:text-token-checkbox-foreground",
        "data-[state=checked]:border-token-border",
        "focus-visible:border-token-border focus-visible:ring-token-checkbox-background/50 focus-visible:ring-1",
        "aria-invalid:ring-2 aria-invalid:ring-token-error-foreground/20 aria-invalid:border-token-error-foreground",
        "icon-2xs rounded-xs shrink-0 border shadow-sm outline-none transition-all",
        "hover:bg-token-editor-background",
      )}
    >
      {checked ? (
        <span className="flex h-full w-full items-center justify-center text-current">
          <CodexCheckboxCheckIcon className="icon-xxs flex-shrink-0" />
        </span>
      ) : null}
    </button>
  );
}

function CodexSegmentedPlatformToggle({
  selectedPlatform,
  onSelect,
}: {
  selectedPlatform: WorktreeEnvironmentPlatform;
  onSelect: (platform: WorktreeEnvironmentPlatform) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5" role="group" aria-label="Platform selection">
      {PLATFORM_OPTIONS.map((option) => (
        <NodexButton
          key={option.value}
          onClick={() => onSelect(option.value)}
          variant={selectedPlatform === option.value ? "secondary" : "ghost"}
          className="w-auto"
          aria-label={option.label}
        >
          {option.label}
        </NodexButton>
      ))}
    </div>
  );
}

function LocalEnvironmentActionIconDropdown({
  value,
  onSelect,
  ariaLabel,
}: {
  value: WorktreeEnvironmentActionIcon;
  onSelect: (icon: WorktreeEnvironmentActionIcon) => void;
  ariaLabel: string;
}) {
  const selectedOption = ACTION_ICON_OPTIONS.find((option) => option.value === value) ?? ACTION_ICON_OPTIONS[0];

  return (
    <NodexDropdownMenu
      triggerButton={(
        <NodexButton
          variant="secondary"
          aria-label={ariaLabel}
          size="composer"
          className="w-12 justify-center text-sm"
        >
          <ActionIconPreview icon={selectedOption.value} />
        </NodexButton>
      )}
      side="bottom"
      align="start"
      contentWidth="icon"
    >
      {ACTION_ICON_OPTIONS.map((option) => (
        <NodexDropdownItem
          key={option.value}
          onSelect={() => onSelect(option.value)}
          leftSlot={<ActionIconPreview icon={option.value} className="shrink-0" />}
        >
          {option.label}
        </NodexDropdownItem>
      ))}
    </NodexDropdownMenu>
  );
}

function EnvironmentVariableCodeRow({
  variableName,
  description,
}: {
  variableName: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg px-2 py-1">
      <div className="text-sm text-token-text-secondary">{description}</div>
      <div className="overflow-x-auto rounded-md border border-token-input-background bg-token-text-code-block-background px-2 py-1.5">
        <code className="block text-xs font-medium whitespace-nowrap text-token-text-primary">{variableName}</code>
      </div>
    </div>
  );
}

function SetupEnvironmentVariablesButton() {
  return (
    <NodexPopover>
      <NodexPopoverTrigger asChild>
        <NodexButton variant="ghost" size="composer">
          Available environment variables
        </NodexButton>
      </NodexPopoverTrigger>
      <NodexPopoverContent
        side="bottom"
        align="end"
        className="w-80 max-w-[min(20rem,var(--radix-popover-content-available-width))]"
      >
        <div className="flex flex-col gap-1 p-2">
          <div className="px-2 py-1 text-sm font-medium text-token-text-primary">
            Setup script environment variables
          </div>
          <div className="flex flex-col gap-1">
            <EnvironmentVariableCodeRow
              variableName="CODEX_SOURCE_TREE_PATH"
              description="Source workspace path"
            />
            <EnvironmentVariableCodeRow
              variableName="CODEX_WORKTREE_PATH"
              description="New worktree path"
            />
          </div>
        </div>
      </NodexPopoverContent>
    </NodexPopover>
  );
}

function CodexScriptEditorPanels({
  title,
  description,
  showHeader = true,
  value,
  onChange,
  platformScripts,
  onPlatformScriptChange,
  scriptHint,
  addOverrideLabel,
  removeOverrideLabel,
  actions,
}: {
  title: string;
  description: string;
  showHeader?: boolean;
  value: string | null;
  onChange: (value: string) => void;
  platformScripts: Partial<Record<WorktreeEnvironmentPlatform, string>>;
  onPlatformScriptChange: (platform: WorktreeEnvironmentPlatform, value: string | null) => void;
  scriptHint: string;
  addOverrideLabel: (platform: string) => string;
  removeOverrideLabel: string;
  actions?: ReactNode;
}) {
  const textareaId = useId();

  return (
    <div className="flex flex-col gap-3">
      {showHeader ? (
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium text-token-text-primary">{title}</div>
          <div className="text-sm text-token-text-secondary">{description}</div>
        </div>
      ) : null}
      <Panel>
        <div className="flex flex-col gap-2 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium tracking-wide text-token-text-secondary uppercase">
                Script
              </div>
              <div className="text-sm text-token-text-secondary">{scriptHint}</div>
            </div>
            {actions}
          </div>
          <textarea
            id={textareaId}
            value={value ?? ""}
            rows={6}
            onChange={(event) => onChange(event.target.value)}
            className="focus-visible:ring-token-focus w-full rounded-md border border-token-border bg-token-input-background px-2.5 py-2 font-mono text-sm text-token-text-primary outline-none focus-visible:ring-2"
          />
        </div>
      </Panel>
      <Panel>
        <div className="flex flex-col gap-3 p-3">
          <div className="flex flex-col gap-1">
            <div className="text-xs font-medium tracking-wide text-token-text-secondary uppercase">
              Platform overrides
            </div>
            <div className="text-sm text-token-text-secondary">
              Overrides the default script for specific OSes.
            </div>
          </div>
          <div className="flex flex-col gap-4">
            {PLATFORM_OPTIONS.map((platform) => {
              const currentValue = platformScripts[platform.value] ?? null;
              if (currentValue === null) return null;

              return (
                <div key={platform.value} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium tracking-wide text-token-text-secondary uppercase">
                      {platform.label}
                    </div>
                    <NodexButton
                      variant="ghost"
                      size="composer"
                      onClick={() => onPlatformScriptChange(platform.value, null)}
                    >
                      {removeOverrideLabel}
                    </NodexButton>
                  </div>
                  <textarea
                    value={currentValue}
                    rows={6}
                    onChange={(event) => onPlatformScriptChange(platform.value, event.target.value)}
                    className="focus-visible:ring-token-focus w-full rounded-md border border-token-border bg-token-input-background px-2.5 py-2 font-mono text-sm text-token-text-primary outline-none focus-visible:ring-2"
                  />
                </div>
              );
            })}
          </div>
          <div className="flex flex-col items-start gap-2">
            {PLATFORM_OPTIONS.map((platform) => {
              if (platformScripts[platform.value] !== undefined) return null;

              return (
                <NodexButton
                  key={platform.value}
                  size="composer"
                  onClick={() => onPlatformScriptChange(platform.value, "")}
                >
                  {addOverrideLabel(platform.label)}
                </NodexButton>
              );
            })}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function CodexActionsEditorSection({
  actions,
  onUpdate,
  onRemove,
}: {
  actions: WorktreeEnvironmentActionDefinition[];
  onUpdate: (actionId: string, patch: Partial<WorktreeEnvironmentActionDefinition>) => void;
  onRemove: (actionId: string) => void;
}) {
  return actions.length === 0 ? (
    <Panel>
      <div className="p-3 text-sm text-token-text-secondary">
        Add an action to run commands from the local toolbar.
      </div>
    </Panel>
  ) : (
    <div className="flex flex-col gap-3">
      {actions.map((action, index) => (
        <div
          key={action.id}
          className="flex flex-col gap-3 rounded-lg border border-token-border bg-token-input-background p-3"
        >
          <div className="flex flex-col gap-2">
            <label
              className="text-xs font-medium tracking-wide text-token-text-secondary uppercase"
              htmlFor={`local-env-action-name-${action.id}`}
            >
              Name
            </label>
            <div className="flex items-center gap-2">
              <LocalEnvironmentActionIconDropdown
                value={action.icon ?? "tool"}
                onSelect={(icon) => onUpdate(action.id, { icon })}
                ariaLabel={`Action ${index + 1} icon`}
              />
              <div className="flex-1">
                <Input
                  id={`local-env-action-name-${action.id}`}
                  value={action.name}
                  onChange={(event) => onUpdate(action.id, { name: event.target.value })}
                  className="text-sm"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label
              className="text-xs font-medium tracking-wide text-token-text-secondary uppercase"
              htmlFor={`local-env-action-command-${action.id}`}
            >
              Action script
            </label>
            <textarea
              id={`local-env-action-command-${action.id}`}
              value={action.command}
              rows={4}
              onChange={(event) => onUpdate(action.id, { command: event.target.value })}
              className="focus-visible:ring-token-focus w-full rounded-md border border-token-border bg-token-input-background px-2.5 py-2 font-mono text-sm text-token-text-primary outline-none focus-visible:ring-2"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
              <div className="min-w-0">
                <div className="flex flex-col gap-2">
                  <div className="text-xs font-medium tracking-wide text-token-text-secondary uppercase">
                    Platforms
                  </div>
                  <div className="text-xs text-token-text-secondary">
                    Only run on a specific OS.
                  </div>
                  <div className="relative flex items-center gap-2 text-sm">
                    <CodexCheckbox
                      id={`local-env-action-platform-specific-${action.id}`}
                      checked={action.platform !== null}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          onUpdate(action.id, { platform: action.platform ?? "darwin" });
                          return;
                        }
                        onUpdate(action.id, { platform: null });
                      }}
                    />
                    <label
                      className="cursor-interaction text-token-text-secondary"
                      onClick={() => {
                        onUpdate(action.id, {
                          platform: action.platform === null ? "darwin" : null,
                        });
                      }}
                    >
                      Platform specific
                    </label>
                  </div>
                </div>
              </div>
              {action.platform !== null ? (
                <div className="flex justify-start">
                  <CodexSegmentedPlatformToggle
                    selectedPlatform={action.platform}
                    onSelect={(platform) => onUpdate(action.id, { platform })}
                  />
                </div>
              ) : null}
            </div>
            <div className="flex justify-end sm:justify-center">
              <NodexButton
                onClick={() => onRemove(action.id)}
                variant="ghost"
                className="size-8 justify-center px-0"
                aria-label={`Delete action ${index + 1}`}
              >
                <Trash2 className="icon-sm" />
              </NodexButton>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkspaceProjectEnvironmentGroup({
  project,
  service,
  onCreateEnvironment,
  onSelectEnvironment,
}: {
  project: Project;
  service: LocalEnvironmentsSettingsService;
  onCreateEnvironment: (projectId: string) => Promise<void>;
  onSelectEnvironment: (projectId: string, configPath: string) => Promise<void>;
}) {
  const [configs, setConfigs] = useState<WorktreeEnvironmentConfigRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const refreshConfigs = useEffectEvent(async () => {
    setLoading(true);
    setHasError(false);

    try {
      const nextConfigs = await service.listConfigs(project.id);
      setConfigs(nextConfigs);
    } catch {
      setHasError(true);
      setConfigs([]);
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void refreshConfigs();
  }, [project.id]);

  const preferredPath = preferredConfigPath(configs);

  return (
    <Panel className="p-0">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <button
          className="flex min-w-0 items-center gap-3 text-left"
          type="button"
          onClick={() => {
            if (!preferredPath) return;
            void onSelectEnvironment(project.id, preferredPath);
          }}
        >
          <LocalEnvironmentProjectIcon project={project} className="icon-sm shrink-0 text-token-text-secondary" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2 text-sm text-token-text-primary">
              <span className="truncate font-medium">{project.name}</span>
            </div>
            <span className="truncate text-xs text-token-text-secondary">
              {getPrimaryWorkspaceRoot(project) || "No source folder"}
            </span>
          </div>
        </button>
        <NodexButton
          variant="secondary"
          size="composer"
          className="w-9 justify-center px-0"
          aria-label="Add environment"
          onClick={() => {
            void onCreateEnvironment(project.id);
          }}
        >
          <Plus className="icon-sm" />
        </NodexButton>
      </div>

      {loading ? (
        <div className="border-t border-token-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-token-text-secondary">
            <SpinnerIcon className="icon-xs" />
            <span>Loading environment</span>
          </div>
        </div>
      ) : null}

      {!loading && hasError ? (
        <div className="border-t border-token-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-token-error-foreground">
            <span>Environment needs attention</span>
          </div>
        </div>
      ) : null}

      {!loading && !hasError && configs.length > 0 ? (
        <div className="border-t border-token-border">
          <div className="flex flex-col divide-y divide-token-border">
            {configs.map((config) => (
              <div
                key={config.configPath}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <button
                  className="flex min-w-0 flex-1 text-left"
                  type="button"
                  onClick={() => {
                    void onSelectEnvironment(project.id, config.configPath);
                  }}
                >
                  <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                    <span className={config.state === "success" ? "text-token-text-primary" : "text-token-error-foreground"}>
                      {configPrimaryLabel(config)}
                    </span>
                    {configSecondaryLabel(config) ? (
                      <span className="text-xs text-token-description-foreground">
                        {configSecondaryLabel(config)}
                      </span>
                    ) : null}
                  </div>
                </button>
                <NodexButton
                  size="composer"
                  onClick={() => {
                    void onSelectEnvironment(project.id, config.configPath);
                  }}
                >
                  View
                </NodexButton>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function LocalEnvironmentsBreadcrumb({
  projectName,
  mode,
  onBack,
}: {
  projectName: string;
  mode: Extract<LocalEnvironmentsPageMode, "summary" | "edit">;
  onBack: () => void;
}) {
  return (
    <nav className="flex items-center gap-2 text-sm text-token-text-secondary">
      <NodexButton
        variant="ghost"
        size="composer"
        onClick={onBack}
        className="gap-1 text-token-description-foreground"
      >
        <ChevronLeft className="icon-2xs" />
        Back
      </NodexButton>
      <div className="flex items-center gap-1">
        <span>Environments</span>
        <ChevronLeft className="icon-xs rotate-180 text-token-text-secondary" />
        <span className="text-token-text-primary">{projectName}</span>
        {mode === "edit" ? (
          <>
            <ChevronLeft className="icon-xs rotate-180 text-token-text-secondary" />
            <span>edit</span>
          </>
        ) : null}
      </div>
    </nav>
  );
}

export function LocalEnvironmentsSettingsPage({
  open,
  active,
  projects,
  activeProjectId,
  initialProjectId,
  initialConfigPath,
  onAddProject,
  renderShell,
  service = DEFAULT_LOCAL_ENVIRONMENTS_SETTINGS_SERVICE,
}: LocalEnvironmentsSettingsPageProps) {
  const workspaceProjects = useMemo(
    () => projects.filter((project) => getPrimaryWorkspaceRoot(project)),
    [projects],
  );
  const [mode, setMode] = useState<LocalEnvironmentsPageMode>("workspace");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<WorktreeEnvironmentSettingsSnapshot | null>(null);
  const [initialDraft, setInitialDraft] = useState<WorktreeEnvironmentDefinition | null>(null);
  const [draft, setDraft] = useState<WorktreeEnvironmentDefinition | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [initializedKey, setInitializedKey] = useState<string | null>(null);

  const selectedProject =
    workspaceProjects.find((project) => project.id === selectedProjectId)
    ?? null;
  const applySnapshot = useCallback((nextSnapshot: WorktreeEnvironmentSettingsSnapshot) => {
    const project =
      workspaceProjects.find((candidate) => candidate.id === nextSnapshot.projectId)
      ?? null;
    if (!project) return;

    const nextDraft = nextSnapshot.environment
      ? cloneEnvironmentDefinition(nextSnapshot.environment)
      : buildEmptyEnvironmentDefinition(project);

    startTransition(() => {
      setSelectedProjectId(project.id);
      setSnapshot(nextSnapshot);
      setInitialDraft(nextDraft);
      setDraft(cloneEnvironmentDefinition(nextDraft));
      setMode("summary");
      setErrorMessage(null);
    });
  }, [workspaceProjects]);

  const loadSnapshot = useCallback(async (projectId: string, configPath?: string | null) => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const nextSnapshot = await service.readConfig(projectId, configPath);
      applySnapshot(nextSnapshot);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not load local environment.");
    } finally {
      setLoading(false);
    }
  }, [applySnapshot, service]);

  useEffect(() => {
    if (!open || !active) return;

    const hasExplicitContext = Boolean(initialProjectId || initialConfigPath);
    const targetProjectId = hasExplicitContext
      ? (() => {
        if (initialProjectId && workspaceProjects.some((project) => project.id === initialProjectId)) {
          return initialProjectId;
        }
        if (workspaceProjects.some((project) => project.id === activeProjectId)) {
          return activeProjectId;
        }
        return workspaceProjects[0]?.id ?? null;
      })()
      : null;

    const nextKey = `${targetProjectId ?? "__none__"}::${initialConfigPath ?? ""}`;
    if (!targetProjectId) {
      if (initializedKey === nextKey) return;
      setInitializedKey(nextKey);
      setMode("workspace");
      setSelectedProjectId(null);
      setSnapshot(null);
      setInitialDraft(null);
      setDraft(null);
      setErrorMessage(null);
      return;
    }
    if (initializedKey === nextKey) return;

    setInitializedKey(nextKey);
    void loadSnapshot(targetProjectId, initialConfigPath);
  }, [
    active,
    activeProjectId,
    initialConfigPath,
    initialProjectId,
    initializedKey,
    loadSnapshot,
    open,
    workspaceProjects,
  ]);

  const normalizedDraft = draft ? normalizeEnvironmentForSave(draft) : null;
  const isDirty = normalizedDraft && initialDraft
    ? JSON.stringify(normalizedDraft) !== JSON.stringify(normalizeEnvironmentForSave(initialDraft))
    : false;
  const canSave = Boolean(
    selectedProjectId
    && snapshot
    && normalizedDraft
    && normalizedDraft.name.length > 0
    && isDirty
    && !saving,
  );

  async function handleSave() {
    if (!selectedProjectId || !snapshot || !normalizedDraft || normalizedDraft.name.length === 0) return;

    setSaving(true);
    setErrorMessage(null);

    try {
      const nextSnapshot = await service.saveConfig({
        projectId: selectedProjectId,
        configPath: snapshot.configPath,
        environment: normalizedDraft,
      });
      applySnapshot(nextSnapshot);
      setMode("summary");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save local environment.");
    } finally {
      setSaving(false);
    }
  }

  function handleOpenWorkspaceList() {
    setMode("workspace");
    setErrorMessage(null);
  }

  function handleEditCurrentEnvironment() {
    if (!draft) return;
    setMode("edit");
    setErrorMessage(null);
  }

  function handleCancelEdit() {
    if (!initialDraft) {
      setMode("summary");
      return;
    }

    setDraft(cloneEnvironmentDefinition(initialDraft));
    setMode("summary");
    setErrorMessage(null);
  }

  function updateScriptSection(
    key: "setup" | "cleanup",
    patch: Partial<WorktreeEnvironmentDefinition["setup"]>,
  ) {
    if (!draft) return;
    setDraft({
      ...draft,
      [key]: {
        ...draft[key],
        ...patch,
      },
    });
  }

  function updateAction(actionId: string, patch: Partial<WorktreeEnvironmentActionDefinition>) {
    if (!draft) return;
    setDraft({
      ...draft,
      actions: draft.actions.map((action) => (
        action.id === actionId
          ? { ...action, ...patch }
          : action
      )),
    });
  }

  function removeAction(actionId: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      actions: draft.actions.filter((action) => action.id !== actionId),
    });
  }

  function addAction() {
    if (!draft) return;
    setDraft({
      ...draft,
      actions: [...draft.actions, createActionDraft()],
    });
  }

  async function handleCreateEnvironmentForProject(projectId: string) {
    setLoading(true);
    setErrorMessage(null);

    try {
      const currentSnapshot = await service.readConfig(projectId, null);
      const nextSnapshot = currentSnapshot.configExists || currentSnapshot.configs.length > 0
        ? await service.readConfig(projectId, currentSnapshot.nextConfigPath)
        : currentSnapshot;
      applySnapshot(nextSnapshot);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not prepare a new local environment.");
    } finally {
      setLoading(false);
    }
  }

  const summaryEnvironment = snapshot?.environment ?? null;
  const shellSubtitle = mode === "workspace" ? (
    <>
      Local environments tell Codex how to set up worktrees for a project.{" "}
      <a
        className="inline-flex items-center gap-1 text-base text-token-text-link-foreground"
        href="https://developers.openai.com/codex/app/local-environments"
        target="_blank"
        rel="noreferrer"
      >
        Learn more.
      </a>
    </>
  ) : undefined;
  const shellBackSlot = (
    mode !== "workspace" && selectedProject
      ? (
        <LocalEnvironmentsBreadcrumb
          projectName={selectedProject.name}
          mode={mode}
          onBack={mode === "edit" ? handleCancelEdit : handleOpenWorkspaceList}
        />
      )
      : undefined
  );

  const content = (
    <div className="flex flex-col gap-[var(--padding-panel)]">
      {errorMessage ? (
        <div className="rounded-lg border border-(--red-text)/20 bg-(--red-text)/8 px-3 py-2 text-sm text-(--red-text)">
          {errorMessage}
        </div>
      ) : null}

      {mode === "workspace" ? (
        <PageSection
          title="Select a project"
          actions={(
            <NodexButton size="composer" onClick={onAddProject ?? (() => { })} disabled={!onAddProject}>
              Add project
            </NodexButton>
          )}
        >
          {workspaceProjects.length === 0 ? (
            <Panel>
              <div className="p-3 text-sm text-token-text-secondary">
                No projects yet. Add one to configure local environments.
              </div>
            </Panel>
          ) : (
            <div className="flex flex-col gap-3" role="list" aria-label="Available projects">
              {workspaceProjects.map((project) => (
                <WorkspaceProjectEnvironmentGroup
                  key={project.id}
                  project={project}
                  service={service}
                  onCreateEnvironment={handleCreateEnvironmentForProject}
                  onSelectEnvironment={async (projectId, configPath) => {
                    await loadSnapshot(projectId, configPath);
                  }}
                />
              ))}
            </div>
          )}
        </PageSection>
      ) : null}

      {mode !== "workspace" && loading ? (
        <PageSection title="Loading local environments">
          <Panel>
            <div className="flex items-center gap-2 p-3 text-sm text-token-text-secondary">
              <SpinnerIcon className="icon-xs" />
              Fetching your project configuration.
            </div>
          </Panel>
        </PageSection>
      ) : null}

      {mode === "summary" && snapshot && !loading && selectedProject ? (
        <div className="flex flex-col gap-[var(--padding-panel)]">
          <PageSection title="Project">
            <Panel>
              <div className="flex items-center gap-3 p-3">
                <LocalEnvironmentProjectIcon project={selectedProject} className="icon-sm shrink-0 text-token-text-secondary" />
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex min-w-0 items-center gap-1 text-sm text-token-text-primary">
                    <span className="truncate">{selectedProject.name}</span>
                  </div>
                  <span className="truncate text-xs text-token-text-secondary">
                    {getPrimaryWorkspaceRoot(selectedProject) || "No source folder"}
                  </span>
                </div>
              </div>
            </Panel>
          </PageSection>

          <PageSection title="Environment details">
            <div className="flex flex-col gap-[var(--padding-panel)]">
              <Panel>
                {summaryEnvironment ? (
                  <div className="flex items-center justify-between p-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="min-w-0 text-sm text-token-text-primary">Name</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm text-token-text-secondary">{summaryEnvironment.name}</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 text-sm text-token-text-secondary">
                    No local environment is configured for this project yet.
                  </div>
                )}
              </Panel>

              {summaryEnvironment ? (
                <>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-token-text-primary">Setup script</div>
                          <div className="text-sm text-token-text-secondary">This script will run on worktree creation.</div>
                        </div>
                      </div>
                    </div>
                    <MultiLineCodePreview
                      script={summaryEnvironment.setup.script}
                      emptyLabel="No setup script configured."
                    />
                    {hasPlatformOverrides(summaryEnvironment, "setup") ? (
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                          <div className="text-xs font-medium tracking-wide text-token-text-secondary uppercase">
                            Platform overrides
                          </div>
                          <div className="text-sm text-token-text-secondary">
                            Overrides the default script for specific OSes.
                          </div>
                        </div>
                        {PLATFORM_OPTIONS.map((platform) => {
                          const script = summaryEnvironment.setup.platformScripts[platform.value] ?? null;
                          if (!script) return null;
                          return (
                            <div key={platform.value} className="flex flex-col gap-2">
                              <div className="text-xs font-medium tracking-wide text-token-text-secondary uppercase">
                                {platform.label}
                              </div>
                              <MultiLineCodePreview script={script} emptyLabel="" />
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="text-sm font-medium text-token-text-primary">Cleanup script</div>
                      <div className="text-sm text-token-text-secondary">
                        This script will run before a worktree is deleted.
                      </div>
                    </div>
                    <MultiLineCodePreview
                      script={summaryEnvironment.cleanup.script}
                      emptyLabel="No cleanup script configured."
                    />
                    {hasPlatformOverrides(summaryEnvironment, "cleanup") ? (
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                          <div className="text-xs font-medium tracking-wide text-token-text-secondary uppercase">
                            Platform overrides
                          </div>
                          <div className="text-sm text-token-text-secondary">
                            Overrides the default cleanup script for specific OSes.
                          </div>
                        </div>
                        {PLATFORM_OPTIONS.map((platform) => {
                          const script = summaryEnvironment.cleanup.platformScripts[platform.value] ?? null;
                          if (!script) return null;
                          return (
                            <div key={platform.value} className="flex flex-col gap-2">
                              <div className="text-xs font-medium tracking-wide text-token-text-secondary uppercase">
                                {platform.label}
                              </div>
                              <MultiLineCodePreview script={script} emptyLabel="" />
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}

              {snapshot.parseErrorMessage ? (
                <div className="mt-2 text-sm text-token-error-foreground">
                  Unable to parse the existing file. Saving will overwrite it. ({snapshot.parseErrorMessage})
                </div>
              ) : null}
              {snapshot.readErrorMessage ? (
                <div className="mt-2 text-sm text-token-error-foreground">
                  Failed to load local environment data. ({snapshot.readErrorMessage})
                </div>
              ) : null}
              {snapshot.tooLargeMessage ? (
                <div className="mt-2 text-sm text-token-error-foreground">
                  Local environment file is too large to load. ({snapshot.tooLargeMessage})
                </div>
              ) : null}
            </div>
          </PageSection>

          <PageSection title="Actions">
            <div className="text-sm text-token-text-secondary">
              These actions can run any command and will be displayed in the header.
            </div>
            <Panel>
              <div className="flex flex-col gap-2 p-3">
                {(summaryEnvironment?.actions.length ?? 0) > 0 ? (
                  <div className="flex flex-col gap-2">
                    {(summaryEnvironment?.actions ?? []).map((action, index) => (
                      <div key={`${action.name}-${index}`} className="flex items-center gap-2 text-sm text-token-text-secondary">
                        <span className="text-token-text-secondary">
                          <ActionIconPreview icon={action.icon ?? "tool"} className="size-4" />
                        </span>
                        <span>{action.name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-token-text-secondary">
                    Add an action to run commands from the local toolbar.
                  </div>
                )}
              </div>
            </Panel>
          </PageSection>

          <div className="flex justify-end">
            <NodexButton variant="primary" size="composer" onClick={handleEditCurrentEnvironment}>
              {snapshot.configExists ? "Edit local environment" : "Create local environment"}
            </NodexButton>
          </div>
        </div>
      ) : null}

      {mode === "edit" && draft && snapshot && !loading && selectedProject ? (
        <form
          className="flex flex-col gap-[var(--padding-panel)]"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <PageSection title="Local environment file">
            <Panel>
              <div className="flex items-center gap-3 p-3">
                <LocalEnvironmentProjectIcon project={selectedProject} className="icon-sm shrink-0 text-token-text-secondary" />
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex min-w-0 items-center gap-1 text-sm text-token-text-primary">
                    <span className="truncate">{selectedProject.name}</span>
                  </div>
                  <span className="truncate text-xs text-token-text-secondary">
                    {getPrimaryWorkspaceRoot(selectedProject) || "No source folder"}
                  </span>
                </div>
              </div>
            </Panel>
            <div className="mt-2 truncate text-xs text-token-text-secondary">
              File: <span className="font-mono">{snapshot.configPath}</span>
            </div>
            {!snapshot.configExists ? (
              <div className="mt-1 text-sm text-token-text-secondary">
                Save to create this file for the first time.
              </div>
            ) : null}
            {snapshot.parseErrorMessage ? (
              <div className="mt-2 text-sm text-token-error-foreground">
                Unable to parse the existing file. Saving will overwrite it. ({snapshot.parseErrorMessage})
              </div>
            ) : null}
            {snapshot.readErrorMessage ? (
              <div className="mt-2 text-sm text-token-error-foreground">
                Failed to load local environment data. ({snapshot.readErrorMessage})
              </div>
            ) : null}
            {snapshot.tooLargeMessage ? (
              <div className="mt-2 text-sm text-token-error-foreground">
                Local environment file is too large to load. ({snapshot.tooLargeMessage})
              </div>
            ) : null}
          </PageSection>

          <PageSection title="Environment details">
            <div className="flex flex-col gap-[var(--padding-panel)]">
              <Panel>
                <div className="flex items-center justify-between p-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="min-w-0 text-token-text-primary text-sm">Name</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="w-72">
                      <Input
                        id="local-environment-name"
                        value={draft.name}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      />
                    </div>
                  </div>
                </div>
              </Panel>

              <CodexScriptEditorPanels
                title="Setup script"
                description="This script will run on worktree creation."
                value={draft.setup.script}
                onChange={(value) => updateScriptSection("setup", { script: value })}
                scriptHint="Runs in the project root."
                addOverrideLabel={(platform) => `Add ${platform} setup script`}
                removeOverrideLabel="Remove"
                actions={<SetupEnvironmentVariablesButton />}
                platformScripts={draft.setup.platformScripts}
                onPlatformScriptChange={(platform, value) => {
                  const nextPlatformScripts = { ...draft.setup.platformScripts };
                  if (value === null) delete nextPlatformScripts[platform];
                  else nextPlatformScripts[platform] = value;
                  updateScriptSection("setup", { platformScripts: nextPlatformScripts });
                }}
              />
            </div>
          </PageSection>

          <PageSection title="Cleanup script">
            <CodexScriptEditorPanels
              title="Cleanup script"
              description="This script will run before a worktree is deleted."
              showHeader={false}
              value={draft.cleanup.script}
              onChange={(value) => updateScriptSection("cleanup", { script: value })}
              scriptHint="Runs in the project root just before cleanup."
              addOverrideLabel={(platform) => `Add ${platform} cleanup script`}
              removeOverrideLabel="Remove"
              platformScripts={draft.cleanup.platformScripts}
              onPlatformScriptChange={(platform, value) => {
                const nextPlatformScripts = { ...draft.cleanup.platformScripts };
                if (value === null) delete nextPlatformScripts[platform];
                else nextPlatformScripts[platform] = value;
                updateScriptSection("cleanup", { platformScripts: nextPlatformScripts });
              }}
            />
          </PageSection>

          <PageSection
            title="Actions"
            actions={(
              <NodexButton size="composer" onClick={addAction}>
                Add action
              </NodexButton>
            )}
          >
            <div className="text-sm text-token-text-secondary">
              These actions can run any command and will be displayed in the header.
            </div>
            <CodexActionsEditorSection
              actions={draft.actions}
              onUpdate={updateAction}
              onRemove={removeAction}
            />
          </PageSection>

          <div className="flex justify-end">
            <NodexButton
              variant="primary"
              size="composer"
              onClick={() => {
                void handleSave();
              }}
              disabled={!canSave}
            >
              {saving ? (
                <>
                  <SpinnerIcon className="size-4" />
                  Saving…
                </>
              ) : "Save"}
            </NodexButton>
          </div>
        </form>
      ) : null}
    </div>
  );

  if (renderShell) {
    return renderShell({
      title: "Environments",
      subtitle: shellSubtitle,
      backSlot: shellBackSlot,
      children: content,
    });
  }

  return content;
}
