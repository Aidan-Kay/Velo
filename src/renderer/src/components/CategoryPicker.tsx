import React, { useEffect, useMemo, useState } from "react";
import type { CategoryNode } from "../../../shared/types";
import { Input } from "./ui/input";

interface CategoryPickerProps {
  categories: CategoryNode[];
  selectedId: number | null;
  onSelect: (categoryId: number, path: string) => void;
  loading?: boolean;
}

/** Flatten category tree for search */
function flattenCategories(nodes: CategoryNode[], parentPath = ""): Array<{ node: CategoryNode; fullPath: string }> {
  const result: Array<{ node: CategoryNode; fullPath: string }> = [];
  for (const node of nodes) {
    const fullPath = parentPath ? `${parentPath} > ${node.title}` : node.title;
    // Only add leaf nodes or nodes that can be selected
    if (node.catalogs.length === 0) {
      result.push({ node, fullPath });
    } else {
      // Include parent categories too since they may be selectable
      result.push({ node, fullPath });
      result.push(...flattenCategories(node.catalogs, fullPath));
    }
  }
  return result;
}

const CategoryPicker: React.FC<CategoryPickerProps> = ({ categories, selectedId, onSelect, loading }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [breadcrumb, setBreadcrumb] = useState<CategoryNode[]>([]);

  // Current level of categories to display
  const currentLevel = useMemo(() => {
    if (breadcrumb.length === 0) return categories;
    const last = breadcrumb[breadcrumb.length - 1];
    return last.catalogs || [];
  }, [categories, breadcrumb]);

  // Memoize the flattened tree separately from search filtering
  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);

  // Flat search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    return flatCategories
      .filter(({ node, fullPath }) => node.title.toLowerCase().includes(q) || fullPath.toLowerCase().includes(q))
      .slice(0, 50);
  }, [flatCategories, searchQuery]);

  // Reset breadcrumb when categories change
  useEffect(() => {
    setBreadcrumb([]);
  }, [categories]);

  const handleCategoryClick = (cat: CategoryNode) => {
    if (cat.catalogs.length > 0) {
      // Navigate deeper
      setBreadcrumb((prev) => [...prev, cat]);
    } else {
      // Leaf node - select it
      const path = [...breadcrumb.map((b) => b.title), cat.title].join(" > ");
      onSelect(cat.id, path);
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    setBreadcrumb((prev) => prev.slice(0, index));
  };

  const handleSearchSelect = (cat: CategoryNode, fullPath: string) => {
    onSelect(cat.id, fullPath);
    setSearchQuery("");
  };

  if (loading) {
    return <div className="text-muted-foreground text-xs py-4 text-center">Loading categories…</div>;
  }

  return (
    <div className="space-y-2">
      {/* Search */}
      <Input type="text" placeholder="Search categories…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />

      {/* Search results */}
      {searchResults ? (
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {searchResults.length === 0 ? (
            <div className="text-neutral-500 text-xs py-2 text-center">No categories found</div>
          ) : (
            searchResults.map(({ node, fullPath }) => (
              <button
                key={node.id}
                onClick={() => handleSearchSelect(node, fullPath)}
                className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors ${
                  selectedId === node.id ? "bg-accent-500/20 text-accent-300" : "text-neutral-300 hover:bg-neutral-700"
                }`}
              >
                <span className="text-neutral-500">{fullPath.replace(` > ${node.title}`, "")} &gt; </span>
                <span className="font-medium">{node.title}</span>
              </button>
            ))
          )}
        </div>
      ) : (
        <>
          {/* Breadcrumb */}
          {breadcrumb.length > 0 && (
            <div className="flex items-center gap-1 text-xs flex-wrap">
              <button onClick={() => handleBreadcrumbClick(0)} className="text-accent-300 hover:underline">
                All
              </button>
              {breadcrumb.map((bc, i) => (
                <React.Fragment key={bc.id}>
                  <span className="text-neutral-600">&gt;</span>
                  <button
                    onClick={() => handleBreadcrumbClick(i + 1)}
                    className={i === breadcrumb.length - 1 ? "text-foreground" : "text-accent-300 hover:underline"}
                  >
                    {bc.title}
                  </button>
                </React.Fragment>
              ))}
              {/* Allow selecting current breadcrumb level if it has children */}
              {breadcrumb.length > 0 && (
                <button
                  onClick={() => {
                    const last = breadcrumb[breadcrumb.length - 1];
                    const path = breadcrumb.map((b) => b.title).join(" > ");
                    onSelect(last.id, path);
                  }}
                  className="ml-2 text-accent-300 text-xs hover:underline"
                >
                  Select this category
                </button>
              )}
            </div>
          )}

          {/* Category list */}
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {currentLevel.length === 0 ? (
              <div className="text-neutral-500 text-xs py-2 text-center">No subcategories</div>
            ) : (
              currentLevel.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => handleCategoryClick(cat)}
                  className={`w-full text-left px-3 py-1.5 rounded text-xs flex items-center justify-between transition-colors ${
                    selectedId === cat.id ? "bg-accent-500/20 text-accent-300" : "text-neutral-300 hover:bg-neutral-700"
                  }`}
                >
                  <span>{cat.title}</span>
                  {cat.catalogs.length > 0 && <span className="text-neutral-600">&gt;</span>}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default CategoryPicker;
