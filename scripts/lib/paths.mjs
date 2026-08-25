import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const paths = {
  docsJson: join(REPO_ROOT, 'docs.json'),
  apiReference: join(REPO_ROOT, 'api-reference'),
  overlay: join(REPO_ROOT, 'api-reference', 'overlay.public.json'),
  publicSpec: join(REPO_ROOT, 'api-reference', 'openapi.public.json'),
  sourceSpecLocal: join(REPO_ROOT, 'api-reference', '.source-spec.json'),
  sourceSpecLock: join(REPO_ROOT, 'api-reference', 'source-spec.lock.json'),
  bannedContent: join(REPO_ROOT, 'banned-content.yml'),
  claims: join(REPO_ROOT, 'claims.yml'),
  docsSchema: join(REPO_ROOT, 'scripts', 'schema', 'mintlify-docs.schema.json'),
  snippets: join(REPO_ROOT, 'snippets'),
};

/** Where the control-plane spec lives inside a source checkout. */
export const SOURCE_SPEC_RELATIVE = 'services/control-plane/openapi.json';

/** The only surface this repository may publish. */
export const PUBLIC_PATH_PREFIX = '/v1';

/**
 * Surfaces that must never reach the published artifact. Named rather than
 * inferred, so a new private prefix in the source spec is a build failure at
 * the classification gate instead of a silent publication.
 */
export const PRIVATE_PATH_PREFIXES = [
  '/admin',
  '/api',
  '/internal',
  '/webhooks',
  '/health',
];

export const PRODUCTION_SERVER = {
  url: 'https://ai.uniblock.dev',
  description: 'Production',
};
