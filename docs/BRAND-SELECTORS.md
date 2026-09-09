# The Mintlify selectors `brand.css` depends on

`brand.css` styles Mintlify's own components. Mintlify does not version the DOM
those components render, so every selector in the file's "Component parts"
section is a bet that a name still exists. This file is the record of what was
bet on, when it was checked, and where to look to check it again.

**Checked against:** `mint` 4.2.823, 2026-09-09, by reading the rendered DOM of
this site under `npm run dev` rather than by reading Mintlify's documentation.
Every row below was observed on the page named in it.

## How to re-check after a Mintlify upgrade

```bash
npm run dev
```

Then, in the browser console on each page in the "Seen on" column:

```js
[...new Set([...document.querySelectorAll('[data-component-part]')]
  .map((e) => e.getAttribute('data-component-part')))].sort()
```

Anything in the table below that no longer appears in that list, or no longer
carries the class named, is a rule in `brand.css` that has silently stopped
applying. CSS fails quietly: there is no error and no warning, the page just
goes back to looking like Mintlify's, so this check is the only thing that
catches it.

## The two kinds of hook, and how much each is trusted

| Kind | Example | Trust |
|---|---|---|
| `data-component-part` attribute | `[data-component-part="card-title"]` | Highest. Mintlify's CSS guidance names these as the supported way in. |
| Semantic class name | `.card`, `.api-section` | Lower. These are hand-written names that sit alongside the utility classes on the same element. Mintlify's guidance points at them, but they are still class names. |
| Tailwind utility class | `.rounded-2xl`, `.dark:text-white` | **Never used.** A utility is a rendering detail, and keying to one is how a stylesheet breaks on a Tuesday. |
| Mintlify CSS variable | `--primary`, `--rounded-xl` | **Never read or written.** |

## Why the rules win: layers, not specificity

Mintlify is Tailwind v4, so every utility on the page lives in
`@layer utilities`. `brand.css` is unlayered, and unlayered CSS beats layered
CSS regardless of specificity. That is why a flat
`[data-component-part="card-title"]` overrides a `dark:text-white` that resolves
to the twice-as-specific `.dark .dark\:text-white`, and it is why nothing in
`brand.css` needs a specificity ladder.

The exception is an `!important` utility, which beats an unlayered normal
declaration. Mintlify uses a few. The known one is on the API panels' code
blocks; see the last row of the table.

## The table

| Selector | Kind | Targets | Seen on |
|---|---|---|---|
| `.card` | class | The Card plate | `/` |
| `[data-component-part="card-icon"]` | part | The icon slot | `/` |
| `[data-component-part="card-title"]` | part | The `<h2>` title | `/` |
| `[data-component-part="card-content"]` | part | The description | `/` |
| `[data-component-part="card-content-container"]` | part | Title + description wrapper. Observed, not currently styled | `/` |
| `details.accordion` | class | One Accordion, standalone or in a group | `/resources/faq` |
| `.accordion-group` | class | The `<AccordionGroup>` wrapper | `/resources/faq` |
| `[data-component-part="accordion-button"]` | part | The `<summary>` row | `/resources/faq` |
| `[data-component-part="accordion-title"]` | part | The title text | `/resources/faq` |
| `[data-component-part="accordion-caret-right"]` | part | The disclosure caret | `/resources/faq` |
| `[data-component-part="accordion-content"]` | part | The body | `/resources/faq` |
| `[data-component-part="accordion-title-container"]` | part | Observed, not currently styled | `/resources/faq` |
| `.callout` | class | Note / Warning / Info / Tip plate | `/api-reference/introduction` |
| `[data-component-part="callout-content"]` | part | The prose inside a callout | `/api-reference/introduction` |
| `[data-component-part="callout-icon"]` | part | The kind mark. Deliberately left Mintlify's colour, which is the whole signal once the plate goes neutral | `/api-reference/introduction` |
| `[data-component-part="code-block-root"]` | part | One code block's frame | everywhere |
| `[data-component-part="code-block-header"]` | part | The header strip | `/get-started/quickstart` |
| `[data-component-part="code-block-header-filename"]` | part | The filename in it | `/get-started/quickstart` |
| `[data-component-part="code-group-tab-bar"]` | part | `<CodeGroup>` tabs | `/get-started/quickstart` |
| `[data-component-part="code-group-tab-content"]` | part | Observed, not currently styled | `/get-started/quickstart` |
| `[data-component-part="step-number"]` | part | A `<Steps>` marker's wrapper. The marker itself is an unnamed child, so the fill is set with a descendant rule | `/get-started/quickstart` |
| `[data-component-part="step-title"]` | part | A step's title | `/get-started/quickstart` |
| `[data-component-part="step-line"]` | part | The connector between steps | `/get-started/quickstart` |
| `[data-component-part="step-content"]` | part | A step's body. Observed, not currently styled | `/get-started/quickstart` |
| `.api-section` | class | One section of an endpoint page | `/api-reference/models/list-models` |
| `.api-section-heading-title` | class | Its heading | same |
| `.api-section-heading-subtitle` | class | Its sub-line | same |
| `.param-head` | class | One parameter row | same |
| `.primitive-param-field`, `.array-param-field`, `.object-param-field` | class | The row's wrapper, by schema kind | same |
| `[data-component-part="field-name"]` | part | The parameter name | same |
| `[data-component-part="field-meta"]` | part | Its type and constraints | same |
| `[data-component-part="field-required-pill"]` | part | The `required` badge | same |
| `[data-component-part="field-info-pill"]` | part | A constraint badge | same |
| `.method-pill`, `.method-nav-pill` | class | The HTTP verb stamp, in the page and in the sidebar | same |
| `.tryit-button` | class | The playground's commit button | same |
| `[data-component-part="expandable-button"]` | part | A nested-schema toggle | same |
| `[data-component-part="expandable-content"]` | part | Its body | same |
| `html.dark` | class | How Mintlify signals dark mode. The only place in `brand.css` that knows this | everywhere |

