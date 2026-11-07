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
 *   node scripts/check-status-gates.mjs --tracker ../Gateway-LLM
 *   node scripts/check-status-gates.mjs --tracker ../Gateway-LLM --tracker-ref origin/main
 *
 * --allow-missing-pages downgrades "in navigation but not written yet" to a
 * printed list. It exists for the phase where several writers hold different
 * pages of the same navigation tree, and it is removed at first publish. It
 * never downgrades anything else.
 *
 * --tracker reads the source ticket tree (a sibling Gateway-LLM checkout) and
 * checks each navigation page's gates against it. A gate such as "13.10" names
 * the story whose v6_key starts with "13-10-". A write-now page whose gate
 * story is not `done` fails. A gate that matches no story prints a warning.
 * --tracker-ref defaults to origin/main, because main is what production runs.
 * The checkout is read with git only (ls-tree and cat-file); nothing is written
 * into it. Without --tracker nothing changes, so CI, which cannot see the
 * private source repository, runs the check without it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { parseMdx } from './lib/mdx.mjs';
import { collectNavPages } from './lib/navigation.mjs';
import { REPO_ROOT, paths } from './lib/paths.mjs';
import { Report, flag, option } from './lib/report.mjs';

const STATUSES = new Set(['write-now', 'partial', 'blocked']);
const TICKETS_DIR = '_bmad-output/initiative-gateway-llm/tickets';

const report = new Report('check-status-gates');
const allowMissing = flag('allow-missing-pages');
const trackerPath = option('tracker');
const trackerRef = option('tracker-ref', 'origin/main');
const tracker = trackerPath ? loadTracker(trackerPath, trackerRef) : null;

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

if (tracker) {
  report.note('');
  report.note(
    `Ticket tree at ${trackerRef} (${tracker.sha}): ${tracker.storyCount} story file(s), ` +
      `${tracker.keyedCount} with a v6_key. ${tracker.unkeyed.length} without one are not matched.`
  );
  checkGatesAgainstTracker();
}

report.finish();

// ---------------------------------------------------------------------------

/**
 * Every gate on a navigation page is looked up in the ticket tree. A gate with
 * no story is a warning, because a gate can name a spec rather than a story.
 * A write-now page whose gate story is not done is a failure: the page is
 * claimed as shipped and its gate says it is not.
 */
function checkGatesAgainstTracker() {
  for (const { pageId, status, gates } of partials) {
    if (!inNav.has(pageId)) continue;
    const rel = `${pageId}.mdx`;

    for (const gate of gates) {
      const stories = tracker.byGate.get(gate) ?? [];

      if (stories.length === 0) {
        report.note(`warning: ${rel} gate "${gate}" matches no story in the ticket tree`);
        continue;
      }

      const open = stories.filter((story) => story.status !== 'done');
      if (open.length > 0 && status === 'write-now') {
        const detail = open.map((story) => `${story.status} (${story.key})`).join(', ');
        report.fail(
          rel,
          `is write-now but gate ${gate} is not done in the ticket tree: ${detail}. ` +
            'Hold the page at partial until the story is done, or take the gate off.'
        );
      }
    }
  }
}

/**
 * Reads the story files of the ticket tree at a git ref in one `git cat-file
 * --batch` call and indexes them by gate ("13.10" for v6_key "13-10-...").
 * A missing ref or checkout ends the run: a gate check that silently checked
 * nothing would pass.
 */
function loadTracker(path, ref) {
  const sha = gitOrExit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], path, `Ref ${ref} does not resolve in ${path}. Fetch it there first; this check does not fetch.`).trim();

  const listing = gitOrExit(
    ['ls-tree', '-r', '--name-only', ref, TICKETS_DIR],
    path,
    `Cannot list ${TICKETS_DIR} at ${ref} in ${path}.`
  );
  const storyFiles = listing
    .split('\n')
    .filter((file) => /(^|\/)story-[^/]*\.md$/.test(file));
  if (storyFiles.length === 0) {
    console.error(`No story files under ${TICKETS_DIR} at ${ref} in ${path}. Check the checkout and the ref.`);
    process.exit(1);
  }

  const bodies = batchRead(path, storyFiles.map((file) => `${ref}:${file}`));

  const byGate = new Map();
  const unkeyed = [];
  let keyedCount = 0;

  storyFiles.forEach((file, index) => {
    const frontmatter = bodies[index] === null ? null : frontmatterOf(bodies[index]);
    const key = frontmatter?.v6_key;
    const match = typeof key === 'string' ? key.match(/^(\d+)-(\d+)-/) : null;
    if (!match) {
      unkeyed.push(file);
      return;
    }
    keyedCount += 1;
    const gate = `${match[1]}.${match[2]}`;
    const list = byGate.get(gate) ?? [];
    list.push({ key, status: String(frontmatter.status ?? 'unknown'), file });
    byGate.set(gate, list);
  });

  return { sha, byGate, unkeyed, storyCount: storyFiles.length, keyedCount };
}

/**
 * Reads many git objects through one `git cat-file --batch` process. Returns
 * each object's text in request order, or null for an object git cannot find.
 */
function batchRead(path, specs) {
  if (specs.length === 0) return [];
  const out = execFileSync('git', ['-C', path, 'cat-file', '--batch'], {
    input: `${specs.join('\n')}\n`,
    maxBuffer: 1024 * 1024 * 1024,
  });

  const bodies = [];
  let offset = 0;
  for (let i = 0; i < specs.length; i += 1) {
    const newline = out.indexOf(0x0a, offset);
    const header = out.subarray(offset, newline).toString('utf8');
    offset = newline + 1;
    if (header.endsWith(' missing') || header.endsWith(' ambiguous')) {
      bodies.push(null);
      continue;
    }
    const size = Number(header.split(' ')[2]);
    bodies.push(out.subarray(offset, offset + size).toString('utf8'));
    offset += size + 1;
  }
  return bodies;
}

/** The YAML frontmatter of a markdown body, or null when it has none. */
function frontmatterOf(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end === -1) return null;
  try {
    return parseYaml(lines.slice(1, end).join('\n')) ?? null;
  } catch {
    return null;
  }
}

function gitOrExit(args, cwd, message) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    console.error(message);
    process.exit(1);
  }
}
