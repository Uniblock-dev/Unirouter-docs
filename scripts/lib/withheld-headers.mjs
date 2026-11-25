/**
 * Response headers the source spec documents but production does not send.
 *
 * The source spec describes what the code can do with every flag on. A header
 * that only a dark flag makes the platform send would be a false claim on a
 * public page, and the overlay's deep merge cannot delete a key the base spec
 * has. So the overlay names such headers in `withheldResponseHeaders`, each
 * with the flag that gates it, and the build removes them from every response
 * in the artifact. --check fails if one survives.
 *
 * An entry comes out when its flag is on in production: then the header is
 * true, and it is published like any other.
 */

const FLAG_NAME = /^[A-Z][A-Z0-9_]*$/;
const HEADER_NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Reads and validates the overlay list. Returns `{ entries, problems }`;
 * a problem is a `[where, message]` pair the caller reports as a failure.
 */
export function withheldHeaderList(overlay) {
  const raw = overlay.withheldResponseHeaders;
  const problems = [];
  if (raw === undefined) return { entries: [], problems };
  if (!Array.isArray(raw)) {
    return { entries: [], problems: [['withheldResponseHeaders', 'must be an array of { header, flag, reason }.']] };
  }
  const entries = [];
  const seen = new Set();
  raw.forEach((entry, index) => {
    const where = `withheldResponseHeaders[${index}]`;
    if (!entry || typeof entry !== 'object') {
      problems.push([where, 'must be an object with header, flag and reason.']);
      return;
    }
    const { header, flag, reason } = entry;
    if (typeof header !== 'string' || !HEADER_NAME.test(header)) {
      problems.push([where, 'header must be a lowercase header name.']);
      return;
    }
    if (typeof flag !== 'string' || !FLAG_NAME.test(flag)) {
      problems.push([where, `${header} must name the feature flag that gates it, such as MODEL_ALIAS_LIFECYCLE_ENABLED.`]);
      return;
    }
    if (typeof reason !== 'string' || reason.trim() === '') {
      problems.push([where, `${header} must say why it is withheld.`]);
      return;
    }
    if (seen.has(header)) {
      problems.push([where, `${header} is listed twice.`]);
      return;
    }
    seen.add(header);
    entries.push({ header, flag, reason });
  });
  return { entries, problems };
}

function* responses(spec) {
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(item ?? {})) {
      if (!operation || typeof operation !== 'object') continue;
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (response && typeof response === 'object') yield { where: `${method.toUpperCase()} ${path} ${status}`, response };
      }
    }
  }
}

/** Every place a withheld header is documented, as `{ where, header }`. */
export function findWithheldHeaders(spec, entries) {
  const names = new Set(entries.map((entry) => entry.header));
  const found = [];
  for (const { where, response } of responses(spec)) {
    for (const name of Object.keys(response.headers ?? {})) {
      if (names.has(name.toLowerCase())) found.push({ where, header: name.toLowerCase() });
    }
  }
  return found;
}

/** Removes every withheld header from every response, in place. Returns what it removed. */
export function withholdHeaders(spec, entries) {
  const names = new Set(entries.map((entry) => entry.header));
  const removed = [];
  for (const { where, response } of responses(spec)) {
    if (!response.headers) continue;
    for (const name of Object.keys(response.headers)) {
      if (names.has(name.toLowerCase())) {
        delete response.headers[name];
        removed.push({ where, header: name.toLowerCase() });
      }
    }
  }
  return removed;
}

/**
 * The value a flag takes under `[env.production.vars]` in a wrangler.toml, or
 * undefined when that table does not set it. Only the `NAME = "value"` lines
 * the control plane uses are read; this is not a TOML parser.
 */
export function productionFlagValue(wranglerToml, flag) {
  let inProductionVars = false;
  for (const line of wranglerToml.split(/\r?\n/)) {
    const table = /^\s*\[([^\]]+)\]\s*(#.*)?$/.exec(line);
    if (table) {
      inProductionVars = table[1].trim() === 'env.production.vars';
      continue;
    }
    if (!inProductionVars) continue;
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*"([^"]*)"/.exec(line);
    if (match && match[1] === flag) return match[2];
  }
  return undefined;
}

/**
 * Parts of a source operation production does not serve, removed from the
 * base path item before the overlay is merged over it. The deep merge can add
 * and replace keys but never delete one, so a request shape or a schema
 * variant that only a dark flag serves would otherwise reach the artifact.
 *
 * Declared on an overlay path entry as `withheldFromSource`, a list of
 * `{ pointer, flag, reason }`, where `pointer` is a JSON pointer into that
 * path item, such as `/post/requestBody/content/application~1json`.
 * Returns `{ entries, problems }` like withheldHeaderList, each entry carrying
 * its `path`.
 */
export function withheldSourceList(overlay) {
  const entries = [];
  const problems = [];
  for (const [path, item] of Object.entries(overlay.paths ?? {})) {
    const raw = item?.withheldFromSource;
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) {
      problems.push([`${path} withheldFromSource`, 'must be an array of { pointer, flag, reason }.']);
      continue;
    }
    const seen = new Set();
    raw.forEach((entry, index) => {
      const where = `${path} withheldFromSource[${index}]`;
      const { pointer, flag, reason } = entry ?? {};
      if (typeof pointer !== 'string' || !/^\/(get|put|post|patch|delete)(\/|$)/.test(pointer)) {
        problems.push([where, 'pointer must be a JSON pointer into the path item, starting with its method, such as /post/requestBody/content/application~1json.']);
      } else if (typeof flag !== 'string' || !FLAG_NAME.test(flag)) {
        problems.push([where, `${pointer} must name the feature flag that gates it.`]);
      } else if (typeof reason !== 'string' || reason.trim() === '') {
        problems.push([where, `${pointer} must say why it is withheld.`]);
      } else if (seen.has(pointer)) {
        problems.push([where, `${pointer} is listed twice.`]);
      } else {
        seen.add(pointer);
        entries.push({ path, pointer, flag, reason });
      }
    });
  }
  return { entries, problems };
}

function pointerTokens(pointer) {
  return pointer.split('/').slice(1).map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
}

/** Whether a JSON pointer resolves inside `value`. */
export function pointerResolves(value, pointer) {
  let node = value;
  for (const token of pointerTokens(pointer)) {
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, token)) return false;
    node = node[token];
  }
  return true;
}

/** Deletes what a JSON pointer names inside `value`, in place. Returns whether it was there. */
export function deletePointer(value, pointer) {
  const tokens = pointerTokens(pointer);
  const last = tokens.pop();
  let node = value;
  for (const token of tokens) {
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, token)) return false;
    node = node[token];
  }
  if (!node || typeof node !== 'object' || !Object.hasOwn(node, last)) return false;
  if (Array.isArray(node)) node.splice(Number(last), 1);
  else delete node[last];
  return true;
}
