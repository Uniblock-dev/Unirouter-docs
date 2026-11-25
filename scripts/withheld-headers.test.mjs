import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  deletePointer,
  findWithheldHeaders,
  pointerResolves,
  productionFlagValue,
  withheldHeaderList,
  withheldSourceList,
  withholdHeaders,
} from './lib/withheld-headers.mjs';

const ENTRY = { header: 'x-dark', flag: 'DARK_FLAG_ENABLED', reason: 'Sent only while DARK_FLAG_ENABLED is on.' };

test('the overlay list needs a header, the flag that gates it and a reason, once each', () => {
  assert.deepEqual(withheldHeaderList({}), { entries: [], problems: [] });
  assert.deepEqual(withheldHeaderList({ withheldResponseHeaders: [ENTRY] }), { entries: [ENTRY], problems: [] });
  for (const bad of [
    'x-dark',
    [{ ...ENTRY, flag: undefined }],
    [{ ...ENTRY, flag: 'dark flag' }],
    [{ ...ENTRY, header: 'X-Dark' }],
    [{ ...ENTRY, reason: ' ' }],
    [ENTRY, ENTRY],
  ]) {
    const { problems } = withheldHeaderList({ withheldResponseHeaders: bad });
    assert.equal(problems.length, 1, JSON.stringify(bad));
  }
});

test('a withheld header is removed from every response, whatever its case, and nothing else is', () => {
  const spec = { paths: {
    '/v1/a': { post: { responses: {
      200: { headers: { 'x-keep': { schema: {} }, 'X-Dark': { schema: {} } } },
      400: { headers: { 'x-dark': { schema: {} } } },
    } } },
    '/v1/b': { get: { responses: { 200: { description: 'no headers' } } } },
  } };
  assert.equal(findWithheldHeaders(spec, [ENTRY]).length, 2);
  const removed = withholdHeaders(spec, [ENTRY]);
  assert.deepEqual(removed.map((item) => item.where), ['POST /v1/a 200', 'POST /v1/a 400']);
  assert.deepEqual(Object.keys(spec.paths['/v1/a'].post.responses[200].headers), ['x-keep']);
  assert.deepEqual(spec.paths['/v1/a'].post.responses[400].headers, {});
  assert.deepEqual(findWithheldHeaders(spec, [ENTRY]), []);
});

test('the flag is read from [env.production.vars] only', () => {
  const toml = [
    '[vars]',
    'DARK_FLAG_ENABLED = "true"',
    '[env.staging.vars]',
    'DARK_FLAG_ENABLED = "true"',
    '[env.production.vars]',
    'OTHER = "true"',
    'DARK_FLAG_ENABLED = "false"',
    '[env.production.triggers]',
    'DARK_FLAG_ENABLED = "true"',
  ].join('\n');
  assert.equal(productionFlagValue(toml, 'DARK_FLAG_ENABLED'), 'false');
  assert.equal(productionFlagValue(toml, 'OTHER'), 'true');
  assert.equal(productionFlagValue(toml, 'MISSING'), undefined);
});

