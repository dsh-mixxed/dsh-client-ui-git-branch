/**
 * dsh-client-ui-git-branch browser half: the git branch selector in the chat
 * composer. Registers one `conversation.input.right` entry (the seat rendered
 * immediately left of the model select in the composer tool row), loads the
 * workspace's git status from the host half's HTTP route, and writes branch
 * switches back to it.
 */

import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge (the
// 'conversation.input.right' entry and its InputZone owner share).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the client Context merge and the LocaleNamespaceMap face.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { GitBranchSelect, type GitBranchInjected } from './GitBranchSelect.tsx'
import { en, NS, zh, type GitBranchKey } from './locales.ts'
import type { BranchRow, ErrorResponse, StatusResponse, SwitchRequest } from '../wire.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The git branch composer seat copy. */
    gitBranch: GitBranchKey
  }
}

export { NS }

/** Services required by the composer-seat registration. */
export const inject = ['slots', 'locale']

/**
 * Normalize the status payload: a running instance may still carry an older
 * node half whose `branches` are plain name strings (the client bundle
 * hot-updates ahead of the host process, which cannot reload ESM in place).
 * Fold those rows to the object shape so the list never renders blank while
 * the process is mid-upgrade.
 * @param body - the parsed status payload.
 * @returns the normalized status.
 */
export function normalizeStatus(body: StatusResponse): StatusResponse {
  const branches = (body.branches as readonly unknown[]).map(row =>
    typeof row === 'string' ? { name: row } : row as BranchRow,
  )
  return { ...body, branches }
}

/** Load the git status of one workspace directory, rejecting on transport or HTTP errors. */
async function loadStatus(cwd: string): Promise<StatusResponse> {
  const response = await fetch(`/plugin/ui-git-branch/status?cwd=${encodeURIComponent(cwd)}`, {
    headers: { accept: 'application/json' },
  })
  const body = await response.json() as StatusResponse | ErrorResponse
  if (!response.ok || !('gitAvailable' in body)) {
    const message = 'error' in body
      ? `${body.error.code}: ${body.error.message}`
      : `status request failed with status ${response.status}`
    throw new Error(message)
  }
  return normalizeStatus(body)
}

/** Switch the work tree to another local branch, rejecting with git's own message. */
async function switchBranch(cwd: string, branch: string): Promise<void> {
  const request: SwitchRequest = { cwd, branch }
  const response = await fetch('/plugin/ui-git-branch/switch', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as ErrorResponse | null
    const message = body?.error !== undefined
      ? body.error.message
      : `switch request failed with status ${response.status}`
    throw new Error(message)
  }
}

/** Create a branch from HEAD and check it out, rejecting with git's own message. */
async function createBranch(cwd: string, branch: string): Promise<void> {
  const request: SwitchRequest = { cwd, branch }
  const response = await fetch('/plugin/ui-git-branch/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as ErrorResponse | null
    const message = body?.error !== undefined
      ? body.error.message
      : `create request failed with status ${response.status}`
    throw new Error(message)
  }
}

/** Contribute the git branch seat to the composer tool row. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-git-branch: dictionaries')

  const injected = (): GitBranchInjected => ({ loadStatus, switchBranch, createBranch })

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'git-branch',
    order: 100,
    locale: NS,
    inject: injected,
  }, GitBranchSelect))
}
