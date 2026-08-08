import { toast } from "@/components/ui/toast";
import { writeTextToClipboard } from "@/lib/clipboard";

/** Copies the human Page alias with one product-wide feedback contract. */
export async function copyPageKeyWithFeedback(pageKey: string): Promise<boolean> {
  const copied = await writeTextToClipboard(pageKey);
  if (copied) {
    toast.success("Copied Page key");
    return true;
  }

  toast.danger("Failed to copy Page key");
  return false;
}
