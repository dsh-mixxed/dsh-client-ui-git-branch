/**
 * GitBranchSelect: the composer's git branch seat (`conversation.input.right`),
 * rendered immediately LEFT of the model seat in the same tool row. Visible
 * only while the session workspace is inside a git work tree and a `git`
 * executable exists. The trigger is a chip (branch icon + current branch +
 * chevron) mirroring the model seat's chrome; the menu carries a fuzzy-search
 * box above a branch list that shows at most 5 rows and scrolls internally.
 * The current branch is marked in the brand-blue business tone; picking
 * another branch switches the work tree via the host route, and a rejected
 * switch (uncommitted changes blocking checkout, …) announces git's own
 * stderr through the shared transient Toast anchored to the composer card.
 */
import {
  useCallback, useEffect, useId, useMemo, useRef, useState,
  type FocusEvent, type KeyboardEvent,
} from 'react'
import clsx from 'clsx'
import {
  IconBranchOutline16, IconCheckOutline16, IconChevronDownOutline14,
  IconSearchOutline16, IconWarningOutline16, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { StatusResponse } from '../wire.ts'
import css from './GitBranchSelect.module.css'

/** Injected business face: same-origin calls to the host half's routes. */
export interface GitBranchInjected {
  /** Load the git status of one workspace directory. */
  loadStatus: (cwd: string) => Promise<StatusResponse>
  /** Switch the work tree to another local branch; rejects with the git error. */
  switchBranch: (cwd: string, branch: string) => Promise<void>
}

/** Full props: runtime (owner + standard kit) + injected face + locale seat. */
export type GitBranchSelectProps =
  PropsRuntime<'conversation.input.right'> & GitBranchInjected & PropsLocale<'gitBranch'>

/**
 * Case-insensitive fuzzy match: a branch matches when the query is a
 * substring of it, or when the query characters appear in order (subsequence).
 * @param query - the raw search input.
 * @param branch - one branch name.
 * @returns whether the branch matches.
 */
export function fuzzyMatch(query: string, branch: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  const text = branch.toLowerCase()
  if (text.includes(q)) return true
  let at = 0
  for (const ch of text) {
    if (ch === q[at]) at += 1
    if (at === q.length) return true
  }
  return false
}

/** Render the composer git branch seat. */
export function GitBranchSelect(
  { sessionId, useSessions, loadStatus, switchBranch, t }: GitBranchSelectProps,
) {
  // The session workspace root, read from the standard session-list seat
  // (same canon the workspace picker and tool rows use).
  const cwd = useSessions(state => sessionId === undefined ? undefined : state.byId[sessionId]?.cwd)

  const [open, setOpen] = useState(false)
  const [data, setData] = useState<StatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  // Stale-response guard: only the latest requested status may land.
  const requestSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  const load = useCallback((silent: boolean): void => {
    if (cwd === undefined) return
    if (!silent) setLoading(true)
    setLoadError(null)
    const seq = ++requestSeq.current
    loadStatus(cwd).then(
      (status) => {
        if (requestSeq.current !== seq) return
        setData(status)
        setLoading(false)
      },
      (error) => {
        if (requestSeq.current !== seq) return
        setLoading(false)
        setLoadError(error instanceof Error ? error.message : String(error))
      },
    )
  }, [cwd, loadStatus])

  // Load on mount and whenever the session workspace changes; a workspace
  // switch also closes the menu and clears the search.
  useEffect(() => {
    setOpen(false)
    setQuery('')
    setBusy(false)
    if (cwd === undefined) {
      setData(null)
      setLoading(false)
      setLoadError(null)
      return
    }
    load(true)
  }, [cwd, load])

  // Autofocus the search box when the menu opens.
  useEffect(() => {
    if (open) queueMicrotask(() => { searchRef.current?.focus() })
  }, [open])

  // Outside-click closes the menu.
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  const branches = data === null ? [] : data.branches
  const filtered = useMemo(
    () => branches.filter(branch => fuzzyMatch(query, branch)),
    [branches, query],
  )

  // Not a git work tree (or no git, or no workspace): render nothing.
  if (cwd === undefined || data === null || !data.gitAvailable || !data.repo) return null

  const current = data.branch
  const detached = current === null
  const triggerLabel = detached ? t('trigger.fallback') : current

  const show = (): void => {
    setOpen(true)
    load(true)
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      close(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  const choose = (branch: string): void => {
    if (cwd === undefined || busy) return
    if (branch === current) {
      close(true)
      return
    }
    setBusy(true)
    switchBranch(cwd, branch).then(
      () => {
        setBusy(false)
        close(true)
        load(true)
      },
      (error) => {
        setBusy(false)
        const message = error instanceof Error ? error.message : String(error)
        toastSeq.current += 1
        setToast({ seq: toastSeq.current, text: t('switch.failed', { branch, message }) })
      },
    )
  }

  const triggerAria = t('trigger.aria', { branch: triggerLabel })
  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={detached ? `${triggerLabel} · ${t('detached')}` : triggerLabel}
        onClick={() => {
          if (open) close()
          else show()
        }}
      >
        <IconBranchOutline16 className={css.triggerIcon} />
        <span className={css.triggerBranch}>{triggerLabel}</span>
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>

      {open && (
        <div
          id={`${id}-menu`}
          className={css.menu}
          role="menu"
          aria-label={t('menu.aria')}
          aria-busy={loading || busy}
        >
          <div className={css.search}>
            <IconSearchOutline16 className={css.searchIcon} />
            <input
              ref={searchRef}
              className={css.searchInput}
              type="text"
              value={query}
              placeholder={t('search.placeholder')}
              aria-label={t('search.placeholder')}
              spellCheck={false}
              onChange={event => { setQuery(event.target.value) }}
            />
            {query !== '' && (
              <button
                type="button"
                className={css.searchClear}
                aria-label={t('search.clear')}
                onClick={() => { setQuery(''); searchRef.current?.focus() }}
              >
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
                  <path d="M4.5 4.5L11.5 11.5M11.5 4.5L4.5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>

          {loading && data === null && (
            <div className={css.status}>{t('status.loading')}</div>
          )}
          {loadError !== null && data === null && (
            <div className={css.error}>
              <span>{t('status.error')}</span>
              <button type="button" className={css.retry} onClick={() => { load(false) }}>{t('retry')}</button>
            </div>
          )}
          <div className={clsx(css.list, 'scrollable')}>
            {filtered.map(branch => {
              const selected = branch === current
              return (
                <button
                  ref={itemRef()}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={clsx(css.option, selected && css.current)}
                  key={branch}
                  title={branch}
                  disabled={busy}
                  onClick={() => { choose(branch) }}
                >
                  <span className={css.optionCopy}>
                    <span className={css.branchName}>{branch}</span>
                  </span>
                  <span className={css.check}>
                    {selected ? <IconCheckOutline16 /> : null}
                  </span>
                </button>
              )
            })}
            {!loading && filtered.length === 0 && (
              <div className={css.empty}>
                {query.trim() === '' ? t('status.empty') : t('status.noMatches')}
              </div>
            )}
          </div>
        </div>
      )}

      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
