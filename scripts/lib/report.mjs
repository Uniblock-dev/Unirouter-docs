/**
 * One reporting shape for every check in this repository.
 *
 * A check collects failures and notes rather than throwing on the first one,
 * because a writer fixing docs wants the whole list in one run.
 */
export class Report {
  constructor(name) {
    this.name = name;
    this.failures = [];
    this.notes = [];
  }

  fail(where, message) {
    this.failures.push({ where, message });
  }

  note(message) {
    this.notes.push(message);
  }

  /** Prints the result and exits non-zero when anything failed. */
  finish() {
    for (const note of this.notes) {
      console.log(`  ${note}`);
    }
    if (this.failures.length === 0) {
      console.log(`OK  ${this.name}`);
      return;
    }
    console.error(`\nFAIL  ${this.name}`);
    for (const { where, message } of this.failures) {
      console.error(`  ${where}: ${message}`);
    }
    console.error(
      `\n${this.failures.length} problem${this.failures.length === 1 ? '' : 's'}.`
    );
    process.exitCode = 1;
  }
}

export function flag(name) {
  return process.argv.includes(`--${name}`);
}

export function option(name, fallback = undefined) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }
  return fallback;
}
