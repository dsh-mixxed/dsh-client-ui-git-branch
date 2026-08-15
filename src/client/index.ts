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
import type { ErrorResponse, StatusResponse, SwitchRequest } from '../wire.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The git branch composer seat copy. */
    gitBranch: GitBranchKey
  }
}

export { NS }

/** Services required by the composer-seat registration. */
export const inject = ['slots', 'locale']

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
  return body
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

/** Contribute the git branch seat to the composer tool row. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-git-branch: dictionaries')

  const injected = (): GitBranchInjected => ({ loadStatus, switchBranch })

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'git-branch',
    order: 100,
    locale: NS,
    inject: injected,
  }, GitBranchSelect))
}
