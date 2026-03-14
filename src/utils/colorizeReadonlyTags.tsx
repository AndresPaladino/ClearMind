import { Children, type ReactNode } from "react";
import { getTagColorToken, type ColorTheme } from "./tagColors";

const TEXT_COLORIZE_CACHE_LIMIT = 600;
const textColorizeCache = new Map<string, ReactNode[]>();

export function colorizeReadonlyTags(
  node: ReactNode,
  theme: ColorTheme,
  keyPrefix = "tag"
): ReactNode {
  const source = Children.toArray(node);
  const out: ReactNode[] = [];

  source.forEach((child, childIndex) => {
    if (typeof child !== "string") {
      out.push(child);
      return;
    }

    if (!child.includes("#")) {
      out.push(child);
      return;
    }

    const cacheKey = `${theme}|${child}`;
    const cached = textColorizeCache.get(cacheKey);
    if (cached) {
      out.push(...cached);
      return;
    }

    const regex = /#([a-zA-Z][a-zA-Z0-9_-]*)/g;
    let cursor = 0;
    let partIndex = 0;
    let match: RegExpExecArray | null;
    const parsed: ReactNode[] = [];

    while ((match = regex.exec(child)) !== null) {
      const at = match.index;
      if (at > 0 && child[at - 1] === "#") continue;

      if (at > cursor) {
        parsed.push(child.slice(cursor, at));
      }

      const tag = `#${match[1]}`;
      const token = getTagColorToken(tag, theme);
      parsed.push(
        <span
          key={`${keyPrefix}-${childIndex}-${partIndex}`}
          className="entry-inline-tag"
          style={{ color: token.text, backgroundColor: token.bg }}
        >
          {tag}
        </span>
      );

      cursor = at + tag.length;
      partIndex += 1;
    }

    if (cursor < child.length) {
      parsed.push(child.slice(cursor));
    }

    if (textColorizeCache.size >= TEXT_COLORIZE_CACHE_LIMIT) {
      const oldest = textColorizeCache.keys().next().value;
      if (oldest) textColorizeCache.delete(oldest);
    }
    textColorizeCache.set(cacheKey, parsed);
    out.push(...parsed);
  });

  return out;
}
