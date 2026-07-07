import { useState } from "react";
import type { ReactNode } from "react";

/**
 * Minimal fixed-row-height windowed list — renders only the rows in view (+ overscan), so an
 * inventory of thousands of rows stays smooth. Hand-rolled to hold the zero-new-dependencies
 * rail; uniform row height is all the inventory needs.
 */
export interface VirtualListProps<T> {
  items: T[];
  rowHeight: number;
  height: number;
  renderRow: (item: T, index: number) => ReactNode;
  keyOf: (item: T, index: number) => string;
}

export function VirtualList<T>({ items, rowHeight, height, renderRow, keyOf }: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const overscan = 4;
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(height / rowHeight) + overscan * 2;
  const last = Math.min(items.length, first + visibleCount);

  const rows: ReactNode[] = [];
  for (let index = first; index < last; index++) {
    const item = items[index];
    rows.push(
      <div
        key={keyOf(item, index)}
        style={{ position: "absolute", top: index * rowHeight, left: 0, right: 0, height: rowHeight }}
      >
        {renderRow(item, index)}
      </div>,
    );
  }

  return (
    <div
      className="vlist"
      style={{ height, overflowY: "auto" }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: items.length * rowHeight, position: "relative" }}>{rows}</div>
    </div>
  );
}
