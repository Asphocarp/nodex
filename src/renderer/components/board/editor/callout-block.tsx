import { createReactBlockSpec } from "@blocknote/react";
import { calloutBlockConfig } from "../../../../shared/block-documents/blocknote-schema-config";

export const createCalloutBlock = createReactBlockSpec(calloutBlockConfig, {
  render: (props) => {
    return (
      <div
        className="nfm-callout-content"
        style={{
          display: "flex",
          gap: "8px",
        }}
      >
        <span
          className="nfm-callout-icon"
          contentEditable={false}
          style={{ fontSize: "1.2em", userSelect: "none" }}
        >
          {props.block.props.icon}
        </span>
        <div ref={props.contentRef} style={{ flex: 1, minWidth: 0 }} />
      </div>
    );
  },
});
