# Documentation project instructions

## About this project

- The customer-facing Mintlify site for Hopscotch. Pages are MDX with YAML frontmatter; configuration lives in `docs.json`.
- `DOCS_PLAN.md` is the planning authority. Read sections 7, 8, 13 and 14 before writing.
- The source repository (`Gateway-LLM`) is **read-only** from here: no edits, no generation, no installs. Never open `.env*`, `.dev.vars`, or anything credential-shaped. Secret names may be cited; values never.

## What this site may carry

Only what a customer can act on: published `/v1` operations, error codes, money and limits, dashboard guides.

The story's `status` in the ticket tree `_bmad-output/initiative-gateway-llm/tickets/` in the source tree is the arbiter of what has shipped. Read it on `origin/main`, because main is what production runs; `npm run check:gates:tracker` checks it. **This site never claims unshipped behavior.** A page that is true but gated carries `gates: [<story>]` in its frontmatter, and the release checklist holds it until the tracker says `done`. A move into `review` is not acceptance.

## What this site must never carry

`DOCS_PLAN.md` section 13 is the register and the banned-content linter enforces it. The short version: no fork provenance, no provider topology or procurement, no provider credentials in any form, no unit economics, no staff surfaces or `/admin` routes, no signals or billing-mail ingestion, no internal architecture nouns, no unproven security claims, no unsettled strings, and no number that is not in the claims registry.

## Page tone and budgets

- **Gating lives in frontmatter, not in prose.** A page that is true but not yet released carries `gates:` and the release checklist holds it. Do not write "not available yet" banners or `<FeatureStatus>` tags on Get started pages or `index.mdx`.
- **Explain a topic once, on its canonical page.** Every other page links to it. Repeating an explanation is a defect, not emphasis.
- **Word budgets are soft and per type, see `templates/`.** Each type's budget is the "Soft word budget" comment in its template. `npm run check:budget` prints a `WARN` line for a page with no `type:`, an unknown type, a missing or out-of-order required heading, a page over its type's budget, and each gated tag in the Get started pages. It warns and never fails the build, so a warning is a prompt to fix, not a blocker.

### Adding a page

Every page names its `type:` in frontmatter. The template for that type is `templates/<type>.mdx`. Its `##` headings are the required headings, which must appear in that order, and its comment gives the word budget.

| Type | Use for | Budget (words) | Required headings | Folders |
|---|---|---|---|---|
| `quickstart` | The first working request, start to finish | 500 | Before you start, Set the base URL, Send your first request, If it fails, Next | `get-started/quickstart` |
| `guide` | A task a reader does, with steps and the refusals they meet | 1,800 | How to, Next | `features/`, `manage/`, `get-started/` how-to pages |
| `concept` | One mechanism, explained once, with no steps | 800 | none | `features/`, `manage/` explanation pages |
| `integration` | One external tool or framework connected to the API | 900 | What we did not verify | `integrations/` |
| `overview` | Orientation for a section: what it holds and where to go next | 700 | none | `index`, `*/overview` |
| `reference` | Looked up by question: parameters, errors, headers, glossary, FAQ | 3,500 | none | `api-reference/`, `resources/` |

1. Copy `templates/<type>.mdx` to its new path, for example `features/new-page.mdx`.
2. Set the title and description, then fill each heading. Delete each placeholder comment as you fill its heading.
3. Put the page in `docs.json`, once.
4. Run `npm run check`. A `WARN` for a missing `type:`, a missing heading or a page over budget is a prompt to fix before the pull request. The warnings do not fail the run, but fix them when you can.

Templates are never published (`.mintignore`) and are excluded from the banned-content, claims, status-gate and orphan checks. A template is a file to copy, never a page.

## Rules that break a pass

- **Handlers win every disagreement with an OpenAPI spec.** The spec is generated from handler code.
- **No em or en dashes in authored prose.** This mirrors the source repository's pre-commit hook.
- **No exact test or line counts in prose.** Write what a suite covers.
- **A claim that cannot be grounded gets `unknown`**, plus a findings entry and a sentence saying what evidence is missing. Not a guess, not an omission.
- **Every number a page publishes must be in `claims.yml`** with its source and status. The linter fails any digit-bearing claim that is not.
- **A page never silently reconciles a drift.** It states both sides, names the winner, and says why.
- **Nothing here becomes an authority the source tree contradicts.** Where this site and the tree disagree, the tree is right and this site has a bug.

## The API reference is generated

Never hand-edit `api-reference/openapi.public.json`. It is built from the synced base spec plus `api-reference/overlay.public.json`. Change the overlay, then run `npm run build:openapi`.

A new `/v1` path that the overlay does not classify fails the build on purpose. Classify it `public` or `blocked` with a `gate`, and transcribe every example from the named handler rather than inventing one.

## Before opening a pull request

```
npm run check
```

When a sibling `Gateway-LLM` checkout exists, also run `npm run check:gates:tracker`.

Open pull requests against `main`. Findings that need an owner go in the internal docs repository's `docs-project/unresolved-findings.md` and are named in the pull request body here.