test('real generator withholds, audits and refuses a stale or contradictory entry', () => {
  const temp = mkdtempSync(join(tmpdir(), 'hopscotch-withheld-headers-'));
  try {
    cpSync(new URL('./', import.meta.url), join(temp, 'scripts'), { recursive: true });
    mkdirSync(join(temp, 'api-reference'));
    const source = join(temp, 'source');
    mkdirSync(join(source, 'services', 'control-plane'), { recursive: true });
    const write = (path, value) => writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
    const artifactPath = join(temp, 'api-reference/openapi.public.json');
    const operation = (summary) => ({ summary, security: [{ customerApiKey: [] }], responses: {
      200: { description: 'OK', headers: {
        'x-hopscotch-request-id': { schema: { type: 'string' } },
        'x-dark': { description: 'Sent only behind a dark flag.', schema: { type: 'string' } },
      } },
    } });
    const base = { openapi: '3.0.3', paths: { '/v1/a': { get: operation('a') }, '/v1/b': { get: operation('b') } } };
    const overlay = { info: { title: 'Test', version: 'v1' }, paths: {
      '/v1/a': { classification: 'public', get: {} }, '/v1/b': { classification: 'public', get: {} },
    }, securitySchemes: { customerApiKey: { type: 'http', scheme: 'bearer' } } };
    write(join(source, 'services/control-plane/openapi.json'), base);
    write(join(source, 'services/control-plane/wrangler.toml'), '[env.production.vars]\nDARK_FLAG_ENABLED = "false"\n');
    write(join(temp, 'api-reference/overlay.public.json'), overlay);
    const run = (...args) => spawnSync(process.execPath, [join(temp, 'scripts/build-public-openapi.mjs'), ...args], { encoding: 'utf8' });
    const headersOf = (path) => Object.keys(JSON.parse(readFileSync(artifactPath, 'utf8')).paths[path].get.responses[200].headers);

    // Without an entry the source's header is published, and --check accepts it.
    assert.equal(run('--source', source).status, 0);
    assert.ok(headersOf('/v1/b').includes('x-dark'));

    // With the entry, --check fails on the artifact that still carries it.
    overlay.withheldResponseHeaders = [ENTRY];
    write(join(temp, 'api-reference/overlay.public.json'), overlay);
    const check = run('--check');
    assert.equal(check.status, 1);
    assert.match(check.stderr, /GET \/v1\/b 200: documents x-dark, which is withheld until DARK_FLAG_ENABLED/);

    // A scoped build of /v1/a removes it from the unselected /v1/b too, and --check passes.
    const scoped = run('--source', source, '--only-path', '/v1/a');
    assert.equal(scoped.status, 0, scoped.stderr);
    assert.deepEqual(headersOf('/v1/a'), ['x-hopscotch-request-id']);
    assert.deepEqual(headersOf('/v1/b'), ['x-hopscotch-request-id']);
    assert.equal(run('--check').status, 0);

    // The overlay may not document a header it withholds.
    overlay.paths['/v1/a'].get = { responses: { 200: { headers: { 'x-dark': { schema: { type: 'string' } } } } } };
    write(join(temp, 'api-reference/overlay.public.json'), overlay);
    const contradictory = run('--source', source);
    assert.equal(contradictory.status, 1);
    assert.match(contradictory.stderr, /documents x-dark, which withheldResponseHeaders withholds/);
    overlay.paths['/v1/a'].get = {};
    write(join(temp, 'api-reference/overlay.public.json'), overlay);

    // Once the flag is on in production the entry is stale and the build says so.
    write(join(source, 'services/control-plane/wrangler.toml'), '[env.production.vars]\nDARK_FLAG_ENABLED = "true"\n');
    const stale = run('--source', source);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /DARK_FLAG_ENABLED is "true" under \[env\.production\.vars\]/);
  } finally {
    assert.ok(isAbsolute(temp) && dirname(resolve(temp)) === resolve(tmpdir()) && basename(temp).startsWith('hopscotch-withheld-headers-'));
    rmSync(temp, { recursive: true, force: true });
  }
});

const JSON_BODY = '/post/requestBody/content/application~1json';

test('withheld source entries name a method pointer, a flag and a reason, once each', () => {
  const entry = { pointer: JSON_BODY, flag: 'DARK_FLAG_ENABLED', reason: 'Dark in production.' };
  const list = (items) => withheldSourceList({ paths: { '/v1/a': { classification: 'public', withheldFromSource: items } } });
  assert.deepEqual(list([entry]), { entries: [{ path: '/v1/a', ...entry }], problems: [] });
  for (const bad of ['x', [{ ...entry, pointer: '/requestBody' }], [{ ...entry, flag: 'x' }], [{ ...entry, reason: '' }], [entry, entry]]) {
    assert.equal(list(bad).problems.length, 1, JSON.stringify(bad));
  }
});

