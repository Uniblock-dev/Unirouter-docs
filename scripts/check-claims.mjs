#!/usr/bin/env node
/**
 * The numeric claims check (DOCS_PLAN.md section 13 and 16.4).
 *
 * Every digit-bearing token in MDX PROSE has to be a registered claim in
 * claims.yml, or match one of that file's structural allow patterns. Code
 * fences and inline code are exempt: a number inside a sample is data a reader
 * copies, not a promise the product has to keep.
 *
 *   node scripts/check-claims.mjs
 *   node scripts/check-claims.mjs --unused    also report registered claims
 *                                             nothing uses
 */
import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { relative } from 'node:path';
import { parse } from 'yaml';
import { REPO_ROOT, paths } from './lib/paths.mjs';
import { parseMdx, proseLines } from './lib/mdx.mjs';
import { Report, flag } from './lib/report.mjs';

/**
 * A token that could be a claim: any run of non-space characters holding a
 * digit, with sentence punctuation trimmed off the ends. Deliberately greedy,
 * because the cost of a false positive is one registry line and the cost of a
 * false negative is a number nobody can trace.
 */
const CANDIDATE = /[^\s(),;]*\d[^\s(),;]*/g;

const report = new Report('check-claims');
const registry = parse(readFileSync(paths.claims, 'utf8'));

/**
 * Value to claims, plural.
 *
 * Small integers collide honestly: 7 is both the invitation window and a usage
 * range, 100 is both the worked fee example and the smallest spend cap. Keying
 * one claim per value would have forced those apart into fictions. A token is
 * therefore judged against every claim registered for it, and is accepted if
 * ANY of them may be published on this page. It fails only when every claim for
 * that value is blocked, or every gated claim for it excludes this page.
 */
const byValue = new Map();
const ids = new Set();
for (const claim of registry.claims ?? []) {
  if (ids.has(claim.id)) {
    report.fail('claims.yml', `two claims share the id "${claim.id}".`);
  }
  ids.add(claim.id);
  const key = normalise(claim.value);
  if (!byValue.has(key)) byValue.set(key, []);
  byValue.get(key).push(claim);
}

const allowPatterns = (registry.allow_patterns ?? []).map((entry) => ({
  ...entry,
  regex: new RegExp(entry.pattern, 'i'),
}));

const exclude = (registry.exclude ?? []).map(globToRegExp);
const files = [];
for (const pattern of registry.include ?? ['**/*.mdx']) {
  for await (const entry of glob(pattern, { cwd: REPO_ROOT })) {
    const rel = entry.split('\\').join('/');
    if (exclude.some((re) => re.test(rel))) continue;
    files.push(rel);
  }
}
files.sort();

const used = new Set();
report.note(`${byValue.size} registered claim(s) against ${files.length} file(s)`);

for (const rel of files) {
  const parsed = parseMdx(`${REPO_ROOT}/${rel}`);
  const pageId = rel.replace(/\.mdx$/, '');

  for (const { line, text } of proseLines(parsed)) {
    for (const raw of text.match(CANDIDATE) ?? []) {
      const token = trim(raw);
      if (!token) continue;
      if (allowPatterns.some((p) => p.regex.test(token))) continue;

      const candidates = byValue.get(normalise(token));
      if (!candidates) {
        report.fail(
          `${rel}:${line}`,
          `"${token}" is a number in prose with no entry in claims.yml. Register it with a source, move it into a code sample, or take it out.`
        );
        continue;
      }

      for (const claim of candidates) used.add(claim.id);

      const publishable = candidates.filter((claim) => publishableOn(claim, pageId));
      if (publishable.length > 0) {
        for (const claim of publishable) {
          if (claim.status === 'gated') {
            report.note(
              `gated claim in use: ${claim.id} on ${pageId} (gate ${claim.gate}; re-verify before release)`
            );
          }
        }
        continue;
      }

      report.fail(`${rel}:${line}`, whyRefused(token, candidates, pageId));
    }
  }
}

// Numbers spelled as words, e.g. "five" or "eight". Caught by the same
// registry so a writer cannot slip a claim past the check by writing it out.
// Only the values the registry itself spells in words are looked for.
for (const [value, claims] of byValue) {
  if (!/^[a-z]+$/.test(value)) continue;
  const word = new RegExp(`\\b${value}\\b`, 'i');
  for (const rel of files) {
    const pageId = rel.replace(/\.mdx$/, '');
    for (const { line, text } of proseLines(parseMdx(`${REPO_ROOT}/${rel}`))) {
      if (!word.test(text)) continue;
      for (const claim of claims) used.add(claim.id);
      if (!claims.some((claim) => publishableOn(claim, pageId))) {
        report.fail(`${rel}:${line}`, whyRefused(value, claims, pageId));
      }
    }
  }
}

if (flag('unused')) {
  for (const claim of registry.claims ?? []) {
    if (claim.status !== 'blocked' && !used.has(claim.id)) {
      report.note(`registered but unused: ${claim.id} (${claim.value})`);
    }
  }
}

report.finish();

// ---------------------------------------------------------------------------

function trim(token) {
  return token.replace(/^[^\w$#/-]+/, '').replace(/[.,:;!?'"`)]+$/, '');
}

function normalise(value) {
  return String(value).trim().toLowerCase();
}

function collapse(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function globToRegExp(globPattern) {
  let out = '';
  for (let i = 0; i < globPattern.length; i += 1) {
    const c = globPattern[i];
    if (c === '*') {
      if (globPattern[i + 1] === '*') {
        if (globPattern[i + 2] === '/') {
          out += '(?:[^/]+/)*';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    out += '.+^${}()|[]\\?'.includes(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${out}$`);
}
