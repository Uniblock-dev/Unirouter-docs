import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { test } from 'node:test';
import { scopedArtifact, scopedInventory, selectedPaths } from './lib/scoped-openapi.mjs';

test('selection rejects unknown, duplicate and conflicting flags', () => {
  const parse = (args) => selectedPaths(args, ['--source', '--ref'], ['--check', '--worktree']);
  assert.deepEqual(parse(['--only-path', '/v1/a', '--only-path=/v1/b']), ['/v1/a', '/v1/b']);
  for (const args of [
    ['--unknown'], ['--only-path'], ['--only-path', '/admin/a'],
    ['--only-path', '/v1/a', '--only-path', '/v1/a'],
    ['--only-path', '/v1/a', '--check'], ['--source', 'x', '--check'],
    ['--ref', 'main', '--ref', 'develop'], ['--ref', 'main', '--worktree'],
  ]) assert.throws(() => parse(args));
});

test('scoped lock updates selected operations without reviewing unrelated changes', () => {
  const old = { 'GET /v1/a': 'old-a', 'POST /v1/a': 'removed-a', 'GET /v1/b': 'old-b' };
  const fresh = { 'GET /v1/a': 'new-a', 'GET /v1/b': 'new-b', 'GET /v1/c': 'new-c' };
  assert.deepEqual(scopedInventory(old, fresh, ['/v1/a']), { 'GET /v1/a': 'new-a', 'GET /v1/b': 'old-b' });
  assert.throws(() => scopedInventory(old, fresh, ['/v1/unknown']));
});

test('scoped build refuses changes to a shared component with an unselected consumer', () => {
  const op = { get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Shared' } } } } } } };
  const old = { paths: { '/v1/a': op, '/v1/b': op }, components: { schemas: { Shared: { type: 'string' } } } };
  const fresh = structuredClone(old);
  fresh.components.schemas.Shared.type = 'integer';
  assert.throws(() => scopedArtifact(old, fresh, ['/v1/unknown']), /not public/);
  assert.throws(() => scopedArtifact(old, fresh, ['/v1/a']), /unselected operation/);
  assert.equal(scopedArtifact(old, fresh, ['/v1/a', '/v1/b']).components.schemas.Shared.type, 'integer');
});

test('real generator preserves unrelated operations/components while full build refreshes them', () => {
  const temp = mkdtempSync(join(tmpdir(), 'hopscotch-scoped-openapi-'));
  try {
    cpSync(new URL('./', import.meta.url), join(temp, 'scripts'), { recursive: true });
    mkdirSync(join(temp, 'api-reference'));
    const file = (name, value) => writeFileSync(join(temp, 'api-reference', name), JSON.stringify(value));
    const operation = (summary) => ({ summary, security: [{ customerApiKey: [] }], responses: {
      200: { description: 'OK', headers: { 'x-hopscotch-request-id': { schema: { type: 'string' } } } },
    } });
    const base = { openapi: '3.0.3', paths: { '/v1/a': { get: operation('old-a') }, '/v1/b': { get: operation('old-b') } } };
    const overlay = { info: { title: 'Test', version: 'v1' }, paths: {
      '/v1/a': { classification: 'public', get: {} }, '/v1/b': { classification: 'public', get: {} },
    }, components: { schemas: { Unused: { type: 'string' } } }, securitySchemes: { customerApiKey: { type: 'http', scheme: 'bearer' } } };
    file('.source-spec.json', base);
    file('overlay.public.json', overlay);
    const run = (...args) => execFileSync(process.execPath, [join(temp, 'scripts/build-public-openapi.mjs'), ...args], { stdio: 'pipe' });
    const artifact = () => JSON.parse(readFileSync(join(temp, 'api-reference/openapi.public.json')));
    run();
    const before = artifact();
    base.paths['/v1/a'].get.summary = 'new-a';
    base.paths['/v1/b'].get.summary = 'new-b';
    overlay.components.schemas.Unused.type = 'integer';
    file('.source-spec.json', base);
    file('overlay.public.json', overlay);
    run('--only-path', '/v1/a');
    const selected = artifact();
    assert.equal(selected.paths['/v1/a'].get.summary, 'new-a');
    assert.deepEqual(selected.paths['/v1/b'], before.paths['/v1/b']);
    assert.deepEqual(selected.components, before.components);
    unlinkSync(join(temp, 'api-reference/.source-spec.json'));
    run('--check');
    file('.source-spec.json', base);
    run();
    assert.equal(artifact().paths['/v1/b'].get.summary, 'new-b');
    assert.equal(artifact().components.schemas.Unused.type, 'integer');
  } finally {
    assert.ok(isAbsolute(temp) && dirname(resolve(temp)) === resolve(tmpdir()) && basename(temp).startsWith('hopscotch-scoped-openapi-'));
    rmSync(temp, { recursive: true, force: true });
  }
});
