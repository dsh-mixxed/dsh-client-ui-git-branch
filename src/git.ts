/**
 * Git command runner for the plugin's host half. The runner is an injected
 * seam: unit tests script fake results; the production implementation spawns
 * `git` via node:child_process (the host process runs it directly).
 *
 * Invocation is argv arrays only with `shell: false` — no shell, no string
 * interpolation, so branch names can never become shell commands — and branch
 * names are additionally validated against `git check-ref-format --branch`
 * at the HTTP boundary (refname.ts), so they can never be parsed by git as
 * options either.
 */

import { execFile } from 'node:child_process'

/** One finished git invocation. */
export interface GitCommandResult {
  /** The process exit code; 0 on success. */
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** Executes `git` with the given args in the given directory. */
export interface GitRunner {
  run(args: readonly string[], cwd: string): Promise<GitCommandResult>
}

/** Raised when no `git` executable exists on PATH. */
export class GitUnavailableError extends Error {
  override readonly name = 'GitUnavailableError'
}

export interface ExecGitOptions {
  /** Per-invocation timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Captured-output cap in bytes. */
  readonly maxBuffer?: number
}

/** Production runner: `git` on PATH via execFile, windowsHide for Win32. */
export class ExecGitRunner implements GitRunner {
  private readonly timeoutMs: number
  private readonly maxBuffer: number

  constructor(options: ExecGitOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.maxBuffer = options.maxBuffer ?? 1_048_576
  }

  run(args: readonly string[], cwd: string): Promise<GitCommandResult> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        [...args],
        {
          cwd,
          // Explicit: argv arrays only, never a shell — no metacharacter or
          // option string can reach a shell from here.
          shell: false,
          windowsHide: true,
          timeout: this.timeoutMs,
          maxBuffer: this.maxBuffer,
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ code: 0, stdout, stderr })
            return
          }
          const errno = (error as NodeJS.ErrnoException).code
          if (errno === 'ENOENT') {
            reject(new GitUnavailableError(`git executable not found on PATH (cwd: ${cwd})`))
            return
          }
          resolve({ code: typeof error.code === 'number' ? error.code : 1, stdout, stderr })
        },
      )
    })
  }
}
