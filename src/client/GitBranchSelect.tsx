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
 * A "New branch" action at the bottom of the menu opens a modal that creates
 * a branch from HEAD and checks it out (git switch -c); failures surface
 * inside the dialog.
 */
import {
  useCallback, useEffect, useId, useMemo, useRef, useState,
  type FocusEvent, type KeyboardEvent,
} from 'react'
import clsx from 'clsx'
import {
  Button, IconBranchOutline16, IconCheckOutline16, IconChevronDownOutline14,
  IconPlusOutline16, IconSearchOutline16, IconWarningOutline16, Input, Modal, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BranchRow, StatusResponse } from '../wire.ts'
import css from './GitBranchSelect.module.css'

/** Injected business face: same-origin calls to the host half's routes. */
export interface GitBranchInjected {
  /** Load the git status of one workspace directory. */
  loadStatus: (cwd: string) => Promise<StatusResponse>
  /** Switch the work tree to another local branch; rejects with the git error. */
  switchBranch: (cwd: string, branch: string) => Promise<void>
  /** Create a branch from HEAD and check it out; rejects with the git error. */
  createBranch: (cwd: string, branch: string) => Promise<void>
  /** Check out a remote branch as a new local tracking branch; rejects with the git error. */
  trackRemote: (cwd: string, branch: string) => Promise<void>
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

/**
 * Practical subset of `git check-ref-format`: a branch name must be non-empty,
 * short enough, and free of the characters and component shapes git refuses.
 * @param name - the raw input value.
 * @returns whether the name may be submitted.
 */
export function isValidBranchName(name: string): boolean {
  const value = name.trim()
  if (value === '' || value.length > 255) return false
  if (/[ ~^:?*[\\]/.test(value)) return false
  if (value.includes('..') || value.includes('@{') || value.includes('//')) return false
  if (value.startsWith('-') || value.startsWith('.') || value.endsWith('.') || value.endsWith('/')) {
    return false
  }
  if (value.includes('/.')) return false
  return true
}

/**
 * One branch row's full accessible title: name, upstream, and tracking facts.
 * @param row - the branch row.
 * @param t - the namespace translate seat.
 * @returns the joined title string.
 */
function branchTitle(row: BranchRow, t: GitBranchSelectProps['t']): string {
  const parts: string[] = [row.name]
  if (row.upstream !== undefined) {
    parts.push(t('branch.tracks', { upstream: row.upstream }))
    if (row.gone === true) {
      parts.push(t('branch.gone'))
    } else {
      if ((row.ahead ?? 0) > 0) parts.push(t('branch.ahead', { count: row.ahead ?? 0 }))
      if ((row.behind ?? 0) > 0) parts.push(t('branch.behind', { count: row.behind ?? 0 }))
    }
  }
  return parts.join(' · ')
}

/** Render the composer git branch seat. */
export function GitBranchSelect(
  { sessionId, useSessions, loadStatus, switchBranch, createBranch, trackRemote, t }: GitBranchSelectProps,
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
  // Create-dialog state.
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
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
  // switch also closes the menu and clears transient state.
  useEffect(() => {
    setOpen(false)
    setQuery('')
    setBusy(false)
    setCreateOpen(false)
    setCreateName('')
    setCreateError(null)
    setCreateBusy(false)
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
  const remoteOnly = data === null ? [] : data.remoteOnly
  // Search runs across BOTH groups; empty groups collapse away.
  const localFiltered = useMemo(
    () => branches.filter(row => fuzzyMatch(query, row.name)),
    [branches, query],
  )
  const remoteFiltered = useMemo(
    () => remoteOnly.filter(name => fuzzyMatch(query, name)),
    [remoteOnly, query],
  )

  // Not a git work tree (or no git, or no workspace): render nothing.
  if (cwd === undefined || data === null || !data.gitAvailable || !data.repo) return null

  const current = data.branch
  const detached = current === null
  const triggerLabel = detached ? t('trigger.fallback') : current
  const currentRow = current === null ? undefined : branches.find(row => row.name === current)
  // VSCode-status-bar style tracking badge on the trigger: only when the
  // current branch has unpushed / unpulled commits (in sync shows nothing).
  const triggerTrack = currentRow !== undefined && (currentRow.ahead !== undefined || currentRow.behind !== undefined)
    ? { ahead: currentRow.ahead ?? 0, behind: currentRow.behind ?? 0 }
    : null

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

  const openCreate = (): void => {
    setCreateName('')
    setCreateError(null)
    setCreateOpen(true)
  }

  /** Check out a remote-only branch as a new local tracking branch. */
  const track = (branch: string): void => {
    if (cwd === undefined || busy) return
    setBusy(true)
    trackRemote(cwd, branch).then(
      () => {
        setBusy(false)
        // The new local branch is now current; refresh the list in place.
        load(true)
      },
      (error) => {
        setBusy(false)
        const message = error instanceof Error ? error.message : String(error)
        toastSeq.current += 1
        setToast({ seq: toastSeq.current, text: t('track.failed', { branch, message }) })
      },
    )
  }

  const submitCreate = (): void => {
    if (cwd === undefined || createBusy) return
    const name = createName.trim()
    if (!isValidBranchName(name)) {
      setCreateError(t('create.error.invalid'))
      return
    }
    setCreateBusy(true)
    setCreateError(null)
    createBranch(cwd, name).then(
      () => {
        setCreateBusy(false)
        setCreateOpen(false)
        setCreateName('')
        // The new branch is now current; refresh the list in place.
        load(true)
      },
      (error) => {
        setCreateBusy(false)
        const message = error instanceof Error ? error.message : String(error)
        setCreateError(t('create.failed', { branch: name, message }))
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
        title={detached ? `${triggerLabel} · ${t('detached')}` : currentRow !== undefined ? branchTitle(currentRow, t) : triggerLabel}
        onClick={() => {
          if (open) close()
          else show()
        }}
      >
        <IconBranchOutline16 className={css.triggerIcon} />
        <span className={css.triggerBranch}>{triggerLabel}</span>
        {triggerTrack !== null && (
          <span className={css.triggerTrack}>
            {triggerTrack.ahead > 0 && <span className={css.triggerAhead}>↑{triggerTrack.ahead}</span>}
            {triggerTrack.behind > 0 && <span className={css.triggerBehind}>↓{triggerTrack.behind}</span>}
          </span>
        )}
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
            {localFiltered.length > 0 && (
              <div className={css.groupTitle}>{t('group.local')}</div>
            )}
            {localFiltered.map(row => {
              const selected = row.name === current
              return (
                <button
                  ref={itemRef()}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={clsx(css.option, selected && css.current)}
                  key={row.name}
                  title={branchTitle(row, t)}
                  disabled={busy}
                  onClick={() => { choose(row.name) }}
                >
                  <span className={css.optionCopy}>
                    <span className={css.branchName}>{row.name}</span>
                    {row.upstream !== undefined && (
                      <span className={css.detail}>
                        <span className={css.upstream}>{row.upstream}</span>
                        {row.gone === true
                          ? <span className={css.gone}>{t('branch.gone')}</span>
                          : (
                            <>
                              {(row.ahead ?? 0) > 0 && <span className={css.ahead}>↑{row.ahead}</span>}
                              {(row.behind ?? 0) > 0 && <span className={css.behind}>↓{row.behind}</span>}
                            </>
                          )}
                      </span>
                    )}
                  </span>
                  <span className={css.check}>
                    {selected ? <IconCheckOutline16 /> : null}
                  </span>
                </button>
              )
            })}
            {remoteFiltered.length > 0 && (
              <div className={css.groupTitle}>{t('group.remote')}</div>
            )}
            {remoteFiltered.map(name => (
              <button
                ref={itemRef()}
                type="button"
                role="menuitemradio"
                aria-checked={false}
                className={css.option}
                key={name}
                title={name}
                disabled={busy}
                onClick={() => { track(name) }}
              >
                <span className={css.optionCopy}>
                  <span className={css.branchName}>{name}</span>
                </span>
                <span className={css.check} />
              </button>
            ))}
            {!loading && localFiltered.length === 0 && remoteFiltered.length === 0 && (
              <div className={css.empty}>
                {query.trim() === '' ? t('status.empty') : t('status.noMatches')}
              </div>
            )}
          </div>

          <div className={css.createRow}>
            <button
              type="button"
              className={css.create}
              onClick={openCreate}
            >
              <IconPlusOutline16 size={14} />
              <span>{t('create.button')}</span>
            </button>
          </div>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => { if (!createBusy) setCreateOpen(false) }}
        title={t('create.title')}
        closeLabel={t('create.cancel')}
        description={current === null ? undefined : t('create.description', { branch: current })}
        footer={(
          <>
            <Button variant="ghost" size="sm" disabled={createBusy} onClick={() => { setCreateOpen(false) }}>
              {t('create.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={createBusy || !isValidBranchName(createName)}
              onClick={submitCreate}
            >
              {t('create.confirm')}
            </Button>
          </>
        )}
      >
        <Input
          autoFocus
          icon={<IconBranchOutline16 />}
          placeholder={t('create.placeholder')}
          aria-label={t('create.placeholder')}
          value={createName}
          spellCheck={false}
          onChange={event => {
            const value = event.target.value
            setCreateName(value)
            // Live validation: an invalid name explains itself while typing.
            if (value.trim() !== '' && !isValidBranchName(value)) {
              setCreateError(t('create.error.invalid'))
            } else {
              setCreateError(null)
            }
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' && !createBusy && isValidBranchName(createName)) {
              event.preventDefault()
              submitCreate()
            }
          }}
        />
        {createError !== null && (
          <div className={css.createError} role="alert">
            {createError}
          </div>
        )}
      </Modal>

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
