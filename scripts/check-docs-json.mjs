#!/usr/bin/env node
/**
 * Validates docs.json against Mintlify's published schema, offline.
 *
 * The schema is vendored at scripts/schema/mintlify-docs.schema.json rather
 * than fetched, so CI does not depend on a network round trip and so an
 * upstream schema change arrives as a reviewable diff instead of as a red
 * build nobody caused. Refresh it with --refresh-schema.
 *
 *   node scripts/check-docs-json.mjs
 *   node scripts/check-docs-json.mjs --refresh-schema
 *
 * On top of the schema, this checks the things the schema cannot know:
 * the API playground points at the published artifact, no non-production
 * origin appears anywhere, and the navigation holds no duplicate page.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { collectNavPages } from './lib/navigation.mjs';
import { paths } from './lib/paths.mjs';
import { Report, flag } from './lib/report.mjs';

const SCHEMA_URL = 'https://mintlify.com/docs.json';

const report = new Report('check-docs-json');

if (flag('refresh-schema')) {
  const response = await fetch(SCHEMA_URL);
  if (!response.ok) {
    console.error(`Could not fetch ${SCHEMA_URL}: ${response.status}`);
    process.exit(1);
  }
  const schema = await response.json();
  writeFileSync(paths.docsSchema, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
  console.log(`Refreshed ${paths.docsSchema} from ${SCHEMA_URL}. Review the diff before committing.`);
  process.exit(0);
}

if (!existsSync(paths.docsSchema)) {
  report.fail('schema', 'the vendored Mintlify schema is missing. Run with --refresh-schema.');
  report.finish();
  process.exit(process.exitCode ?? 1);
}

const docs = JSON.parse(readFileSync(paths.docsJson, 'utf8'));
const schema = JSON.parse(readFileSync(paths.docsSchema, 'utf8'));

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
  code: {
    /**
     * The published schema carries patterns written for a non-unicode engine,
     * e.g. `^phc\_`, where `\_` is an identity escape that a `u`-flagged
     * RegExp rejects outright. Dropping the flag is what every other consumer
     * of this schema effectively does, and none of the patterns here use a
     * unicode property escape that would need it.
     */
    regExp: (source, flags) => new RegExp(source, flags.replace('u', '')),
  },
});
addFormats(ajv);

const validate = ajv.compile(schema);
if (!validate(docs)) {
  // The schema is one large anyOf, so a single mistake produces a long list of
  // "did not match this branch" errors. Only the ones naming a real path in
  // docs.json are worth showing.
  const useful = (validate.errors ?? []).filter((e) => e.instancePath !== '');
  for (const error of (useful.length > 0 ? useful : validate.errors).slice(0, 25)) {
    report.fail(`docs.json${error.instancePath}`, error.message);
  }
} else {
  report.note('docs.json validates against the Mintlify schema');
}

// --- What the schema cannot know -------------------------------------------

const specRef = docs.api?.openapi;
if (specRef !== 'api-reference/openapi.public.json') {
  report.fail(
    'docs.json api.openapi',
    `must be api-reference/openapi.public.json, the derived artifact. Found ${JSON.stringify(specRef)}. Neither source spec is ever published.`
  );
}

const serialized = JSON.stringify(docs);
for (const needle of ['workers.dev', 'localhost', 'staging-', '127.0.0.1']) {
  if (serialized.includes(needle)) {
    report.fail('docs.json', `contains "${needle}". Nothing non-production may be linked from the site chrome.`);
  }
}

const pages = collectNavPages(docs.navigation);
const seen = new Set();
for (const page of pages) {
  if (seen.has(page)) {
    report.fail('docs.json', `"${page}" appears in navigation more than once.`);
  }
  seen.add(page);
}
report.note(`${pages.length} page(s) in navigation, ${new Set(pages).size} unique`);

// Reserved prefixes, so growth never forces a move (DOCS_PLAN.md section 15).
const RESERVED = ['index', 'get-started/', 'concepts/', 'guides/', 'resources/', 'api-reference/'];
for (const page of pages) {
  if (!RESERVED.some((prefix) => page === prefix || page.startsWith(prefix))) {
    report.fail(
      'docs.json',
      `"${page}" is outside the reserved path prefixes (${RESERVED.join(', ')}). Once published a path is permanent, so a new prefix is a decision rather than a typo.`
    );
  }
}

if (!Array.isArray(docs.redirects)) {
  report.fail('docs.json', 'needs a redirects array, even when empty. A moved page ships its redirect in the same change.');
}

report.finish();

// ---------------------------------------------------------------------------
