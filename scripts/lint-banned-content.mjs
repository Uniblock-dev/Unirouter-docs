#!/usr/bin/env node
/**
 * The editorial fence, made mechanical (DOCS_PLAN.md section 13 and 16.3).
 *
 * Reads banned-content.yml and scans every MDX file plus the published OpenAPI
 * artifact. Code fences are scanned too: an internal hostname is just as
 * published inside a code block as outside one. Only the em and en dash rule is
 * prose-only, because it is a voice rule and a dash inside a JSON sample is
 * somebody's data.
 *
 *   node scripts/lint-banned-content.mjs
 */
import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { relative } from 'node:path';
import { parse } from 'yaml';
import { REPO_ROOT, paths } from './lib/paths.mjs';
import { parseMdx } from './lib/mdx.mjs';
import { Report } from './lib/report.mjs';

/** Rules that judge voice rather than disclosure, and so read prose only. */
const PROSE_ONLY = new Set(['em-en-dash']);

const ALLOW_MARKER = 'banned-content-allow:';

const report = new Report('lint-banned-content');
const config = parse(readFileSync(paths.bannedContent, 'utf8'));

const rules = (config.rules ?? []).map((rule) => ({
  ...rule,
  regex: new RegExp(rule.pattern, rule.caseSensitive ? 'g' : 'gi'),
}));

if (rules.length === 0) {
  report.fail('banned-content.yml', 'defines no rules.');
  report.finish();
  process.exit(process.exitCode ?? 0);
}

const files = await collectFiles(config);
report.note(`${rules.length} rule(s) against ${files.length} file(s)`);

for (const file of files) {
  const rel = relative(REPO_ROOT, file).split('\\').join('/');
  if (rel.endsWith('.mdx')) scanMdx(file, rel);
  else scanPlain(file, rel);
}

report.finish();

// ---------------------------------------------------------------------------

async function collectFiles(config) {
  const exclude = (config.exclude ?? []).map(toRegExp);
  const found = new Set();
  for (const pattern of config.include ?? []) {
    for await (const entry of glob(pattern, { cwd: REPO_ROOT })) {
      const rel = entry.split('\\').join('/');
      if (exclude.some((re) => re.test(rel))) continue;
      found.add(`${REPO_ROOT}/${rel}`);
    }
  }
  return [...found].sort();
}

/**
 * Glob to regular expression, for the shapes this config uses: `dir/**`,
 * a double star crossing directories, `*.ext`, and a literal path.
 */
function toRegExp(globPattern) {
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
    if (c === '?') {
      out += '[^/]';
      continue;
    }
    out += '.+^${}()|[]\\'.includes(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${out}$`);
}

function scanMdx(file, rel) {
  const parsed = parseMdx(file);
  const allowed = allowancesFor(parsed.lines, rel);

  for (const segment of parsed.segments) {
    // Only the fence markers themselves are skipped. Inline code and fenced
    // code are published text and are scanned.
    if (segment.kind === 'fence') continue;
    const isProse = segment.kind === 'prose';
    for (const rule of rules) {
      if (PROSE_ONLY.has(rule.id) && !isProse) continue;
      check(rule, segment.text, rel, segment.line, allowed);
    }
  }
}

function scanPlain(file, rel) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const empty = new Map();
  lines.forEach((text, index) => {
    for (const rule of rules) {
      if (PROSE_ONLY.has(rule.id)) continue;
      check(rule, text, rel, index + 1, empty);
    }
  });
}

function check(rule, text, rel, line, allowed) {
  rule.regex.lastIndex = 0;
  const match = rule.regex.exec(text);
  if (!match) return;
  if (allowed.get(line)?.has(rule.id)) return;
  report.fail(
    `${rel}:${line}`,
    `"${match[0]}" matches banned rule ${rule.id}.\n      ${collapse(rule.reason)}`
  );
}

/**
 * Inline allowances, for the page that has to quote a banned string to tell a
 * customer it does not apply to them. The comment goes on the line above:
 *
 *   {'{'}/* banned-content-allow: fork-provenance-fork -- why *{'/'}{'}'}
 *
 * The allowance covers the NEXT line only, and the reason is required, so an
 * allowance is as reviewable as the sentence it lets through.
 */
function allowancesFor(lines, rel) {
  const allowed = new Map();
  lines.forEach((text, index) => {
    const at = text.indexOf(ALLOW_MARKER);
    if (at === -1) return;
    const rest = text
      .slice(at + ALLOW_MARKER.length)
      .replace(/[*/}\s]+$/, '')
      .trim();
    const [ids, reason] = rest.split('--').map((part) => part?.trim());
    if (!reason) {
      report.fail(`${rel}:${index + 1}`, 'an allowance needs a reason after "--".');
      return;
    }
    const target = index + 2;
    if (!allowed.has(target)) allowed.set(target, new Set());
    for (const id of (ids ?? '').split(/[,\s]+/).filter(Boolean)) {
      if (!rules.some((r) => r.id === id)) {
        report.fail(`${rel}:${index + 1}`, `allowance names rule "${id}", which does not exist.`);
      }
      allowed.get(target).add(id);
    }
  });
  return allowed;
}

function collapse(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}
