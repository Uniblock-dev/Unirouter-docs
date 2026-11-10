#!/usr/bin/env node
/**
 * Page tone and word budgets (AGENTS.md, "Page tone and budgets").
 *
 * Warnings only. This check never fails the build, because a budget is a
 * prompt to cut, not a defect. It prints a WARN line for:
 *
 *   - a navigation page whose body is over its word budget
 *     (get-started/quickstart: 500 words; every other page: 1,200)
 *   - a <FeatureStatus> tag on a Get started page or index.mdx, because gating
 *     belongs in frontmatter `gates:` and the release checklist, not in prose
 *
 * The body is what follows the frontmatter, with fenced code blocks removed.
 * JSX and HTML tags are not words, so they are stripped before counting.
 *
 *   node scripts/check-page-budget.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectNavPages } from './lib/navigation.mjs';
import { REPO_ROOT, paths } from './lib/paths.mjs';
import { parseMdx } from './lib/mdx.mjs';

const BUDGETS = new Map([['get-started/quickstart.mdx', 500]]);
const DEFAULT_BUDGET = 1200;

const GATED_FOLDER = 'get-started/';
const GATED_PAGE = 'index.mdx';
const FEATURE_STATUS = /<FeatureStatus\b/;

const docs = JSON.parse(readFileSync(paths.docsJson, 'utf8'));
const pages = [...new Set(collectNavPages(docs.navigation))];

const files = pages
  .map((page) => join(REPO_ROOT, `${page}.mdx`))
  .filter((file) => {
    const rel = relative(REPO_ROOT, file).split('\\').join('/');
    if (rel.startsWith('node_modules/') || rel.startsWith('snippets/') || rel.startsWith('worktrees/')) {
      return false;
    }
    return existsSync(file);
  });

let warnings = 0;

function warn(where, message) {
  warnings += 1;
  console.log(`WARN  ${where}: ${message}`);
}

function countWords(segments) {
  let words = 0;
  for (const segment of segments) {
    if (segment.kind !== 'prose') continue;
    const text = segment.text.replace(/<[^>]*>/g, ' ');
    words += text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
  }
  return words;
}

for (const file of files) {
  const rel = relative(REPO_ROOT, file).split('\\').join('/');
  const parsed = parseMdx(file);

  const budget = BUDGETS.get(rel) ?? DEFAULT_BUDGET;
  const words = countWords(parsed.segments);
  if (words > budget) {
    warn(rel, `${words} words, over the ${budget}-word budget`);
  }

  if (rel.startsWith(GATED_FOLDER) || rel === GATED_PAGE) {
    for (const segment of parsed.segments) {
      if (segment.kind === 'prose' && FEATURE_STATUS.test(segment.text)) {
        warn(
          `${rel}:${segment.line}`,
          `<FeatureStatus> on a Get started page; move the gate to frontmatter \`gates:\` and the release checklist`
        );
      }
    }
  }
}

console.log(`OK  check-page-budget (${warnings} warning${warnings === 1 ? '' : 's'}, warnings only)`);
// Always exit 0: budgets and tone rules are warnings, never failures.
