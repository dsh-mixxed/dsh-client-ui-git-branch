/**
 * dsh-client-ui-git-branch host half: serves the git branch status and
 * switch API over the plugin's own HTTP routes (`ctx.webServer`). The browser
 * half renders a branch selector in the chat composer (the
 * `conversation.input.right` seat, immediately left of the model select) and
 * talks to these routes over same-origin fetch.
 *
 * Every route reads live state at request time — nothing is cached. Git runs
 * through an injected {@link GitRunner} (production: execFile); a missing git
 * executable is a legitimate state (the UI hides), not an error.
 *
 * @module ui-git-branch
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.webServer Context merge.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { ExecGitRunner, GitUnavailableError, type GitRunner } from './git.ts'
import type { ErrorResponse, StatusResponse, SwitchRequest, SwitchResponse } from './wire.ts'

export const name = 'ui-git-branch'

/** Services required by the plugin routes. */
export const inject = ['webServer']

/** Route prefix under which the plugin serves its API. */
export const API_PREFIX = '/plugin/ui-git-branch'

/** Git stderr markers for a checkout blocked by local changes. */
const CONFLICT_MARKERS = /would be overwritten|local changes/i

/** Uniform error body. */
function errorBody(code: string, message: string): ErrorResponse {
  return { error: { code, message } }
}

/** Write one JSON response with no-store caching. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(text)
}

/** Read the request body (bounded), resolving to its parsed JSON value. */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    req.on('error', reject)
  })
}

/** Narrow an unknown value to a branch switch write, throwing on malformed fields. */
export function parseSwitchRequest(body: unknown): SwitchRequest {
  const value = body as Partial<SwitchRequest> | null
  if (typeof value !== 'object' || value === null) throw new Error('switch request must be an object')
  const { cwd, branch } = value
  if (typeof cwd !== 'string' || cwd.trim().length === 0) throw new Error('switch request requires a cwd')
  if (typeof branch !== 'string' || branch.trim().length === 0) {
    throw new Error('switch request requires a branch name')
  }
  if (/[\r\n]/.test(branch)) throw new Error('branch name must not contain newlines')
  return { cwd, branch: branch.trim() }
}

/**
 * Collect the git status of one directory: availability, work-tree membership,
 * current branch, and the local branch list. Git failures other than "git
 * missing" are contained per probe — a failing probe degrades the field
 * instead of failing the whole status.
 * @param runner - the git runner.
 * @param cwd - the directory to probe.
 * @returns the status view.
 */
export async function statusOf(runner: GitRunner, cwd: string): Promise<StatusResponse> {
  try {
    const version = await runner.run(['--version'], cwd)
    if (version.code !== 0) {
      return { gitAvailable: false, repo: false, branch: null, branches: [] }
    }
  } catch (error) {
    if (error instanceof GitUnavailableError) {
      return { gitAvailable: false, repo: false, branch: null, branches: [] }
    }
    throw error
  }

  const workTree = await runner.run(['rev-parse', '--is-inside-work-tree'], cwd)
  if (workTree.code !== 0 || workTree.stdout.trim() !== 'true') {
    return { gitAvailable: true, repo: false, branch: null, branches: [] }
  }

  const branch = await runner.run(['branch', '--show-current'], cwd)
  const currentBranch = branch.code === 0 && branch.stdout.trim() !== '' ? branch.stdout.trim() : null

  const branches = await runner.run(['branch', '--format=%(refname:short)'], cwd)
  const list = branches.code === 0
    ? branches.stdout.split('\n').map(line => line.trim()).filter(line => line !== '')
    : []
  // Unborn HEAD (a repo with no commits yet): git lists no refs, but the
  // current branch name is still a valid choice — surface it.
  if (list.length === 0 && currentBranch !== null && !list.includes(currentBranch)) {
    list.push(currentBranch)
  }

  return { gitAvailable: true, repo: true, branch: currentBranch, branches: list }
}

/**
 * Switch the work tree to another local branch (`git switch -- <branch>`).
 * A non-zero exit — typically local changes that would be overwritten — is
 * returned as a 409 conflict carrying git's own stderr so the browser can
 * surface the reason verbatim.
 * @param runner - the git runner.
 * @param request - validated switch write.
 * @returns the success body, or a rejection carrying the classified failure.
 */
export async function switchTo(runner: GitRunner, request: SwitchRequest): Promise<SwitchResponse> {
  let result
  try {
    result = await runner.run(['switch', '--', request.branch], request.cwd)
  } catch (error) {
    if (error instanceof GitUnavailableError) {
      throw new SwitchFailure('git-unavailable', error.message, 500)
    }
    throw error
  }
  if (result.code === 0) return { ok: true, branch: request.branch }
  const message = result.stderr.trim() !== '' ? result.stderr.trim() : result.stdout.trim()
  const code = CONFLICT_MARKERS.test(message) ? 'switch-conflict' : 'switch-failed'
  throw new SwitchFailure(code, message !== '' ? message : `git switch exited with code ${result.code}`, 409)
}

/** A classified switch failure carrying the HTTP status to answer. */
export class SwitchFailure extends Error {
  override readonly name = 'SwitchFailure'

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** Plugin body: register the two routes and answer them. */
export function apply(ctx: Context): void {
  const runner = new ExecGitRunner()

  const handleStatus = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const cwd = new URL(req.url ?? '/', 'http://x').searchParams.get('cwd') ?? ''
      if (cwd.trim().length === 0) {
        sendJson(res, 400, errorBody('missing-cwd', 'status requires a cwd query parameter'))
        return
      }
      sendJson(res, 200, await statusOf(runner, cwd))
    } catch (error) {
      sendJson(res, 500, errorBody('status-failed', error instanceof Error ? error.message : String(error)))
    }
  }

  const handleSwitch = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const request = parseSwitchRequest(await readJsonBody(req))
      sendJson(res, 200, await switchTo(runner, request))
    } catch (error) {
      if (error instanceof SwitchFailure) {
        sendJson(res, error.status, errorBody(error.code, error.message))
        return
      }
      sendJson(res, 400, errorBody('bad-request', error instanceof Error ? error.message : String(error)))
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      if (pathname === `${API_PREFIX}/status` && req.method === 'GET') {
        await handleStatus(req, res)
        return
      }
      if (pathname === `${API_PREFIX}/switch` && req.method === 'POST') {
        await handleSwitch(req, res)
        return
      }
      sendJson(res, 404, errorBody('not-found', `unknown ${API_PREFIX} route`))
    },
  }), 'ui-git-branch: routes')
}
