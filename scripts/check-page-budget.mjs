#!/usr/bin/env node
/**
 * Page types, required headings and word budgets (AGENTS.md, "Adding a page").
 *
 * Warnings only. This check never fails the build, because a type, a heading
 * or a budget is a prompt to fix, not a defect. It prints a WARN line for:
 *
 *   - a navigation page with no `type:` in its frontmatter
 *   - a page whose `type:` has no template in templates/
 *   - a page missing one of its template's `##` headings, or with them out of order
 *   - a page whose body is over its type's soft word budget
 *   - a <FeatureStatus> tag on a Get started page or index.mdx, because gating
 *     belongs in frontmatter `gates:` and the release checklist, not in prose
 *
 * A template is templates/<type>.mdx. Its `##` headings are the headings the
 * type requires, in order, and its "Soft word budget: N words" comment is the
 * budget. Templates are not pages: they are never published (.mintignore) and
 * never walked by the other checks.
 *
 * The body is what follows the frontmatter, with fenced code blocks and MDX
 * comments removed. JSX and HTML tags are not words, so they are stripped too.
 *
 *   node scripts/check-page-budget.mjs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { collectNavPages } from './lib/navigation.mjs';
import { REPO_ROOT, paths } from './lib/paths.mjs';
import { parseMdx } from './lib/mdx.mjs';

const TEMPLATES_DIR = join(REPO_ROOT, 'templates');
const BUDGET_COMMENT = /Soft word budget:\s*([\d,]+)\s*words/;
const MDX_COMMENT = /\{\/\*[\s\S]*?\*\/\}/g;
const HEADING = /^## (.+?)\s*$/;

const GATED_FOLDER = 'get-started/';
const GATED_PAGE = 'index.mdx';
const FEATURE_STATUS = /<FeatureStatus\b/;

let warnings = 0;

function warn(where, message) {
  warnings += 1;
  console.log(`WARN  ${where}: ${message}`);
}

// Prose text of a parsed page, with fences and MDX comments removed.
function proseText(parsed) {
  return parsed.segments
    .filter((segment) => segment.kind === 'prose')
    .map((segment) => segment.text)
    .join('\n')
    .replace(MDX_COMMENT, '');
}

// `##` headings in order, outside code fences and MDX comments.
function headingsOf(parsed) {
  return parsed.segments
    .filter((segment) => segment.kind === 'prose')
    .map((segment) => segment.text.replace(MDX_COMMENT, '').match(HEADING)?.[1])
    .filter(Boolean);
}

function countWords(parsed) {
  let words = 0;
  for (const token of proseText(parsed).replace(/<[^>]*>/g, ' ').split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(token)) words += 1;
  }
  return words;
}

// Map of type name -> { headings, budget }, read from templates/*.mdx.
function readTemplates() {
  const types = new Map();
  if (!existsSync(TEMPLATES_DIR)) return types;
  for (const file of readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.mdx')).sort()) {
    const parsed = parseMdx(join(TEMPLATES_DIR, file));
    const budget = proseText(parsed).match(BUDGET_COMMENT) ?? parsed.raw.match(BUDGET_COMMENT);
    types.set(basename(file, '.mdx'), {
      headings: headingsOf(parsed),
      budget: budget ? Number(budget[1].replace(/,/g, '')) : null,
    });
  }
  return types;
}

const templates = readTemplates();
const typeNames = [...templates.keys()].join(', ');

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

for (const file of files) {
  const rel = relative(REPO_ROOT, file).split('\\').join('/');
  const parsed = parseMdx(file);
  const type = parsed.frontmatter?.type;

  if (!type) {
    warn(rel, `no type: in frontmatter; add one of ${typeNames}`);
  } else if (!templates.has(type)) {
    warn(rel, `unknown type "${type}"; known types are ${typeNames}`);
  } else {
    const template = templates.get(type);

    // Each required heading must appear, and in template order. Search forward from the last match.
    const found = headingsOf(parsed).map((h) => h.toLowerCase());
    let at = -1;
    const problems = [];
    for (const heading of template.headings) {
      const want = heading.toLowerCase();
      const idx = found.findIndex((f, i) => i > at && f === want);
      if (idx >= 0) at = idx;
      else problems.push(found.includes(want) ? `"${heading}" (out of order)` : `"${heading}"`);
    }
    if (problems.length > 0) {
      warn(rel, `missing or out-of-order heading for type ${type}: ${problems.join(', ')}`);
    }

    if (template.budget !== null) {
      const words = countWords(parsed);
      if (words > template.budget) {
        warn(rel, `${words} words, over the ${template.budget}-word ${type} budget`);
      }
    }
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
// Always exit 0: types, headings and budgets are warnings, never failures.
