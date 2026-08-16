/**
 * Wire contract for the dsh-client-ui-git-branch API. The host half produces
 * it; the browser half consumes it over the plugin's HTTP route. Keep this
 * file type-only: both halves import it and it must never carry runtime code
 * into a bundle.
 */

/** One local branch with its upstream-tracking facts, as the browser renders it. */
export interface BranchRow {
  /** Local branch name. */
  readonly name: string
  /** Upstream tracking branch short name (`origin/main`); absent = local-only. */
  readonly upstream?: string
  /** Commits this branch is ahead of its upstream (unpushed). */
  readonly ahead?: number
  /** Commits this branch is behind its upstream (unpulled). */
  readonly behind?: number
  /** True when the configured upstream ref no longer exists (git `[gone]`). */
  readonly gone?: boolean
}

/** The git state of one session workspace, as the browser renders it. */
export interface StatusResponse {
  /** Whether a `git` executable is available on PATH. */
  readonly gitAvailable: boolean
  /** Whether cwd (or an ancestor) lies inside a git work tree. */
  readonly repo: boolean
  /** The current branch name; null on a detached HEAD. */
  readonly branch: string | null
  /** Local branches with upstream-tracking facts (git branch order). */
  readonly branches: readonly BranchRow[]
}

/** One branch-switch write sent to POST /plugin/ui-git-branch/switch. */
export interface SwitchRequest {
  /** The session workspace path git commands run in. */
  readonly cwd: string
  /** The target local branch name. */
  readonly branch: string
}

/** Successful switch response. */
export interface SwitchResponse {
  readonly ok: true
  /** The branch the work tree is now on. */
  readonly branch: string
}

/**
 * Successful create-and-checkout response (POST /plugin/ui-git-branch/create):
 * the new branch is created from HEAD and checked out.
 */
export interface CreateResponse {
  readonly ok: true
  /** The newly created branch the work tree is now on. */
  readonly branch: string
}

/** Uniform plugin-route error body. */
export interface ErrorResponse {
  readonly error: { readonly code: string; readonly message: string }
}
