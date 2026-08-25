#!/usr/bin/env node
/**
 * Builds api-reference/openapi.public.json.
 *
 *   artifact = (private control-plane spec, filtered to /v1) + overlay.public.json
 *
 * The private spec is never committed. It documents four surfaces and carries
 * non-production hostnames, so this script reads it out of a local source
 * checkout (--source) or out of the gitignored copy sync-source-spec.mjs left
 * behind, and writes only the derived public artifact.
 *
 * Usage:
 *   node scripts/build-public-openapi.mjs --source ../Gateway-LLM
 *   node scripts/build-public-openapi.mjs            (uses the synced local copy)
 *   node scripts/build-public-openapi.mjs --check    (validates the committed
 *                                                     artifact, no source needed)
 *
 * --check is what CI runs. It cannot rebuild, so it audits the committed
 * artifact against every rule the build enforces: only /v1 paths, only the
 * customer security scheme, only the production server, examples present, and
 * no internal hostname or header anywhere in the bytes.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PRIVATE_PATH_PREFIXES,
  PRODUCTION_SERVER,
  PUBLIC_PATH_PREFIX,
  SOURCE_SPEC_RELATIVE,
  paths,
} from './lib/paths.mjs';
import { Report, flag, option } from './lib/report.mjs';

const OVERLAY_HEADER_REF = '#/responseHeaders/';
const COMPONENT_HEADER_REF = '#/components/headers/';

/**
 * Strings that must not survive into the artifact, whatever produced them.
 * A leak here is a leak on a public URL, so this is checked on the serialized
 * bytes rather than on the object graph.
 */
const FORBIDDEN_SUBSTRINGS = [
  'workers.dev',
  'localhost',
  '127.0.0.1',
  'staging-',
  'x-uniblock-internal-secret',
  'x-uniblock-config',
  'x-uniblock-last-used-option-index',
  'Cloudflare Access',
  'Durable Object',
];

const report = new Report('build-public-openapi');

const overlay = readJson(paths.overlay, 'overlay');

if (flag('check')) {
  if (!existsSync(paths.publicSpec)) {
    report.fail('artifact', 'api-reference/openapi.public.json is missing. Run the build with --source.');
    report.finish();
    process.exit(process.exitCode ?? 1);
  }
  const artifact = readJson(paths.publicSpec, 'artifact');
  auditArtifact(artifact, report);
  auditBytes(readFileSync(paths.publicSpec, 'utf8'), report);
  report.note('checked the committed artifact; the private spec was not read');
  printExampleDebt(overlay);
  report.finish();
} else {
  const base = loadBaseSpec(report);
  if (!base) {
    report.finish();
    process.exit(process.exitCode ?? 1);
  }
  classifyPaths(base, overlay, report);
  const artifact = buildArtifact(base, overlay);
  auditArtifact(artifact, report);
  const bytes = `${JSON.stringify(artifact, null, 2)}\n`;
  auditBytes(bytes, report);

  if (report.failures.length === 0) {
    writeFileSync(paths.publicSpec, bytes, 'utf8');
    report.note(`wrote api-reference/openapi.public.json (${Object.keys(artifact.paths).length} public path(s))`);
  } else {
    report.note('nothing written: the artifact did not pass its own checks');
  }
  printExampleDebt(overlay);
  report.finish();
}

// ---------------------------------------------------------------------------

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`Could not read the ${label} at ${path}: ${error.message}`);
    process.exit(1);
  }
}

function loadBaseSpec(report) {
  const source = option('source');
  if (source) {
    const specPath = join(source, ...SOURCE_SPEC_RELATIVE.split('/'));
    if (!existsSync(specPath)) {
      report.fail('source', `no control-plane spec at ${specPath}. Point --source at a checkout of the source repository.`);
      return null;
    }
    report.note(`base spec read from the source checkout at ${specPath}`);
    return readJson(specPath, 'source spec');
  }
  if (existsSync(paths.sourceSpecLocal)) {
    report.note('base spec read from the synced local copy (api-reference/.source-spec.json, gitignored)');
    return readJson(paths.sourceSpecLocal, 'synced spec');
  }
  report.fail(
    'source',
    'no base spec available. Run scripts/sync-source-spec.mjs --source <checkout>, or pass --source, or use --check to audit the committed artifact.'
  );
  return null;
}

