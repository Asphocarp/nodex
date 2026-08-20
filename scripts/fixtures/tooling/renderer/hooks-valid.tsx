import { useState } from "react";

export function ValidHooksFixture({ enabled }: { enabled: boolean }) {
  const [value] = useState(0);
  if (!enabled) return null;
  return <span>{value}</span>;
}
