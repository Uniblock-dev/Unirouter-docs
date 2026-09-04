> # Deprecated
>
> This repository moved to **[Uniblock-dev/Unirouter-docs](https://github.com/Uniblock-dev/Unirouter-docs)** on 2026-09-04 and is archived and read-only.
>
> The full history came across with it, which matters here: the public sync point is recorded only in the subject line of each sync commit, as `... move the sync point to <sha>`. Open pull requests and new sync passes go to the new repository.

# Unirouter docs (public)

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