/**
 * Every /v1 path in the base spec must be classified in the overlay.
 *
 * This is the gate that forces a human decision when a new public route ships:
 * an unclassified path fails the build rather than being published unreviewed
 * or dropped unnoticed.
 */
function classifyPaths(base, overlay, report) {
  const classified = new Set(Object.keys(overlay.paths ?? {}));
  const inBase = Object.keys(base.paths ?? {}).filter((p) =>
    p.startsWith(PUBLIC_PATH_PREFIX)
  );

  for (const path of inBase) {
    if (!classified.has(path)) {
      report.fail(
        path,
        'a new public path appeared in the source spec and the overlay does not classify it. Add it to overlay.public.json paths as "public" (with the documentation it needs) or "blocked" (with a gate and a reason).'
      );
    }
  }

  for (const path of classified) {
    const entry = overlay.paths[path];
    if (entry.classification === 'public' && !inBase.includes(path)) {
      report.fail(
        path,
        'the overlay classifies this path as public but the source spec no longer has it. Either the route was removed or the overlay is stale.'
      );
    }
    if (entry.classification === 'blocked') {
      report.note(`blocked, not published: ${path} (gate ${entry.gate})`);
    }
  }
}

function buildArtifact(base, overlay) {
  const artifact = {
    openapi: base.openapi ?? '3.0.3',
    info: structuredClone(overlay.info),
    servers: structuredClone(overlay.servers ?? [PRODUCTION_SERVER]),
    tags: structuredClone(overlay.tags ?? []),
    paths: {},
    components: {},
  };

  // Only public paths, and only the operations the overlay documents.
  for (const [path, entry] of Object.entries(overlay.paths ?? {})) {
    if (entry.classification !== 'public') continue;
    const basePath = base.paths?.[path] ?? {};
    const merged = {};
    for (const [method, operation] of Object.entries(entry)) {
      if (method === 'classification' || method === 'gate' || method === 'reason') continue;
      merged[method] = deepMerge(basePath[method] ?? {}, operation);
    }
    artifact.paths[path] = merged;
  }

  // Components. The overlay's schemas replace the base's outright: the base
  // spec's Error is a `{"error": "string"}` stub that does not describe the
  // envelope any customer actually receives.
  artifact.components.schemas = structuredClone(overlay.components?.schemas ?? {});
  artifact.components.headers = structuredClone(overlay.responseHeaders ?? {});

  const keep = new Set(overlay.keepSecuritySchemes ?? ['customerApiKey']);
  artifact.components.securitySchemes = {};
  for (const name of keep) {
    artifact.components.securitySchemes[name] = structuredClone(
      overlay.securitySchemes?.[name] ?? base.components?.securitySchemes?.[name] ?? {}
    );
  }

  artifact.security = [...keep].map((name) => ({ [name]: [] }));

  return rewriteHeaderRefs(artifact);
}

/** Overlay header refs are authored short; the artifact needs real ones. */
function rewriteHeaderRefs(value) {
  if (Array.isArray(value)) return value.map(rewriteHeaderRefs);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] =
        key === '$ref' && typeof inner === 'string' && inner.startsWith(OVERLAY_HEADER_REF)
          ? COMPONENT_HEADER_REF + inner.slice(OVERLAY_HEADER_REF.length)
          : rewriteHeaderRefs(inner);
    }
    return out;
  }
  return value;
}

