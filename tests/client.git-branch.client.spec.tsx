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
import { GitBranchSelect, fuzzyMatch, type GitBranchSelectProps } from '../src/client/GitBranchSelect.tsx'
import { en, type GitBranchKey } from '../src/client/locales.ts'
import type { StatusResponse } from '../src/wire.ts'
import css from '../src/client/GitBranchSelect.module.css'

const REPO: StatusResponse = {
  gitAvailable: true,
  repo: true,
  branch: 'main',
  branches: ['feature/one', 'main', 'release/2.0'],
}

const NOT_A_REPO: StatusResponse = { gitAvailable: true, repo: false, branch: null, branches: [] }
const NO_GIT: StatusResponse = { gitAvailable: false, repo: false, branch: null, branches: [] }

const MANY_BRANCHES: StatusResponse = {
  gitAvailable: true,
  repo: true,
  branch: 'main',
  branches: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'],
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
  const props = {
    sessionId: 's1',
    useSessions: (sel: (state: never) => unknown) => sel(sessionsState(overrides.cwd)),
    loadStatus,
    switchBranch,
    t: makeT(en),
  } as unknown as GitBranchSelectProps
  return { props, loadStatus, switchBranch }
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
    expect(rows.map(row => row.textContent)).toEqual(['feature/one', 'main', 'release/2.0'])
    const currentRow = rows.find(row => row.textContent === 'main')
    expect(currentRow?.classList.contains(css.current)).toBe(true)
    expect(currentRow?.getAttribute('aria-checked')).toBe('true')
    expect(rows.filter(row => row.getAttribute('aria-checked') === 'true')).toHaveLength(1)
  })

  it('filters branches with the fuzzy search', async () => {
    const { props } = makeProps({ cwd: 'D:\\repo' })
    const containerEl = render(props)
    await settle()
    click(containerEl.querySelector('button') as Element)

    const input = containerEl.querySelector('input[type="text"]') as HTMLInputElement
    typeQuery(input, 'feo') // subsequence of feature/one
    let rows = [...containerEl.querySelectorAll('[role="menuitemradio"]')]
    expect(rows.map(row => row.textContent)).toEqual(['feature/one'])

    typeQuery(input, 'rel')
    rows = [...containerEl.querySelectorAll('[role="menuitemradio"]')]
    expect(rows.map(row => row.textContent)).toEqual(['release/2.0'])

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
    const feature = rows.find(row => row.textContent === 'feature/one')
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
    click(rows.find(row => row.textContent === 'release/2.0') as Element)
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
