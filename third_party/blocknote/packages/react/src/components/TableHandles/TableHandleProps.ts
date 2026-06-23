import { FC } from "react";
import { TableHandleMenuProps } from "./TableHandleMenu/TableHandleMenuProps.js";

export type TableHandleProps = {
  orientation: "row" | "column";
  hideOtherElements: (hide: boolean) => void;
  tableHandleMenu?: FC<TableHandleMenuProps>;
};
