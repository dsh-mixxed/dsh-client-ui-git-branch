// @vitest-environment jsdom
/**
 * Browser-half component tests for GitBranchSelect: visibility gating (no
 * workspace / no git / not a repo), trigger chrome, the search box with fuzzy
 * filtering, the 5-row scroll list, the current-branch highlight, branch
 * switching, and the failure Toast. Props are stubbed directly (the inject
 * face replaces the fetch calls), no rendering framework beyond react-dom.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { normalizeStatus } from '../src/client/index.ts'
import { GitBranchSelect, fuzzyMatch, isValidBranchName, type GitBranchSelectProps } from '../src/client/GitBranchSelect.tsx'
import { en, type GitBranchKey } from '../src/client/locales.ts'
import type { StatusResponse } from '../src/wire.ts'
import css from '../src/client/GitBranchSelect.module.css'

const REPO: StatusResponse = {
  gitAvailable: true,
  repo: true,
  branch: 'main',
  branches: [
    { name: 'feature/one', upstream: 'origin/feature/one', ahead: 2 },
    { name: 'main', upstream: 'origin/main' },
    { name: 'release/2.0', upstream: 'origin/release/2.0', behind: 3 },
  ],
  remoteOnly: ['origin/feature/new', 'origin/release-candidate'],
}

const NOT_A_REPO: StatusResponse = {
  gitAvailable: true, repo: false, branch: null, branches: [], remoteOnly: [],
}
const NO_GIT: StatusResponse = {
  gitAvailable: false, repo: false, branch: null, branches: [], remoteOnly: [],
}

const MANY_BRANCHES: StatusResponse = {
  gitAvailable: true,
  repo: true,
  branch: 'main',
  branches: [
    { name: 'b1' }, { name: 'b2' }, { name: 'b3' }, { name: 'b4' }, { name: 'b5' },
    { name: 'b6' }, { name: 'b7' },
  ],
  remoteOnly: [],
}

/** Minimal translate: dictionary lookup + {param} interpolation. */
function makeT(dict: Record<GitBranchKey, string>): GitBranchSelectProps['t'] {
  return ((key: string, params?: Record<string, string>) => {
    const template = dict[key as GitBranchKey] ?? key
    return template.replace(/\{(\w+)\}/g, (_, name: string) => params?.[name] ?? `{${name}}`)
  }) as unknown as GitBranchSelectProps['t']
}

function sessionsState(cwd: string | undefined) {
  return { byId: { s1: { cwd } }, ids: ['s1'], current: 's1', phase: 'ready' } as never
}

interface Overrides {
  cwd?: string | undefined
  status?: StatusResponse
  statusError?: Error
  switchError?: Error
  createError?: Error
  trackError?: Error
}

function makeProps(overrides: Overrides = {}) {
  const loadStatus = vi.fn((_cwd: string) =>
    overrides.statusError !== undefined
      ? Promise.reject(overrides.statusError)
      : Promise.resolve(overrides.status ?? REPO),
  )
  const switchBranch = vi.fn((_cwd: string, _branch: string) =>
    overrides.switchError !== undefined
      ? Promise.reject(overrides.switchError)
      : Promise.resolve(),
  )
  const createBranch = vi.fn((_cwd: string, _branch: string) =>
    overrides.createError !== undefined
      ? Promise.reject(overrides.createError)
      : Promise.resolve(),
  )
  const trackRemote = vi.fn((_cwd: string, _branch: string) =>
    overrides.trackError !== undefined
      ? Promise.reject(overrides.trackError)
      : Promise.resolve(),
  )
  const props = {
    sessionId: 's1',
    useSessions: (sel: (state: never) => unknown) => sel(sessionsState(overrides.cwd)),
    loadStatus,
    switchBranch,
    createBranch,
    trackRemote,
    t: makeT(en),
  } as unknown as GitBranchSelectProps
  return { props, loadStatus, switchBranch, createBranch, trackRemote }
}

let container: HTMLElement
let root: Root

function render(props: GitBranchSelectProps): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(<GitBranchSelect {...props} />) })
  return container
}

/** Flush effect-driven promises (the initial status load). */
async function settle(): Promise<void> {
  await act(async () => {})
}

