import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_CODEX_HOST_ID } from "../../../../../shared/codex-host";
import { buildFileUrl } from "../../../../../shared/file-link-openers";
import {
  codexConversationImageAssetQueryOptions,
  isCodexImageAssetPointer,
  parseAbsoluteImagePath,
} from "../../../../lib/codex-conversation-image-assets";
import { workspaceFileBinaryQueryOptions } from "../../../../lib/query-options";
import { resolveAssetSourceToHttpUrl } from "../../../../lib/assets";
import { useConversationImageAssetContext } from "../conversation-image-asset-context";

interface ConversationImageAssetResolution {
  dataUrl: string | null;
  downloadSrc: string | null;
  isError: boolean;
  isLoading: boolean;
  previewSrc: string | null;
  refetch: () => void;
}

function buildDataUrl(dataBase64: string, mimeType: string | null): string {
  return `data:${mimeType?.trim() || "application/octet-stream"};base64,${dataBase64}`;
}

function normalizeDirectImageSource(source: string): string {
  return source.startsWith("nodex://assets/") ? resolveAssetSourceToHttpUrl(source) : source;
}

function useAssetObjectUrl(blob: Blob | null): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob || typeof URL.createObjectURL !== "function") {
      setObjectUrl(null);
      return;
    }

    const nextObjectUrl = URL.createObjectURL(blob);
    setObjectUrl(nextObjectUrl);
    return () => {
      window.setTimeout(() => URL.revokeObjectURL(nextObjectUrl), 0);
    };
  }, [blob]);

  return objectUrl;
}

export function useConversationImageAsset(
  rawSource: string,
  options: { shouldLoadFileDataUrl: boolean },
): ConversationImageAssetResolution {
  const { hostId } = useConversationImageAssetContext();
  const source = rawSource.trim();
  const pointer = isCodexImageAssetPointer(source) ? source : "";
  const absolutePath = parseAbsoluteImagePath(source);
  const isLocalHost = hostId === DEFAULT_CODEX_HOST_ID;
  const localDisplaySrc = isLocalHost && absolutePath
    ? buildFileUrl({ path: absolutePath })
    : null;

  const pointerQuery = useQuery({
    ...codexConversationImageAssetQueryOptions(pointer),
    enabled: pointer.length > 0 && isLocalHost,
  });
  const pointerObjectUrl = useAssetObjectUrl(pointerQuery.data?.blob ?? null);
  const pointerPreviewSrc = pointerQuery.data
    ? pointerObjectUrl ?? pointerQuery.data.dataUrl
    : null;

  const shouldReadLocalFile = Boolean(
    absolutePath
    && isLocalHost
    && (localDisplaySrc === null || options.shouldLoadFileDataUrl),
  );
  const localFileQuery = useQuery({
    ...workspaceFileBinaryQueryOptions({
      hostId: "local",
      path: absolutePath ?? "",
    }),
    enabled: shouldReadLocalFile,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const localDataUrl = localFileQuery.data
    && localFileQuery.data.contentsBase64
    ? buildDataUrl(localFileQuery.data.contentsBase64, localFileQuery.data.mimeType ?? null)
    : null;
  const directSource = absolutePath === null && pointer.length === 0 && source.length > 0
    ? normalizeDirectImageSource(source)
    : null;
  const previewSrc = pointerPreviewSrc ?? localDisplaySrc ?? directSource ?? localDataUrl;
  const dataUrl = pointerQuery.data?.dataUrl
    ?? localDataUrl
    ?? (source.startsWith("data:image/") ? source : null);

  return {
    dataUrl,
    downloadSrc: localDataUrl ?? previewSrc,
    isError: (pointer.length > 0 && isLocalHost && pointerQuery.isError)
      || (shouldReadLocalFile && localFileQuery.isError),
    isLoading: (pointer.length > 0 && isLocalHost && pointerQuery.isPending)
      || (shouldReadLocalFile && localFileQuery.isPending),
    previewSrc,
    refetch: () => {
      if (pointer.length > 0 && isLocalHost) {
        void pointerQuery.refetch();
        return;
      }
      if (shouldReadLocalFile) void localFileQuery.refetch();
    },
  };
}
