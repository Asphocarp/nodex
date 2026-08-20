import { useQuery } from "@tanstack/react-query";

declare function loadRecord(id: string): Promise<string>;

export function InvalidQueryFixture({ id }: { id: string }) {
  useQuery({
    queryKey: ["tooling-fixture"],
    queryFn: () => loadRecord(id),
  });
  return null;
}
