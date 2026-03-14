/**
 * Extract hashtags from entry content.
 * Matches #word (letter-start, no space) — excludes markdown headings (# Heading)
 * and double-hashes (## Heading).
 * Returns unique tags in order of first appearance, lowercased, with the # prefix.
 */
export function extractTags(content: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  const regex = /#([a-zA-Z][a-zA-Z0-9_-]*)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    // Skip if preceded by another # (e.g. ## Heading)
    if (match.index > 0 && content[match.index - 1] === "#") continue;

    const tag = `#${match[1].toLowerCase()}`;
    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }

  return tags;
}
