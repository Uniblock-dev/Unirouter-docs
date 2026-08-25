#!/usr/bin/env node
/**
 * Status gates (DOCS_PLAN.md section 16.5).
 *
 * Every page carries frontmatter `status` and `gates`. This is how "docs never
 * claim unshipped behaviour" becomes mechanical rather than remembered:
 *
 *   - a `blocked` page in docs.json navigation fails the build
 *   - a `partial` page must name at least one gate, and its gates are printed
 *     for the release checklist
 *   - a page with no status, or a status nobody recognises, fails
 *   - every page in navigation must exist, and every page that exists must be
 *     in navigation or explicitly say why it is not
 *
 *   node scripts/check-status-gates.mjs
 *   node scripts/check-status-gates.mjs --allow-missing-pages
 *
 * --allow-missing-pages downgrades "in navigation but not written yet" to a
 * printed list. It exists for the phase where several writers hold different
 * pages of the same navigation tree, and it is removed at first publish. It
 * never downgrades anything else.
 */
import { existsSync, readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { parseMdx } from './lib/mdx.mjs';
import { collectNavPages } from './lib/navigation.mjs';
import { REPO_ROOT, paths } from './lib/paths.mjs';
import { Report, flag } from './lib/report.mjs';

const STATUSES = new Set(['write-now', 'partial', 'blocked']);

const report = new Report('check-status-gates');
const allowMissing = flag('allow-missing-pages');

const docs = JSON.parse(readFileSync(paths.docsJson, 'utf8'));
const navPages = collectNavPages(docs.navigation);

const onDisk = [];
for await (const entry of glob('**/*.mdx', { cwd: REPO_ROOT })) {
  const rel = entry.split('\\').join('/');
  if (rel.startsWith('node_modules/') || rel.startsWith('snippets/')) continue;
  onDisk.push(rel);
}
onDisk.sort();

report.note(`${navPages.length} page(s) in navigation, ${onDisk.length} page file(s) on disk`);

const missing = [];
for (const page of navPages) {
  if (!existsSync(`${REPO_ROOT}/${page}.mdx`)) missing.push(page);
}

if (missing.length > 0) {
  const message = `${missing.length} page(s) are in docs.json navigation and not yet written: ${missing.join(', ')}`;
  if (allowMissing) {
    report.note(`${message}\n  (--allow-missing-pages is set. Remove the flag from CI once every lane has landed.)`);
  } else {
    report.fail('docs.json', `${message}. Write them, or take them out of navigation.`);
  }
}

const inNav = new Set(navPages);
const partials = [];

for (const rel of onDisk) {
  const pageId = rel.replace(/\.mdx$/, '');
  const { frontmatter } = parseMdx(`${REPO_ROOT}/${rel}`);

  if (!frontmatter) {
    report.fail(rel, 'has no frontmatter. Every page needs title, description, status and gates.');
    continue;
  }

  for (const required of ['title', 'description']) {
    if (!frontmatter[required]) {
      report.fail(rel, `frontmatter is missing "${required}".`);
    }
  }

  if (frontmatter.description && frontmatter.description.length > 160) {
    report.fail(
      rel,
      `description is ${frontmatter.description.length} characters. Keep it under 160 so it survives a search result intact.`
    );
  }

  const status = frontmatter.status;
  if (!status) {
    report.fail(rel, 'frontmatter is missing "status". Use write-now, partial or blocked.');
    continue;
  }
  if (!STATUSES.has(status)) {
    report.fail(rel, `status "${status}" is not one of ${[...STATUSES].join(', ')}.`);
    continue;
  }

  const gates = Array.isArray(frontmatter.gates) ? frontmatter.gates : [];

  if (status === 'blocked') {
    if (inNav.has(pageId)) {
      report.fail(
        rel,
        'is blocked and is in docs.json navigation. A blocked page describes behaviour that has not shipped, so it must not be reachable.'
      );
    }
    if (gates.length === 0) {
      report.fail(rel, 'is blocked and names no gate. A block nobody can clear is a block nobody will clear.');
    }
    continue;
  }

  if (status === 'partial' && gates.length === 0) {
    report.fail(
      rel,
      'is partial and names no gate. Partial means "true today, incomplete until X"; name the X.'
    );
  }

  // A write-now page may carry gates. DOCS_PLAN.md section 7 has several:
  // the page as a whole is publishable now, and one section of it waits on a
  // story. What matters is that the gate is NAMED, so it reaches the release
  // checklist below either way.
  if (gates.length > 0) {
    partials.push({ pageId, status, gates });
  }

  if (!inNav.has(pageId)) {
    report.fail(
      rel,
      `is ${status} and is not in docs.json navigation, so nobody can reach it. Add it to navigation or mark it blocked.`
    );
  }
}

if (partials.length > 0) {
  report.note('');
  report.note('Release checklist. These pages are true today and incomplete until their gates clear:');
  for (const { pageId, status, gates } of partials.sort((a, b) => a.pageId.localeCompare(b.pageId))) {
    report.note(`  [${status}] ${pageId}  ->  ${gates.join(', ')}`);
  }
}

report.finish();

// ---------------------------------------------------------------------------
