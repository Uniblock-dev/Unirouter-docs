/** Parse repeated path selections without silently accepting misspelled flags. */
export function selectedPaths(argv, valueFlags, booleanFlags) {
  const paths = [];
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const [name, inline] = argv[index].split(/=(.*)/s, 2);
    if (!valueFlags.includes(name) && !booleanFlags.includes(name) && name !== '--only-path') {
      throw new Error(`Unknown argument: ${name}`);
    }
    if (name !== '--only-path' && seen.has(name)) throw new Error(`Duplicate argument: ${name}`);
    seen.add(name);
    if (booleanFlags.includes(name)) {
      if (inline !== undefined) throw new Error(`${name} takes no value.`);
      continue;
    }
    const value = inline ?? argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
    if (name === '--only-path') {
      if (!value.startsWith('/v1/')) throw new Error('--only-path must name a /v1/ path.');
      if (paths.includes(value)) throw new Error(`Duplicate selected path: ${value}`);
      paths.push(value);
    }
  }
  if (paths.length && seen.has('--check')) throw new Error('--only-path cannot be combined with --check.');
  if (seen.has('--check') && seen.has('--source')) throw new Error('--check cannot be combined with --source.');
  if (seen.has('--ref') && seen.has('--worktree')) throw new Error('--ref cannot be combined with --worktree.');
  return paths;
}

/** Preserve every operation outside the explicitly reviewed paths. */
export function scopedInventory(previous, current, paths) {
  const selected = new Set(paths);
  for (const path of selected) {
    if (!Object.keys(current).some((key) => key.slice(key.indexOf(' ') + 1) === path)) {
      throw new Error(`Selected path is absent from the source: ${path}`);
    }
  }
  const belongs = (key) => selected.has(key.slice(key.indexOf(' ') + 1));
  return Object.fromEntries([
    ...Object.entries(previous).filter(([key]) => !belongs(key)),
    ...Object.entries(current).filter(([key]) => belongs(key)),
  ].sort(([a], [b]) => a.localeCompare(b)));
}

function references(value, found = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => references(item, found));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref' && typeof item === 'string') found.add(item);
      else references(item, found);
    }
  }
  return found;
}

function component(spec, ref) {
  const match = /^#\/components\/([^/]+)\/([^/]+)$/.exec(ref);
  if (!match) throw new Error(`Unsupported component reference in scoped build: ${ref}`);
  const [, group, name] = match;
  const value = spec.components?.[group]?.[name];
  if (value === undefined) throw new Error(`Missing component in scoped build: ${ref}`);
  return { group, name, value };
}

function dependencies(spec, paths) {
  const found = references(paths);
  for (const ref of found) references(component(spec, ref).value, found);
  return found;
}

/** A shared component may change only when every published consumer is selected. */
export function scopedArtifact(previous, current, paths) {
  const selected = new Set(paths);
  for (const path of selected) {
    if (!current.paths[path]) throw new Error(`Selected path is not public in the overlay: ${path}`);
  }
  const selectedEntries = Object.fromEntries(paths.map((path) => [path, current.paths[path]]));
  const retainedEntries = Object.fromEntries(Object.entries(previous.paths).filter(([path]) => !selected.has(path)));
  const retainedRefs = dependencies(previous, retainedEntries);
  const changedRefs = dependencies(current, selectedEntries);
  const result = structuredClone(previous);
  for (const [path, entry] of Object.entries(selectedEntries)) result.paths[path] = structuredClone(entry);
  for (const ref of changedRefs) {
    const { group, name, value } = component(current, ref);
    const old = previous.components?.[group]?.[name];
    if (retainedRefs.has(ref) && JSON.stringify(old) !== JSON.stringify(value)) {
      throw new Error(`Selected changes alter a component used by an unselected operation: ${ref}`);
    }
    result.components[group] ??= {};
    result.components[group][name] = structuredClone(value);
  }
  const usedTags = new Set(Object.values(selectedEntries).flatMap((item) => Object.values(item).flatMap((op) => op.tags ?? [])));
  result.tags ??= [];
  for (const tag of current.tags ?? []) {
    if (usedTags.has(tag.name) && !result.tags.some((held) => held.name === tag.name)) result.tags.push(structuredClone(tag));
  }
  return result;
}
