import { useEffect, useState } from "react";

export function usePortalHost(id: string): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(() => {
    if (typeof document === "undefined") return null;
    return document.getElementById(id);
  });

  useEffect(() => {
    if (typeof document === "undefined") return;

    const resolveHost = () => {
      setHost(document.getElementById(id));
    };

    resolveHost();

    const observer = new MutationObserver(() => {
      resolveHost();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
    };
  }, [id]);

  return host;
}
