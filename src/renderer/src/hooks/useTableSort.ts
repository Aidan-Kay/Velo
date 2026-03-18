import { useState } from "react";

export function useTableSort<T extends string>(defaultColumn?: T, defaultDirection: "asc" | "desc" = "asc") {
  const [sortColumn, setSortColumn] = useState<T | null>(defaultColumn ?? null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(defaultDirection);

  const handleSort = (column: T) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  return { sortColumn, sortDirection, handleSort };
}
