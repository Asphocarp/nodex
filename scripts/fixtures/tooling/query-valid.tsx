import { useQuery } from "@tanstack/react-query";

declare function loadRecord(id: string): Promise<string>;

export function ValidQueryFixture({ id }: { id: string }) {
  useQuery({
    queryKey: ["tooling-fixture", id],
    queryFn: () => loadRecord(id),
  });
  return null;
}
