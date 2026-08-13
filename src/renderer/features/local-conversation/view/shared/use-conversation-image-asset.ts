import {
  useResolvedImageAsset,
  type ResolvedImageAsset,
} from "@/features/user-attachment-image-editor";
import { useConversationImageAssetContext } from "../conversation-image-asset-context";

export type ConversationImageAssetResolution = Omit<ResolvedImageAsset, "error" | "localPath" | "materialize">;

export function useConversationImageAsset(
  rawSource: string,
  options: { shouldLoadFileDataUrl: boolean },
): ConversationImageAssetResolution {
  const { hostId } = useConversationImageAssetContext();
  const asset = useResolvedImageAsset(rawSource, {
    hostId,
    allowLocalPath: true,
    materialize: options.shouldLoadFileDataUrl,
  });

  return {
    dataUrl: asset.dataUrl,
    downloadSrc: asset.downloadSrc,
    isError: asset.isError,
    isLoading: asset.isLoading,
    previewSrc: asset.previewSrc,
    refetch: asset.refetch,
  };
}
