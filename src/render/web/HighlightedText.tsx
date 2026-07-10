/**
 * web/HighlightedText: render a label with the matched query substring(s) wrapped in <mark>.
 * Thin presentational shell over the pure `matchSegments`. No-op (plain text) when query is empty.
 */
import { Fragment } from "react";
import { matchSegments } from "./search-match.js";

export function HighlightedText({ text, query }: { text: string; query: string }) {
  const segments = matchSegments(text, query);
  return (
    <>
      {segments.map((seg, i) =>
        seg.hit ? (
          <mark key={i} className="search-hit">
            {seg.text}
          </mark>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </>
  );
}