function deepMerge(base, patch) {
  if (Array.isArray(patch)) return structuredClone(patch);
  if (patch === null || typeof patch !== 'object') return patch;
  const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    out[key] = deepMerge(out[key], value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The audit. Every rule here is one the artifact must satisfy however it was
// produced, which is why --check runs the same function on the committed file.

function auditArtifact(artifact, report) {
  const pathNames = Object.keys(artifact.paths ?? {});

  if (pathNames.length === 0) {
    report.fail('paths', 'the artifact publishes nothing.');
  }

  for (const path of pathNames) {
    if (!path.startsWith(PUBLIC_PATH_PREFIX)) {
      report.fail(path, `not under ${PUBLIC_PATH_PREFIX}. Only the API-key product is public.`);
    }
    for (const prefix of PRIVATE_PATH_PREFIXES) {
      if (path.startsWith(prefix)) {
        report.fail(path, `a ${prefix} path survived the filter. This surface is never published.`);
      }
    }
  }

  const servers = artifact.servers ?? [];
  if (servers.length !== 1 || servers[0].url !== PRODUCTION_SERVER.url) {
    report.fail(
      'servers',
      `must be exactly [${PRODUCTION_SERVER.url}]. Found ${JSON.stringify(servers.map((s) => s.url))}. The playground makes real billed requests and must never point anywhere else.`
    );
  }

  const schemes = Object.keys(artifact.components?.securitySchemes ?? {});
  const allowed = new Set(['customerApiKey']);
  for (const scheme of schemes) {
    if (!allowed.has(scheme)) {
      report.fail('securitySchemes', `${scheme} is not a customer scheme and must be stripped.`);
    }
  }
  if (!schemes.includes('customerApiKey')) {
    report.fail('securitySchemes', 'customerApiKey is missing. Every public route is key-authenticated.');
  }

  for (const [path, item] of Object.entries(artifact.paths ?? {})) {
    for (const [method, operation] of Object.entries(item)) {
      const where = `${method.toUpperCase()} ${path}`;

      if (!operation.security?.some((s) => 'customerApiKey' in s)) {
        report.fail(where, 'does not require customerApiKey.');
      }

      const body = operation.requestBody?.content?.['application/json'];
      if (operation.requestBody && !hasExample(body)) {
        report.fail(where, 'has a request body with no example. DOCS_PLAN.md section 8 requires one.');
      }

      const responses = operation.responses ?? {};
      if (Object.keys(responses).length === 0) {
        report.fail(where, 'documents no responses.');
      }
      for (const [status, response] of Object.entries(responses)) {
        const json = response.content?.['application/json'];
        if (json && !hasExample(json)) {
          report.fail(`${where} ${status}`, 'response has content with no example.');
        }
        if (!response.headers?.['x-uniblock-request-id']) {
          report.fail(
            `${where} ${status}`,
            'does not document x-uniblock-request-id. It is on every response, errors included, and it is the one thing support needs.'
          );
        }
      }
    }
  }
}

function hasExample(media) {
  if (!media) return false;
  if (media.example !== undefined) return true;
  if (media.examples && Object.keys(media.examples).length > 0) return true;
  return false;
}

function auditBytes(bytes, report) {
  const lower = bytes.toLowerCase();
  for (const needle of FORBIDDEN_SUBSTRINGS) {
    if (lower.includes(needle.toLowerCase())) {
      report.fail('artifact bytes', `contains "${needle}", which is internal and must never be published.`);
    }
  }
  // A 43-character secret next to a live prefix would be a real key shape.
  if (/ub_(live|stg|dev)_[A-Za-z0-9_-]{20,}/.test(bytes)) {
    report.fail('artifact bytes', 'contains something shaped like a real API key. Use an obvious placeholder.');
  }
}

function printExampleDebt(overlay) {
  const owed = overlay.exampleVerification?.owed ?? [];
  if (owed.length === 0) return;
  console.log('');
  console.log(`  ${owed.length} example(s) still owe a live transcript (DOCS_PLAN.md section 9):`);
  for (const item of owed) {
    console.log(`    - ${item.example}: ${item.note}`);
  }
}
