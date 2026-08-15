/**
 * Git command runner for the plugin's host half. The runner is an injected
 * seam: unit tests script fake results; the production implementation shells
 * out to `git` via node:child_process (the host process runs it directly —
 * argv arrays only, no shell, so branch names can never inject options).
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
        { cwd, windowsHide: true, timeout: this.timeoutMs, maxBuffer: this.maxBuffer },
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