const click = (element: Element): void => {
  act(() => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

/** Type into the search box through the native value setter (React tracking). */
function typeQuery(input: HTMLInputElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

afterEach(() => {
  act(() => { root?.unmount() })
  document.body.innerHTML = ''
})

describe('normalizeStatus', () => {
  it('folds legacy string branches into branch rows (mid-upgrade host)', () => {
    const status = normalizeStatus({
      gitAvailable: true,
      repo: true,
      branch: 'main',
      branches: ['dev', 'main'],
    } as never)
    expect(status.branches).toEqual([{ name: 'dev' }, { name: 'main' }])
  })

  it('defaults remoteOnly to empty when an older host omits it', () => {
    const status = normalizeStatus({
      gitAvailable: true,
      repo: true,
      branch: 'main',
      branches: [{ name: 'main', upstream: 'origin/main', ahead: 2 }],
    } as never)
    expect(status.remoteOnly).toEqual([])
  })

  it('keeps object rows and remoteOnly untouched', () => {
    const status = normalizeStatus({
      gitAvailable: true,
      repo: true,
      branch: 'main',
      branches: [{ name: 'main', upstream: 'origin/main', ahead: 2 }],
      remoteOnly: ['origin/feature'],
    })
    expect(status.branches).toEqual([{ name: 'main', upstream: 'origin/main', ahead: 2 }])
    expect(status.remoteOnly).toEqual(['origin/feature'])
  })
})

describe('fuzzyMatch', () => {
  it('matches substrings case-insensitively', () => {
    expect(fuzzyMatch('FEAT', 'feature/one')).toBe(true)
    expect(fuzzyMatch('main', 'main')).toBe(true)
  })

  it('matches subsequences (fuzzy)', () => {
    expect(fuzzyMatch('r2', 'release/2.0')).toBe(true)
    expect(fuzzyMatch('feo', 'feature/one')).toBe(true)
  })

  it('rejects non-matches and empty queries match everything', () => {
    expect(fuzzyMatch('zzz', 'main')).toBe(false)
    expect(fuzzyMatch('', 'main')).toBe(true)
    expect(fuzzyMatch('   ', 'main')).toBe(true)
  })
})

describe('visibility gating', () => {
  it('renders nothing without a session workspace', async () => {
    const { props } = makeProps({ cwd: undefined })
    const containerEl = render(props)
    await settle()
    expect(containerEl.innerHTML).toBe('')
  })

  it('renders nothing when git is unavailable', async () => {
    const { props } = makeProps({ cwd: 'D:\\plain', status: NO_GIT })
    const containerEl = render(props)
    await settle()
    expect(containerEl.innerHTML).toBe('')
  })

  it('renders nothing when the workspace is not a git repository', async () => {
    const { props } = makeProps({ cwd: 'D:\\plain', status: NOT_A_REPO })
    const containerEl = render(props)
    await settle()
    expect(containerEl.innerHTML).toBe('')
  })

  it('renders the trigger chip with the current branch once status resolves', async () => {
    const { props } = makeProps({ cwd: 'D:\\repo' })
    const containerEl = render(props)
    await settle()
    const trigger = containerEl.querySelector('button')
    expect(trigger).not.toBeNull()
    expect(trigger?.textContent).toContain('main')
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu')
  })
})

describe('menu', () => {
  it('opens with a search box, every branch, and the current branch highlighted', async () => {
    const { props } = makeProps({ cwd: 'D:\\repo' })
    const containerEl = render(props)
    await settle()
    const trigger = containerEl.querySelector('button')
    expect(trigger).not.toBeNull()
    click(trigger as Element)

    const search = containerEl.querySelector('input[type="text"]')
    expect(search).not.toBeNull()
    expect(search?.getAttribute('placeholder')).toBe(en['search.placeholder'])

    const rows = [...containerEl.querySelectorAll('[role="menuitemradio"]')]
    const names = (row: Element) => row.querySelector(`.${css.branchName}`)?.textContent
    // Local group first (with upstream details), then the remote-only group.
    expect(rows.map(names)).toEqual(['feature/one', 'main', 'release/2.0', 'origin/feature/new', 'origin/release-candidate'])
    const currentRow = rows.find(row => names(row) === 'main')
    expect(currentRow?.classList.contains(css.current)).toBe(true)
    expect(currentRow?.getAttribute('aria-checked')).toBe('true')
    expect(rows.filter(row => row.getAttribute('aria-checked') === 'true')).toHaveLength(1)
  })

  it('separates the list into local and remote groups with titles', async () => {
    const { props } = makeProps({ cwd: 'D:\\repo' })
    const containerEl = render(props)
    await settle()
    click(containerEl.querySelector('button') as Element)

    const titles = [...containerEl.querySelectorAll(`.${css.groupTitle}`)]
    expect(titles.map(title => title.textContent)).toEqual([en['group.local'], en['group.remote']])

    const rows = [...containerEl.querySelectorAll('[role="menuitemradio"]')]
    // Remote rows carry no upstream detail and sit after the local group.
    const remoteRow = rows.find(row => row.querySelector(`.${css.branchName}`)?.textContent === 'origin/feature/new')
    expect(remoteRow).not.toBeUndefined()
    expect(remoteRow?.querySelector(`.${css.detail}`)).toBeNull()
  })

  it('searches across both groups at once', async () => {
    const { props } = makeProps({ cwd: 'D:\\repo' })
    const containerEl = render(props)
    await settle()
    click(containerEl.querySelector('button') as Element)

    const input = containerEl.querySelector('input[type="text"]') as HTMLInputElement
    typeQuery(input, 'new') // matches local `feature/new`? no — remote origin/feature/new only
    let rows = [...containerEl.querySelectorAll('[role="menuitemradio"]')]
    let names = (row: Element) => row.querySelector(`.${css.branchName}`)?.textContent
    expect(rows.map(names)).toEqual(['origin/feature/new'])

    typeQuery(input, 'cand') // subsequence of release-candidate
    rows = [...containerEl.querySelectorAll('[role="menuitemradio"]')]
    expect(rows.map(names)).toEqual(['origin/release-candidate'])
  })

  it('tracks a remote-only branch into a local branch on click', async () => {
    const { props, trackRemote } = makeProps({ cwd: 'D:\\repo' })
    const containerEl = render(props)
    await settle()
    click(containerEl.querySelector('button') as Element)

    const rows = [...containerEl.querySelectorAll('[role="menuitemradio"]')]
    const remoteRow = rows.find(row => row.querySelector(`.${css.branchName}`)?.textContent === 'origin/feature/new')
    click(remoteRow as Element)
    expect(trackRemote).toHaveBeenCalledWith('D:\\repo', 'origin/feature/new')
    await settle()
  })

  it('pops the toast when tracking a remote branch fails', async () => {
    const { props } = makeProps({
      cwd: 'D:\\repo',
      trackError: new Error("fatal: a branch named 'feature' already exists"),
    })
    const containerEl = render(props)
    await settle()
    click(containerEl.querySelector('button') as Element)

    const rows = [...containerEl.querySelectorAll('[role="menuitemradio"]')]
    const remoteRow = rows.find(row => row.querySelector(`.${css.branchName}`)?.textContent === 'origin/feature/new')
    click(remoteRow as Element)
    await settle()

    const alert = document.body.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toContain('origin/feature/new')
    expect(alert?.textContent).toContain('already exists')
  })

  it('shows upstream tracking facts under each branch name (VSCode-style)', async () => {
    const { props } = makeProps({ cwd: 'D:\\repo' })
    const containerEl = render(props)
    await settle()
    click(containerEl.querySelector('button') as Element)

    const rows = [...containerEl.querySelectorAll('[role="menuitemradio"]')]
    const detailOf = (row: Element) => row.querySelector(`.${css.detail}`)
    const feature = rows[0] as Element
    expect(detailOf(feature)?.textContent).toContain('origin/feature/one')
    expect(detailOf(feature)?.textContent).toContain('↑2')
    expect(feature.querySelector(`.${css.ahead}`)).not.toBeNull()

    const release = rows[2] as Element
    expect(detailOf(release)?.textContent).toContain('origin/release/2.0')
    expect(detailOf(release)?.textContent).toContain('↓3')
    expect(release.querySelector(`.${css.behind}`)).not.toBeNull()

    // In-sync branches render the upstream only, with no counts.
    const main = rows[1] as Element
    expect(detailOf(main)?.textContent).toContain('origin/main')
    expect(main.querySelector(`.${css.ahead}`)).toBeNull()
    expect(main.querySelector(`.${css.behind}`)).toBeNull()
  })

  it('marks a deleted upstream as gone and omits details for local-only branches', async () => {
    const { props } = makeProps({
      cwd: 'D:\\repo',
      status: {
        gitAvailable: true,
        repo: true,
        branch: 'main',
        branches: [
          { name: 'local-only' },
          { name: 'main', upstream: 'origin/main', gone: true },
        ],
        remoteOnly: [],
      },
    })
    const containerEl = render(props)
    await settle()
    click(containerEl.querySelector('button') as Element)

    const rows = [...containerEl.querySelectorAll('[role="menuitemradio"]')]
    const main = rows.find(row => row.querySelector(`.${css.branchName}`)?.textContent === 'main') as Element
    const gone = main.querySelector(`.${css.gone}`)
    expect(gone).not.toBeNull()
    expect(gone?.textContent).toContain(en['branch.gone'])
    expect(main.querySelector(`.${css.ahead}`)).toBeNull()

    const local = rows.find(row => row.querySelector(`.${css.branchName}`)?.textContent === 'local-only') as Element
    expect(local.querySelector(`.${css.detail}`)).toBeNull()
  })

  it('shows the tracking badge on the trigger when the current branch is out of sync', async () => {
    const { props } = makeProps({
      cwd: 'D:\\repo',
      status: {
        gitAvailable: true,
        repo: true,
        branch: 'feature/one',
        branches: [
          { name: 'feature/one', upstream: 'origin/feature/one', ahead: 2, behind: 1 },
          { name: 'main', upstream: 'origin/main' },
        ],
        remoteOnly: [],
      },
    })
    const containerEl = render(props)
    await settle()
    const trigger = containerEl.querySelector('button') as Element
    expect(trigger.textContent).toContain('↑2')
    expect(trigger.textContent).toContain('↓1')
  })

  it('filters branches with the fuzzy search', async () => {
    const { props } = makeProps({ cwd: 'D:\\repo' })
    const containerEl = render(props)
    await settle()
    click(containerEl.querySelector('button') as Element)

    const input = containerEl.querySelector('input[type="text"]') as HTMLInputElement
    typeQuery(input, 'feo') // subsequence of feature/one
    let rows = [...containerEl.querySelectorAll('[role="menuitemradio"]')]
    let names = (row: Element) => row.querySelector(`.${css.branchName}`)?.textContent
    expect(rows.map(names)).toEqual(['feature/one'])

    typeQuery(input, 'rel')
    rows = [...containerEl.querySelectorAll('[role="menuitemradio"]')]
    // The search spans both groups: `rel` matches the local release branch
    // AND the remote-only release-candidate.
    expect(rows.map(names)).toEqual(['release/2.0', 'origin/release-candidate'])

    typeQuery(input, 'zzz')
    expect(containerEl.querySelectorAll('[role="menuitemradio"]')).toHaveLength(0)
    expect(containerEl.textContent).toContain(en['status.noMatches'])
  })

  it('keeps the internal scroll list for more than five branches', async () => {
    const { props } = makeProps({ cwd: 'D:\\repo', status: MANY_BRANCHES })
    const containerEl = render(props)
    await settle()
    click(containerEl.querySelector('button') as Element)

    const list = containerEl.querySelector(`.${css.list}`)
    expect(list).not.toBeNull()
    // The internal-scroll contract: the list is the scrollport (scrollable).
    expect(list?.classList.contains('scrollable')).toBe(true)
    expect(containerEl.querySelectorAll('[role="menuitemradio"]')).toHaveLength(7)
  })

  it('switches to the clicked branch and closes', async () => {
    const { props, switchBranch } = makeProps({ cwd: 'D:\\repo' })
    const containerEl = render(props)
    await settle()
    click(containerEl.querySelector('button') as Element)

    const rows = [...containerEl.querySelectorAll('[role="menuitemradio"]')]
    const feature = rows.find(row => row.querySelector(`.${css.branchName}`)?.textContent === 'feature/one')
    expect(feature).not.toBeUndefined()
    click(feature as Element)
    expect(switchBranch).toHaveBeenCalledWith('D:\\repo', 'feature/one')
    await settle()
    expect(containerEl.querySelector('[role="menu"]')).toBeNull()
  })

  it('pops the toast with git message when the switch is rejected', async () => {
    const { props } = makeProps({
      cwd: 'D:\\repo',
      switchError: new Error('error: Your local changes to the following files would be overwritten by checkout'),
    })
    const containerEl = render(props)
    await settle()
    click(containerEl.querySelector('button') as Element)

    const rows = [...containerEl.querySelectorAll('[role="menuitemradio"]')]
    click(rows.find(row => row.querySelector(`.${css.branchName}`)?.textContent === 'release/2.0') as Element)
    await settle()

    const alert = document.body.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toContain('Could not switch to “release/2.0”')
    expect(alert?.textContent).toContain('would be overwritten')
  })

  it('closes on Escape', async () => {
    const { props } = makeProps({ cwd: 'D:\\repo' })
    const containerEl = render(props)
    await settle()
    click(containerEl.querySelector('button') as Element)
    expect(containerEl.querySelector('[role="menu"]')).not.toBeNull()
    // Escape bubbles from the trigger up to the seat's root div.
    act(() => {
      containerEl.querySelector('button')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(containerEl.querySelector('[role="menu"]')).toBeNull()
  })
})

describe('isValidBranchName', () => {
  it('accepts ordinary and hierarchical names', () => {
    expect(isValidBranchName('feature/new')).toBe(true)
    expect(isValidBranchName('main')).toBe(true)
    expect(isValidBranchName('  release/2.0  ')).toBe(true)
  })

  it('rejects empty, whitespace, and oversized names', () => {
    expect(isValidBranchName('')).toBe(false)
    expect(isValidBranchName('   ')).toBe(false)
    expect(isValidBranchName('x'.repeat(256))).toBe(false)
  })

  it('rejects forbidden characters and component shapes', () => {
    expect(isValidBranchName('bad name')).toBe(false)
    expect(isValidBranchName('a~b')).toBe(false)
    expect(isValidBranchName('a^b')).toBe(false)
    expect(isValidBranchName('a:b')).toBe(false)
    expect(isValidBranchName('a?b')).toBe(false)
    expect(isValidBranchName('a*b')).toBe(false)
    expect(isValidBranchName('a[b')).toBe(false)
    expect(isValidBranchName('a\\b')).toBe(false)
    expect(isValidBranchName('a..b')).toBe(false)
    expect(isValidBranchName('a@{b')).toBe(false)
    expect(isValidBranchName('-leading')).toBe(false)
    expect(isValidBranchName('.hidden')).toBe(false)
    expect(isValidBranchName('trailing.')).toBe(false)
    expect(isValidBranchName('trailing/')).toBe(false)
    expect(isValidBranchName('a//b')).toBe(false)
    expect(isValidBranchName('a/.b')).toBe(false)
  })
})

describe('create branch', () => {
  function openCreate(containerEl: HTMLElement): void {
    const buttons = [...containerEl.querySelectorAll('button')]
    const create = buttons.find(button => button.textContent === en['create.button'])
    expect(create).not.toBeUndefined()
    click(create as Element)
  }

  it('shows the create action at the bottom of the menu', async () => {
    const { props } = makeProps({ cwd: 'D:\\repo' })
    const containerEl = render(props)
    await settle()
    click(containerEl.querySelector('button') as Element)
    expect(containerEl.textContent).toContain(en['create.button'])
  })

  it('opens the dialog, creates the branch on confirm, and closes', async () => {
    const { props, createBranch } = makeProps({ cwd: 'D:\\repo' })
    const containerEl = render(props)
    await settle()
    click(containerEl.querySelector('button') as Element)
    openCreate(containerEl)

    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain(en['create.title'])

    const input = dialog?.querySelector('input') as HTMLInputElement
    typeQuery(input, 'feature/from-ui')
    const confirm = [...(dialog?.querySelectorAll('button') ?? [])]
      .find(button => button.textContent === en['create.confirm'])
    click(confirm as Element)

    expect(createBranch).toHaveBeenCalledWith('D:\\repo', 'feature/from-ui')
    await settle()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps the dialog open and shows git error when creation fails', async () => {
    const { props, createBranch } = makeProps({
      cwd: 'D:\\repo',
      createError: new Error("fatal: a branch named 'main' already exists"),
    })
    const containerEl = render(props)
    await settle()
    click(containerEl.querySelector('button') as Element)
    openCreate(containerEl)

    const dialog = document.body.querySelector('[role="dialog"]')
    const input = dialog?.querySelector('input') as HTMLInputElement
    typeQuery(input, 'main')
    const confirm = [...(dialog?.querySelectorAll('button') ?? [])]
      .find(button => button.textContent === en['create.confirm'])
    click(confirm as Element)

    expect(createBranch).toHaveBeenCalledWith('D:\\repo', 'main')
    await settle()
    const dialogAfter = document.body.querySelector('[role="dialog"]')
    expect(dialogAfter).not.toBeNull()
    const alert = dialogAfter?.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('already exists')
  })

  it('disables confirm and shows an inline error for an invalid name', async () => {
    const { props, createBranch } = makeProps({ cwd: 'D:\\repo' })
    const containerEl = render(props)
    await settle()
    click(containerEl.querySelector('button') as Element)
    openCreate(containerEl)

    const dialog = document.body.querySelector('[role="dialog"]')
    const input = dialog?.querySelector('input') as HTMLInputElement
    typeQuery(input, 'bad name')

    // The error appears live while typing; confirm stays disabled.
    const alert = dialog?.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain(en['create.error.invalid'])
    const confirm = [...(dialog?.querySelectorAll('button') ?? [])]
      .find(button => button.textContent === en['create.confirm'])
    expect((confirm as HTMLButtonElement).disabled).toBe(true)

    // Enter on the invalid name submits nothing.
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await settle()
    expect(createBranch).not.toHaveBeenCalled()
  })
})
