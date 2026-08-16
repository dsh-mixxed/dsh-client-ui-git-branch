/**
 * Authoritative branch-name validation shared by both plugin halves.
 *
 * The rule set mirrors `git check-ref-format --branch` (verified against git
 * 2.x: the same names git accepts when creating/checking out a branch are
 * accepted here, including the case-sensitive `HEAD` ban and the rejection of
 * any slash component ending in `.lock`). It is deliberately stricter than
 * the plain ref rules in one spot: a name may not start with `-`, which is
 * exactly what `check-ref-format --branch` enforces and what closes the
 * option-parsing surface — combined with argv-array invocation (`shell:
 * false`, see git.ts) and the `--` separator in switchTo, no user-controlled
 * string can ever be interpreted by git as an option.
 *
 * Rules:
 * - non-empty, at most 255 characters (practical cap; the browser UI and the
 *   host API agree on it);
 * - no component may start with `.` (`(?!\.)`, `(?!.*\/\.)`);
 * - no `..` anywhere (`(?!.*\.\.)`);
 * - no component may end with `.lock` (`(?!.*\.lock(?=\/|$))`);
 * - no leading `/`, no trailing `/`, no `//` (`(?!\/)`, `(?!.*\/$)`,
 *   `(?!.*\/\/)`);
 * - no trailing `.` (`(?!.*\.$)`);
 * - no `@{` anywhere (`(?!.*@\{)`); a lone `@` is fine, as in git;
 * - no `~ ^ : ? * [ \`, no space, no control characters (the negated class;
 *   `\s` also covers tab/newline, which would otherwise corrupt
 *   `for-each-ref` tab-separated output parsing);
 * - not exactly `HEAD` (case-sensitive, like git) (`(?!HEAD$)`);
 * - must not start with `-` (`(?!-)`).
 *
 * The host half enforces this on every write route (parseSwitchRequest); the
 * browser half uses it for live create-input validation so both sides reject
 * exactly the same names.
 */

const VALID_BRANCH_NAME = /^(?!HEAD$)(?!\.)(?!\/)(?!-)(?!.*\/\/)(?!.*\/\.)(?!.*\/$)(?!.*\.\.)(?!.*\.$)(?!.*\.lock(?=\/|$))(?!.*@\{)[^~^:?*\[\s\\\u0000-\u001F\u007F]+$/

/**
 * Whether `name` is acceptable as a git branch name.
 * @param name - the raw name (leading/trailing whitespace is ignored).
 * @returns true when git would accept `name` for branch creation/checkout.
 */
export function isValidBranchName(name: string): boolean {
  const value = name.trim()
  if (value === '' || value.length > 255) return false
  return VALID_BRANCH_NAME.test(value)
}
