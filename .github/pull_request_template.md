<!-- Public Mintlify docs site (base: main). Delete these comments before opening the PR. -->

## Type

<!-- Tick every part this PR touches. Leave the first two lines unticked
for a tooling- or docs-only PR. -->
- [ ] New page or section
- [ ] Change to existing pages
- [ ] Get started (`get-started/`)
- [ ] Features (`features/`)
- [ ] Integrations (`integrations/`)
- [ ] Manage (`manage/`)
- [ ] API reference / OpenAPI (`api-reference/`)
- [ ] Site config, nav, theme (`docs.json`, `snippets/`, `brand.css`, `logo/`)
- [ ] Checks and sync scripts (`scripts/`, `.github/`)
- [ ] Resources or other

## What this PR does

<!-- Outcome and why. Link the issue, and the product PR this documents if
any. -->

## What changed

<!-- Pages added, moved or removed. -->
-

## How it was tested

<!-- Check output plus a preview: screenshots of changed pages from `npm run
dev`. -->

```text
$ npm run check
$ npm run check:links
```

## How to undo it

- Revert: `git revert <merge-sha>` on main; the site redeploys from main
- Moved or removed pages: redirects in docs.json to restore or remove
- OpenAPI spec that must be re-synced:

## Checklist

- [ ] `npm run check` passes (openapi, docs.json, banned content, claims, status gates)
- [ ] `npm run check:links` passes; links are extensionless
- [ ] Every product claim is true on prod today (`check:gates:tracker` if a feature's status matters)
- [ ] OpenAPI change: `npm run sync` and `build:openapi` re-run and committed
- [ ] Page moved or removed: redirect added in docs.json
- [ ] Screenshots of changed pages attached
- [ ] No internal names, keys or unreleased features
