/**
 * What counts as a page in docs.json navigation.
 *
 * One definition, shared, so two checks cannot disagree about whether a tab
 * label is a page. A string is a page only when it was reached through a
 * `pages` array or a `root` key; every other string in the tree is a label on
 * the chrome (`tab`, `group`, `anchor`, `dropdown`) or an external target.
 */
export function collectNavPages(node, found = [], inPages = false) {
  if (typeof node === 'string') {
    if (inPages && !/^https?:/.test(node)) found.push(node);
    return found;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectNavPages(item, found, inPages);
    return found;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      // `openapi` names a spec file whose endpoint pages are generated;
      // `href` is an external link.
      if (key === 'openapi' || key === 'asyncapi' || key === 'href') continue;
      collectNavPages(value, found, inPages || key === 'pages' || key === 'root');
    }
  }
  return found;
}
