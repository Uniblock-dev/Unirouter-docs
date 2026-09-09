# Hopscotch docs (public)

The customer-facing Mintlify site. It carries only what a customer can act on:
published `/v1` operations, error codes, money and limits, and the dashboard
guides.

Migrated from `Uniblock-dev/Gateway-LLM-Docs` on 2026-09-04 with its history
intact. That history is load-bearing: the public sync point is recorded only in
the subject line of each sync commit, as `... move the sync point to <sha>`.

## The contract

`DOCS_PLAN.md` is the planning authority. Four sections do most of the work:

| Section | What it settles |
|---|---|
| 7 | The page catalog, and which pages are blocked |
| 8 | The OpenAPI strategy: a derived public artifact, never a repo spec verbatim |
| 13 | The must-not-publish register, enforced by the banned-content linter |
| 14 | Known drift and the open questions that gate docs work |

## Checks

```
npm run check
```

Runs, in order: the OpenAPI artifact build in `--check` mode, the `docs.json`
validator, the banned-content linter, the claims registry check, and the status
gate check. CI runs `npm run ci`, which is the same set with the status gate
allowed to tolerate missing pages.

## Local preview

```
npm run dev
```

If this exits with `RangeError: Maximum call stack size exceeded` before the
server binds, count the files under the repository root:

```
find . -type f | wc -l
```

Mintlify's prebuild walks the whole content directory with `getFileListSync`,
which applies no ignore list at all — not `.mintignore`, not `.gitignore`, not
even `.git` — and collects the result with `files.push(...recursiveCall())`.
Spreading an array into `push` passes one argument per element, so once the walk
exceeds V8's argument limit the call overflows the stack. The ceiling measured
on Node 24 sits between 124,000 and 167,000 files.

Nothing in `docs.json` or `.mintignore` raises that ceiling, so the fix is to
keep the file count down. In practice the cause is a `node_modules` inside a
`.claude/worktrees/*` checkout: each one adds about 41,500 files, so three
worktrees are enough on their own to break the preview. Deleting
`node_modules` from the worktrees you are not currently building in is enough,
and costs nothing that `npm install` will not regenerate.

The error itself gives no hint of this. Mintlify's `dev` handler lets the
`RangeError` reach yargs, whose failure path prints the command's usage text
followed by the error with no stack, so the terminal shows a help screen and one
bracketed line.

## Syncing against the source tree

The source repository is read-only from here. A sync pass runs:

```
node scripts/sync-source-spec.mjs --source <path to a Gateway-LLM checkout>
```

which reports how the public `/v1` surface moved against
`api-reference/source-spec.lock.json`, and takes `--write-lock` once those
differences have been reviewed. `npm run build:openapi` then rebuilds
`api-reference/openapi.public.json` from the base spec plus
`api-reference/overlay.public.json`.

A new `/v1` path absent from the overlay fails the build by design: it forces a
human decision, and `blocked` with a gate is a valid answer.

## Findings

This repository keeps no findings register of its own. A public-surface finding
that needs an owner is recorded in the internal docs repository's
`docs-project/unresolved-findings.md` and named in the pull request body here.
