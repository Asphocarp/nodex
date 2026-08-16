import { PageIcon } from "@/components/shared/icons";
import {
  MentionInlineVisual,
  type MentionInlineVisualProps,
} from "./mention-inline-visual";

export type PageMentionInlineVisualProps =
  & MentionInlineVisualProps
  & { readonly withGuards?: boolean };

export function PageMentionInlineVisual(props: PageMentionInlineVisualProps) {
  return (
    <MentionInlineVisual
      {...props}
      kind="page"
      icon={props.icon ?? <PageIcon className="size-full" />}
    />
  );
}
