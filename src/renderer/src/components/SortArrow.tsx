interface SortArrowProps<T extends string> {
  column: T;
  sortColumn: T | null;
  sortDirection: "asc" | "desc";
}

export function SortArrow<T extends string>({ column, sortColumn, sortDirection }: SortArrowProps<T>) {
  if (column !== sortColumn) return <span className="ml-1 text-muted-foreground">⇅</span>;
  return <span className="ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>;
}