## Things found and deliberately not styled

- **`.method-pill`'s hue.** A verb is arguably a failure class, so under the
  design's own rule it may carry colour, but nothing in the DOM says *which*
  verb a pill is. The word is text, and CSS cannot match on text. Mapping GET to
  blue would mean keying off the Tailwind colour utilities Mintlify puts on the
  element, which is the one kind of selector this file refuses. The pill gets
  the `StageTag` *form* and keeps Mintlify's hue until there is an attribute to
  hang a mapping on.
- **The code block's fill and syntax colours.** Set in `docs.json` under
  `styling.codeblocks.theme`, which is a supported key, and also arriving as an
  inline style. Both are reasons to leave them alone.
- **The code block's radius.** Mintlify pins it to 14px inside the API panels
  with an `!important` arbitrary variant. Setting anything else in `brand.css`
  would give one page two different code-block radii, so the radius is left
  alone; 14px is `panel` on the dashboard's own ladder, so the value it lands on
  is one the design already has a name for.
- **The Try-it drawer's internals.** The drawer renders on demand and was not
  open when this inventory was taken. Its parts are unrecorded and unstyled.

## The identity accents

The eight accents are ported from `apps/dashboard/src/lib/accents.ts` in
Gateway-LLM, which is the single vendor mapping in the product. If a vendor is
added there, add it to `brand.css` in the same shape.

Usage in MDX:

```mdx
<span data-provider="openai">OpenAI</span>
```

That renders the name in the prose colour with the vendor's own two-pixel mark
in front of it, which is what `ProviderDot` draws in the dashboard. The word
itself is **not** coloured, and that is measured rather than squeamish: the
accents are built to work as fills and marks in both themes, not as type.
`--uni-blue` on the light ground `#f1f0ea` is about 2.3:1, well under the 4.5:1
text is held to, and four of the eight are worse. The product does not colour
the word either (`ProviderDot` colours a dot and `PROVIDER_LABELS` supplies
the text), so the mark is both the legible port and the faithful one.

Where a page wants the vendor's colour as a fill, add `data-mark="tag"` and it
draws as a `StageTag`: the accent as the plate, `#111110` (`void`) as the type,
square corners.

```mdx
<span data-provider="groq" data-mark="tag">Groq</span>
```

**Nothing in the docs uses either form today.** Every provider slug in the
corpus sits inside a code fence, where a `<span>` cannot go, and
`concepts/models.mdx` states that the list of providers we hold accounts with is
not published. Putting provider names into prose is an editorial decision about
that policy, not a styling one, so the mechanism is shipped and left unused
rather than retrofitted.
