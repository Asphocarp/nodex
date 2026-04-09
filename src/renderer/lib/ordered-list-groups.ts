export interface OrderedListGroup<T> {
  digits: number;
  items: T[];
  start: number;
}

export function resolveOrderedListPadding(digits: number): string {
  if (digits <= 2) return "pl-8";
  if (digits === 3) return "pl-10";
  if (digits === 4) return "pl-12";
  return "pl-14";
}

export function resolveOrderedListMargin(index: number, total: number): string {
  if (total <= 1) return "mt-1.5 mb-3";
  if (index === 0) return "mt-1.5 mb-0";
  if (index === total - 1) return "mt-0 mb-3";
  return "my-0";
}

export function groupOrderedListItems<T>(
  items: T[],
  resolveStart: (item: T, index: number) => number,
): OrderedListGroup<T>[] {
  const groups: OrderedListGroup<T>[] = [];

  items.forEach((item, index) => {
    const start = resolveStart(item, index);
    const digits = String(start).length;
    const previousGroup = groups.at(-1);

    if (!previousGroup || previousGroup.digits !== digits) {
      groups.push({
        digits,
        items: [item],
        start,
      });
      return;
    }

    previousGroup.items.push(item);
  });

  return groups;
}
