/**
 * web/search-match: split a label into matched / unmatched runs for a query. PURE, DOM-free.
 *
 * The ranked search (see indexes.ts) tells you WHICH nodes matched; this tells you WHERE, so a
 * result row can show why it matched. Case-insensitive, marks EVERY occurrence of the query
 * substring. An id-only match (query absent from the name) yields one unmatched run — nothing lit.
 */

export interface MatchSegment {
  text: string;
  /** True when this run is a literal occurrence of the query. */
  hit: boolean;
}

export function matchSegments(text: string, query: string): MatchSegment[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, hit: false }];
  const hay = text.toLowerCase();
  const out: MatchSegment[] = [];
  let i = 0;
  for (;;) {
    const at = hay.indexOf(q, i);
    if (at === -1) {
      if (i < text.length) out.push({ text: text.slice(i), hit: false });
      break;
    }
    if (at > i) out.push({ text: text.slice(i, at), hit: false });
    out.push({ text: text.slice(at, at + q.length), hit: true });
    i = at + q.length;
  }
  return out.length > 0 ? out : [{ text, hit: false }];
}
