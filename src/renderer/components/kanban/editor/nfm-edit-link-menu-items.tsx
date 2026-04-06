import { LinkToolbarExtension } from "@blocknote/core/extensions";
import { ChangeEvent, KeyboardEvent, useCallback, useEffect, useState } from "react";
import { Link, Type } from "lucide-react";
import { useComponentsContext } from "@blocknote/react";
import { useExtension } from "@blocknote/react";
import { useDictionary } from "@blocknote/react";
import type { LinkToolbarProps } from "@blocknote/react";
import { normalizeNfmEditorLinkUrl } from "./nfm-link-url";

export function NfmEditLinkMenuItems(
  props: Pick<
    LinkToolbarProps,
    "url" | "text" | "range" | "setToolbarOpen" | "setToolbarPositionFrozen"
  > & {
    showTextField?: boolean;
  },
) {
  const Components = useComponentsContext()!;
  const dict = useDictionary();
  const { editLink } = useExtension(LinkToolbarExtension);
  const { url, text, showTextField } = props;

  const [currentUrl, setCurrentUrl] = useState<string>(url);
  const [currentText, setCurrentText] = useState<string>(text);

  useEffect(() => {
    setCurrentUrl(url);
    setCurrentText(text);
  }, [text, url]);

  const submit = useCallback(() => {
    const normalizedUrl = normalizeNfmEditorLinkUrl(currentUrl);
    if (!normalizedUrl) return;

    editLink(normalizedUrl, currentText, props.range.from);
    props.setToolbarOpen?.(false);
    props.setToolbarPositionFrozen?.(false);
  }, [currentText, currentUrl, editLink, props]);

  const handleEnter = useCallback((event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }, [submit]);

  const handleUrlChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setCurrentUrl(event.currentTarget.value);
  }, []);

  const handleTextChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setCurrentText(event.currentTarget.value);
  }, []);

  return (
    <Components.Generic.Form.Root>
      <Components.Generic.Form.TextInput
        className={"bn-text-input"}
        name="url"
        icon={<Link />}
        autoFocus={true}
        placeholder={dict.link_toolbar.form.url_placeholder}
        value={currentUrl}
        onKeyDown={handleEnter}
        onChange={handleUrlChange}
        onSubmit={submit}
      />
      {showTextField !== false && (
        <Components.Generic.Form.TextInput
          className={"bn-text-input"}
          name="title"
          icon={<Type />}
          placeholder={dict.link_toolbar.form.title_placeholder}
          value={currentText}
          onKeyDown={handleEnter}
          onChange={handleTextChange}
          onSubmit={submit}
        />
      )}
    </Components.Generic.Form.Root>
  );
}