test('a JSON pointer resolves and deletes through escaped segments, and only what it names', () => {
  const item = { post: { requestBody: { content: { 'application/json': { schema: {} }, 'multipart/form-data': { schema: {} } } } } };
  assert.equal(pointerResolves(item, JSON_BODY), true);
  assert.equal(pointerResolves(item, '/post/requestBody/content/text~1plain'), false);
  assert.equal(deletePointer(item, JSON_BODY), true);
  assert.equal(deletePointer(item, JSON_BODY), false);
  assert.deepEqual(Object.keys(item.post.requestBody.content), ['multipart/form-data']);
});

test('real generator withholds a source content type, audits it and refuses a stale pointer', () => {
  const temp = mkdtempSync(join(tmpdir(), 'hopscotch-withheld-headers-'));
  try {
    cpSync(new URL('./', import.meta.url), join(temp, 'scripts'), { recursive: true });
    mkdirSync(join(temp, 'api-reference'));
    const write = (name, value) => writeFileSync(join(temp, 'api-reference', name), JSON.stringify(value));
    const artifactPath = join(temp, 'api-reference/openapi.public.json');
    const ok = { 200: { description: 'OK', headers: { 'x-hopscotch-request-id': { schema: { type: 'string' } } } } };
    const base = { openapi: '3.0.3', paths: { '/v1/a': { post: { security: [{ customerApiKey: [] }], responses: ok, requestBody: { content: {
      'multipart/form-data': { schema: { type: 'object' } },
      'application/json': { schema: { $ref: '#/components/schemas/DarkShape' }, example: { dark: true } },
    } } } } } };
    const overlay = { info: { title: 'Test', version: 'v1' }, paths: { '/v1/a': {
      classification: 'public',
      withheldFromSource: [{ pointer: JSON_BODY, flag: 'DARK_FLAG_ENABLED', reason: 'Dark in production.' }],
      post: { requestBody: { content: { 'multipart/form-data': { example: { model: 'x' } } } } },
    } }, securitySchemes: { customerApiKey: { type: 'http', scheme: 'bearer' } } };
    write('.source-spec.json', base);
    write('overlay.public.json', overlay);
    const run = (...args) => spawnSync(process.execPath, [join(temp, 'scripts/build-public-openapi.mjs'), ...args], { encoding: 'utf8' });

    // The dark JSON body is gone, and a multipart-only body passes on its own example.
    const built = run();
    assert.equal(built.status, 0, built.stderr);
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    assert.deepEqual(Object.keys(artifact.paths['/v1/a'].post.requestBody.content), ['multipart/form-data']);
    assert.equal(run('--check').status, 0);

    // --check fails when the artifact still carries it.
    artifact.paths['/v1/a'].post.requestBody.content['application/json'] = { schema: { type: 'object' }, example: {} };
    writeFileSync(artifactPath, JSON.stringify(artifact));
    const check = run('--check');
    assert.equal(check.status, 1);
    assert.match(check.stderr, /is withheld from the source until DARK_FLAG_ENABLED/);

    // A multipart body with no example anywhere fails the audit.
    overlay.paths['/v1/a'].post = {};
    write('overlay.public.json', overlay);
    assert.match(run().stderr, /has a request body with no example/);

    // A pointer the source no longer has is a stale entry.
    delete base.paths['/v1/a'].post.requestBody.content['application/json'];
    overlay.paths['/v1/a'].post = { requestBody: { content: { 'multipart/form-data': { example: { model: 'x' } } } } };
    write('.source-spec.json', base);
    write('overlay.public.json', overlay);
    const stale = run();
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /source spec no longer has it/);
  } finally {
    assert.ok(isAbsolute(temp) && dirname(resolve(temp)) === resolve(tmpdir()) && basename(temp).startsWith('hopscotch-withheld-headers-'));
    rmSync(temp, { recursive: true, force: true });
  }
});
