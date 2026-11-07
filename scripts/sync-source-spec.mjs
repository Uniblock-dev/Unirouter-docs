#!/usr/bin/env node
/**
 * Syncs the private control-plane OpenAPI spec from a local source checkout and
 * tells a writer what changed on the public surface.
 *
 *   node scripts/sync-source-spec.mjs --source ../Gateway-LLM
 *   node scripts/sync-source-spec.mjs --source ../Gateway-LLM --ref origin/main
 *   node scripts/sync-source-spec.mjs --source ../Gateway-LLM --ref origin/main --write-lock
 *   node scripts/sync-source-spec.mjs --source ../Gateway-LLM --worktree
 *
 * The spec is read from a git ref in the source checkout, not from its working
 * tree, because a working tree can sit on any branch with any edits. --ref
 * defaults to origin/develop (the sync point). Production runs origin/main, so
 * pass --ref origin/main when the question is what production exposes.
 * --worktree opts back into reading the file from disk.
 *
 * Read-only against the source checkout: only `git rev-parse` and `git show`
 * are run there, and nothing is written into it.
 *
 * Two files come out of this, and the difference between them is the point:
 *
 *   api-reference/.source-spec.json     the whole private spec, GITIGNORED.
 *                                       Four surfaces, non-production
 *                                       hostnames, staff routes. It exists so
 *                                       build-public-openapi.mjs has something
 *                                       to filter, and it is never committed.
 *
 *   api-reference/source-spec.lock.json the reviewed sync point, COMMITTED.
 *                                       Only the public /v1 inventory and a
 *                                       hash per operation. It is what makes a
 *                                       change to the public contract show up
 *                                       in a diff, without putting the private
 *                                       spec in the history.
 *
 * Docs CI never reads the source repository. It is private and it moves. The
 * committed lock plus the committed artifact are what CI has, and that is
 * deliberate.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_PATH_PREFIX, SOURCE_SPEC_RELATIVE, paths } from './lib/paths.mjs';
import { Report, flag, option } from './lib/report.mjs';

const report = new Report('sync-source-spec');

const source = option('source');
if (!source) {
  console.error(
    'Pass --source <path to a checkout of the source repository>.\n' +
      'Nothing is fetched over the network and nothing private is committed.'
  );
  process.exit(1);
}

const useWorktree = flag('worktree');
const ref = option('ref', 'origin/develop');
if (useWorktree && option('ref') !== undefined) {
  console.error('Pass either --ref or --worktree, not both. --worktree reads whatever is on disk.');
  process.exit(1);
}

let raw;
let sourceLabel;
if (useWorktree) {
  const specPath = join(source, ...SOURCE_SPEC_RELATIVE.split('/'));
  if (!existsSync(specPath)) {
    console.error(`No control-plane spec at ${specPath}.`);
    process.exit(1);
  }
  raw = readFileSync(specPath, 'utf8');
  sourceLabel = `working tree at ${specPath}`;
} else {
  const sha = gitInSource(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], source)?.trim();
  if (!sha) {
    console.error(`Ref ${ref} does not resolve in ${source}. Fetch it there first; this script does not fetch.`);
    process.exit(1);
  }
  raw = gitInSource(['show', `${ref}:${SOURCE_SPEC_RELATIVE}`], source, { maxBuffer: 512 * 1024 * 1024 });
  if (raw === null) {
    console.error(`No control-plane spec at ${SOURCE_SPEC_RELATIVE} on ${ref} (${sha}).`);
    process.exit(1);
  }
  sourceLabel = `${ref} (${sha}) at ${SOURCE_SPEC_RELATIVE}`;
}
report.note(`read ${sourceLabel}`);

const spec = JSON.parse(raw);
writeFileSync(paths.sourceSpecLocal, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
report.note(`wrote api-reference/.source-spec.json (gitignored, ${Object.keys(spec.paths ?? {}).length} paths across every surface)`);

const inventory = publicInventory(spec);
report.note(`public surface: ${Object.keys(inventory).length} operation(s) under ${PUBLIC_PATH_PREFIX}`);

const previous = existsSync(paths.sourceSpecLock)
  ? JSON.parse(readFileSync(paths.sourceSpecLock, 'utf8'))
  : { operations: {} };

const diff = compare(previous.operations ?? {}, inventory);
printDiff(diff);

if (flag('write-lock')) {
  const lock = {
    $comment:
      'The reviewed sync point for the public /v1 surface. Written by scripts/sync-source-spec.mjs. It holds no request or response content: only which public operations exist and a hash of each, so a change to the public contract shows up in a diff without the private spec entering this repository.',
    syncedFrom: SOURCE_SPEC_RELATIVE,
    operations: inventory,
  };
  writeFileSync(paths.sourceSpecLock, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  report.note('updated api-reference/source-spec.lock.json');
} else if (diff.added.length || diff.removed.length || diff.changed.length) {
  report.note('re-run with --write-lock once you have reviewed the differences above');
}

if (diff.added.length > 0) {
  report.note(
    'a new public operation needs a classification in api-reference/overlay.public.json before the artifact will build'
  );
}

report.finish();

// ---------------------------------------------------------------------------

/**
 * The public inventory: path, method, and a hash of the operation.
 *
 * A hash rather than the operation itself, because the operation body is the
 * private spec's prose and belongs in the private spec. The hash answers the
 * only question this file has to answer: did the public contract move.
 */
function publicInventory(spec) {
  const operations = {};
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    if (!path.startsWith(PUBLIC_PATH_PREFIX)) continue;
    for (const [method, operation] of Object.entries(item)) {
      if (typeof operation !== 'object' || operation === null) continue;
      operations[`${method.toUpperCase()} ${path}`] = createHash('sha256')
        .update(JSON.stringify(operation))
        .digest('hex')
        .slice(0, 16);
    }
  }
  return Object.fromEntries(Object.entries(operations).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Runs read-only git against the source checkout. Returns stdout, or null when
 * git fails (an unknown ref, or a path that is not on that ref).
 */
function gitInSource(args, cwd, options = {}) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      ...options,
    });
  } catch {
    return null;
  }
}

function compare(before, after) {
  const added = Object.keys(after).filter((k) => !(k in before));
  const removed = Object.keys(before).filter((k) => !(k in after));
  const changed = Object.keys(after).filter((k) => k in before && before[k] !== after[k]);
  return { added, removed, changed };
}

function printDiff({ added, removed, changed }) {
  if (!added.length && !removed.length && !changed.length) {
    console.log('  the public surface is unchanged since the last reviewed sync');
    return;
  }
  console.log('');
  console.log('  Public surface changes since the last reviewed sync:');
  for (const op of added) console.log(`    + ${op}   NEW. Classify it in overlay.public.json.`);
  for (const op of removed) console.log(`    - ${op}   GONE. Its page and overlay entry are now stale.`);
  for (const op of changed) console.log(`    ~ ${op}   CHANGED. Re-read the handler before republishing.`);
  console.log('');
}
