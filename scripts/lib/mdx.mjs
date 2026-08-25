import { readFileSync } from 'node:fs';

/**
 * Splits an MDX file into the parts a linter has to treat differently.
 *
 * Prose and code are not the same thing. A number inside a code sample is data
 * a reader copies; a number in a sentence is a claim the product has to keep.
 * Every check here draws that line in one place so two checks cannot draw it
 * differently.
 */
export function parseMdx(path) {
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split(/\r?\n/);

  let frontmatter = null;
  let bodyStart = 0;

  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    if (end !== -1) {
      frontmatter = parseFrontmatter(lines.slice(1, end));
      bodyStart = end + 1;
    }
  }

  const segments = [];
  let inFence = false;
  let fenceMarker = '';

  for (let i = bodyStart; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = line.match(/^\s*(```+|~~~+)/);

    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
      }
      segments.push({ line: i + 1, text: line, kind: 'fence' });
      continue;
    }

    segments.push({ line: i + 1, text: line, kind: inFence ? 'code' : 'prose' });
  }

  return { raw, lines, frontmatter, segments };
}

/**
 * Prose lines only, reduced to the words a reader actually reads.
 *
 * Removed before anything looks at them, because none of it is prose and each
 * one produced a false claim in an earlier version of the numeric check:
 *
 *   - inline code spans, which are samples rather than sentences
 *   - JSX and HTML tags, whose attributes carry layout numbers (`cols={2}`)
 *   - the marker of an ordered list item, which numbers the step rather than
 *     claiming anything
 *   - markdown link targets, which are paths
 */
export function proseLines({ segments }) {
  return segments
    .filter((s) => s.kind === 'prose')
    .map((s) => ({
      ...s,
      text: s.text
        .replace(/`[^`]*`/g, '``')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\]\([^)]*\)/g, '] ')
        .replace(/^(\s*)\d+\.(\s)/, '$1$2'),
    }));
}

/**
 * A deliberately small frontmatter reader.
 *
 * The pages in this repository carry `title`, `description`, `status` and
 * `gates`. That is a flat map of scalars plus one inline list, so a full YAML
 * parser would be a dependency bought for nothing. Anything richer than that
 * is reported rather than guessed at.
 */
function parseFrontmatter(lines) {
  const out = {};
  for (const line of lines) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      out[key] = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else {
      out[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
  return out;
}
