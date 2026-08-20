import { useState } from "react";

export function InvalidHooksFixture({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  const [value] = useState(0);
  return <span>{value}</span>;
}
