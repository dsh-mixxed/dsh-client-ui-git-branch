/**
 * Host-half tests for dsh-client-ui-git-branch: status mapping and switch
 * classification over a scripted GitRunner, request validation, plus an
 * end-to-end suite against a real temporary git repository (skipped when git
 * is not on PATH).
 */

import { accessSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ExecGitRunner, GitUnavailableError, type GitCommandResult, type GitRunner,
} from '../src/git.ts'
import {
  parseBranchRows, parseSwitchRequest, statusOf, switchTo, createBranch, trackRemote,
  remoteOnlyBranches, SwitchFailure, isSameOrigin,
} from '../src/index.ts'

/**
 * Locate a `git` executable on PATH without spawning anything: walk PATH in
 * order and try each PATHEXT extension, mirroring how the OS resolves a bare
 * command name. Keeps the test file free of node:child_process (the shipped
 * plugin's only process boundary is the host half's execFile runner).
 */
function findGit(): string | undefined {
  const extensions = (process.env.PATHEXT ?? (process.platform === 'win32' ? '.COM;.EXE;.BAT;.CMD' : ''))
    .split(';')
    .map(ext => ext.toLowerCase())
    .filter(ext => ext !== '')
  const pathDirs = (process.env.PATH ?? '')
    .split(delimiter)
    .map(dir => dir.trim().replace(/^"(.*)"$/, '$1'))
    .filter(dir => dir !== '')
  for (const dir of pathDirs) {
    for (const extension of extensions.length > 0 ? extensions : ['']) {
      try {
        const candidate = join(dir, `git${extension}`)
        accessSync(candidate)
        return candidate
      } catch {
        // Not here; keep walking.
      }
    }
  }
  return undefined
}

const hasGit = findGit() !== undefined

/** Scripted runner: maps an argv array to a result or a thrown error. */
class FakeRunner implements GitRunner {
  constructor(
    private readonly script: (args: readonly string[]) => GitCommandResult | Error,
  ) {}

  run(args: readonly string[], _cwd: string): Promise<GitCommandResult> {
    const value = this.script(args)
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
  }
}

const ok = (stdout: string, stderr = ''): GitCommandResult => ({ code: 0, stdout, stderr })
const fail = (code: number, stderr: string): GitCommandResult => ({ code, stdout: '', stderr })

/** A runner scripted for a repo with the given local / remote ref outputs. */
function repoRunner(localRefs: string, remoteRefs = '', current = 'main\n'): GitRunner {
  return new FakeRunner((args) => {
    if (args[0] === '--version') return ok('git version 2.45.0')
    if (args[0] === 'rev-parse') return ok('true\n')
    if (args[0] === 'branch' && args[1] === '--show-current') return ok(current)
    if (args[0] === 'for-each-ref' && args[1] === 'refs/heads') return ok(localRefs)
    if (args[0] === 'for-each-ref' && args[1] === 'refs/remotes') return ok(remoteRefs)
    return fail(1, 'unexpected')
  })
}

describe('statusOf', () => {
  it('reports git unavailable when the runner raises GitUnavailableError', async () => {
    const runner = new FakeRunner(() => new GitUnavailableError('git executable not found'))
    const status = await statusOf(runner, 'D:\\repo')
    expect(status).toEqual({ gitAvailable: false, repo: false, branch: null, branches: [], remoteOnly: [] })
  })

  it('reports git unavailable when git --version exits non-zero', async () => {
    const runner = new FakeRunner(() => fail(1, 'fatal: not a git repository'))
    const status = await statusOf(runner, 'D:\\repo')
    expect(status.gitAvailable).toBe(false)
    expect(status.repo).toBe(false)
  })

  it('reports not-a-repo when rev-parse says no', async () => {
    const runner = new FakeRunner((args) => {
      if (args[0] === '--version') return ok('git version 2.45.0')
      return fail(128, 'fatal: not a git repository')
    })
    const status = await statusOf(runner, 'D:\\plain')
    expect(status).toEqual({ gitAvailable: true, repo: false, branch: null, branches: [], remoteOnly: [] })
  })

  it('collects the current branch and the local branch list', async () => {
    const runner = repoRunner(
      'feature/one\torigin/feature/one\t[ahead 2]\nmain\torigin/main\t\nlocal-only\t\t\n',
      'origin/feature/one\norigin/main\n',
    )
    const status = await statusOf(runner, 'D:\\repo')
    expect(status).toEqual({
      gitAvailable: true,
      repo: true,
      branch: 'main',
      branches: [
        { name: 'feature/one', upstream: 'origin/feature/one', ahead: 2 },
        { name: 'main', upstream: 'origin/main' },
        { name: 'local-only' },
      ],
      remoteOnly: [],
    })
  })

  it('lists remote branches that have no local counterpart, excluding origin/HEAD', async () => {
    const runner = repoRunner(
      'main\torigin/main\t\n',
      'origin/HEAD\norigin/feature/new\norigin/main\n',
    )
    const status = await statusOf(runner, 'D:\\repo')
    expect(status.remoteOnly).toEqual(['origin/feature/new'])
  })

  it('parses upstream tracking facts: ahead, behind, both, gone, in-sync', () => {
    const stdout = [
      'main\torigin/main\t',
      'ahead-only\torigin/ahead-only\t[ahead 3]',
      'behind-only\torigin/behind-only\t[behind 1]',
      'both\torigin/both\t[ahead 2, behind 4]',
      'gone\torigin/gone\t[gone]',
      'local-only\t\t',
      '',
    ].join('\n')
    expect(parseBranchRows(stdout)).toEqual([
      { name: 'main', upstream: 'origin/main' },
      { name: 'ahead-only', upstream: 'origin/ahead-only', ahead: 3 },
      { name: 'behind-only', upstream: 'origin/behind-only', behind: 1 },
      { name: 'both', upstream: 'origin/both', ahead: 2, behind: 4 },
      { name: 'gone', upstream: 'origin/gone', gone: true },
      { name: 'local-only' },
    ])
  })

  it('computes remote-only branches by stripping the remote prefix', () => {
    expect(remoteOnlyBranches(
      'origin/HEAD\norigin/feature/x\norigin/main\nupstream/dev\n',
      new Set(['main', 'dev']),
    )).toEqual(['origin/feature/x'])
  })

  it('ignores bare remote refs without a branch component', () => {
    expect(remoteOnlyBranches('origin\norigin/master\n', new Set(['master']))).toEqual([])
  })

  it('reports a detached HEAD as branch null', async () => {
    const runner = repoRunner('', '', '\n')
    const status = await statusOf(runner, 'D:\\repo')
    expect(status.gitAvailable).toBe(true)
    expect(status.repo).toBe(true)
    expect(status.branch).toBeNull()
    expect(status.branches).toEqual([])
  })

  it('contains a failing branch probe instead of failing the whole status', async () => {
    const runner = new FakeRunner((args) => {
      if (args[0] === '--version') return ok('git version 2.45.0')
      if (args[0] === 'rev-parse') return ok('true\n')
      if (args[0] === 'branch' && args[1] === '--show-current') return fail(1, 'boom')
      return ok('')
    })
    const status = await statusOf(runner, 'D:\\repo')
    expect(status.repo).toBe(true)
    expect(status.branch).toBeNull()
  })

  it('surfaces the current branch when the repo has no commits yet (unborn HEAD)', async () => {
    const runner = new FakeRunner((args) => {
      if (args[0] === '--version') return ok('git version 2.45.0')
      if (args[0] === 'rev-parse') return ok('true\n')
      if (args[0] === 'branch' && args[1] === '--show-current') return ok('main\n')
      return ok('')
    })
    const status = await statusOf(runner, 'D:\\fresh')
    expect(status.branch).toBe('main')
    expect(status.branches).toEqual([{ name: 'main' }])
  })
})

describe('switchTo', () => {
  it('resolves with the target branch on success', async () => {
    const runner = new FakeRunner(() => ok(''))
    await expect(switchTo(runner, { cwd: 'D:\\repo', branch: 'feature/one' }))
      .resolves.toEqual({ ok: true, branch: 'feature/one' })
  })

  it('classifies a local-changes conflict as switch-conflict with git stderr', async () => {
    const stderr = [
      "error: Your local changes to the following files would be overwritten by checkout:",
      '        index.ts',
      'Please commit your changes or stash them before you switch branches.',
      'Aborting',
    ].join('\n')
    const runner = new FakeRunner(() => fail(1, stderr))
    await expect(switchTo(runner, { cwd: 'D:\\repo', branch: 'main' }))
      .rejects.toMatchObject({ name: 'SwitchFailure', code: 'switch-conflict', status: 409 })
  })

  it('classifies other failures as switch-failed', async () => {
    const runner = new FakeRunner(() => fail(2, 'fatal: some other problem'))
    await expect(switchTo(runner, { cwd: 'D:\\repo', branch: 'main' }))
      .rejects.toMatchObject({ name: 'SwitchFailure', code: 'switch-failed', status: 409 })
  })

  it('surfaces git-unavailable as a 500 failure', async () => {
    const runner = new FakeRunner(() => new GitUnavailableError('git executable not found'))
    await expect(switchTo(runner, { cwd: 'D:\\repo', branch: 'main' }))
      .rejects.toMatchObject({ name: 'SwitchFailure', code: 'git-unavailable', status: 500 })
  })
})

describe('createBranch', () => {
  it('resolves with the new branch and passes the bare -c argument form', async () => {
    const seen: string[][] = []
    const runner = new FakeRunner((args: readonly string[]) => {
      seen.push([...args])
      return ok('')
    })
    await expect(createBranch(runner, { cwd: 'D:\\repo', branch: 'feature/new' }))
      .resolves.toEqual({ ok: true, branch: 'feature/new' })
    expect(seen).toEqual([['switch', '-c', 'feature/new']])
  })

  it('classifies an existing-branch collision as branch-exists', async () => {
    const runner = new FakeRunner(() => fail(128, "fatal: a branch named 'main' already exists"))
    await expect(createBranch(runner, { cwd: 'D:\\repo', branch: 'main' }))
      .rejects.toMatchObject({ name: 'SwitchFailure', code: 'branch-exists', status: 409 })
  })

  it('classifies other failures as create-failed', async () => {
    const runner = new FakeRunner(() => fail(128, "fatal: 'bad name' is not a valid branch name"))
    await expect(createBranch(runner, { cwd: 'D:\\repo', branch: 'bad name' }))
      .rejects.toMatchObject({ name: 'SwitchFailure', code: 'create-failed', status: 409 })
  })

  it('surfaces git-unavailable as a 500 failure', async () => {
    const runner = new FakeRunner(() => new GitUnavailableError('git executable not found'))
    await expect(createBranch(runner, { cwd: 'D:\\repo', branch: 'feature/new' }))
      .rejects.toMatchObject({ name: 'SwitchFailure', code: 'git-unavailable', status: 500 })
  })
})

describe('trackRemote', () => {
  it('checks out a remote branch as a local tracking branch', async () => {
    const seen: string[][] = []
    const runner = new FakeRunner((args: readonly string[]) => {
      seen.push([...args])
      return ok('')
    })
    await expect(trackRemote(runner, { cwd: 'D:\\repo', branch: 'origin/feature/new' }))
      .resolves.toEqual({ ok: true, branch: 'feature/new' })
    expect(seen).toEqual([['switch', '--track', 'origin/feature/new']])
  })

  it('classifies failures as track-failed', async () => {
    const runner = new FakeRunner(() => fail(128, "fatal: a branch named 'feature' already exists"))
    await expect(trackRemote(runner, { cwd: 'D:\\repo', branch: 'origin/feature' }))
      .rejects.toMatchObject({ name: 'SwitchFailure', code: 'track-failed', status: 409 })
  })

  it('surfaces git-unavailable as a 500 failure', async () => {
    const runner = new FakeRunner(() => new GitUnavailableError('git executable not found'))
    await expect(trackRemote(runner, { cwd: 'D:\\repo', branch: 'origin/feature' }))
      .rejects.toMatchObject({ name: 'SwitchFailure', code: 'git-unavailable', status: 500 })
  })
})

describe('parseSwitchRequest', () => {
  it('accepts a well-formed write', () => {
    expect(parseSwitchRequest({ cwd: 'D:\\repo', branch: 'feature/one' }))
      .toEqual({ cwd: 'D:\\repo', branch: 'feature/one' })
  })

  it('trims the branch name', () => {
    expect(parseSwitchRequest({ cwd: 'D:\\repo', branch: '  main  ' }).branch).toBe('main')
  })

  it('rejects missing cwd', () => {
    expect(() => parseSwitchRequest({ branch: 'main' })).toThrow(/cwd/)
  })

  it('rejects missing or newline-bearing branch names', () => {
    expect(() => parseSwitchRequest({ cwd: 'D:\\repo', branch: '' })).toThrow(/branch/)
    expect(() => parseSwitchRequest({ cwd: 'D:\\repo', branch: 'a\nb' })).toThrow(/newlines/)
  })

  it('rejects names git would refuse or could parse as options', () => {
    const invalid = [
      '-x', '--orphan=evil', '-leading',          // option-shaped (check-ref-format --branch)
      'HEAD',                                      // reserved, case-sensitive
      'a..b', 'a@{b', 'foo.lock', 'a/b.lock', 'foo.lock/bar', 'x.lock/',  // shape rules
      'a b', 'a\tb', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b',     // forbidden chars
      '.hidden', 'a/.hidden', 'foo.', 'foo/', '/foo', 'a//b',              // component rules
    ]
    for (const branch of invalid) {
      expect(() => parseSwitchRequest({ cwd: 'D:\\repo', branch }), branch).toThrow(/valid git ref name/)
    }
  })

  it('accepts names git accepts, including unicode and dotted versions', () => {
    const valid = ['main', 'feature/one', 'v1.0.1', '中文分支', '@foo', 'head', 'HeAd', 'foo.lockx']
    for (const branch of valid) {
      expect(parseSwitchRequest({ cwd: 'D:\\repo', branch }).branch).toBe(branch)
    }
  })
})

describe('isSameOrigin', () => {
  const request = (headers: Record<string, string | undefined>): IncomingMessage =>
    ({ headers }) as unknown as IncomingMessage

  it('allows non-browser clients without an Origin header', () => {
    expect(isSameOrigin(request({ host: 'localhost:3080' }))).toBe(true)
    expect(isSameOrigin(request({}))).toBe(true)
  })

  it('allows a same-origin browser request', () => {
    expect(isSameOrigin(request({ origin: 'http://localhost:3080', host: 'localhost:3080' }))).toBe(true)
    expect(isSameOrigin(request({ origin: 'https://dsh.example.com', host: 'dsh.example.com' }))).toBe(true)
  })

  it('rejects cross-origin requests (CSRF)', () => {
    expect(isSameOrigin(request({ origin: 'https://evil.example', host: 'localhost:3080' }))).toBe(false)
    expect(isSameOrigin(request({ origin: 'http://localhost:5173', host: 'localhost:3080' }))).toBe(false)
    expect(isSameOrigin(request({ origin: 'null', host: 'localhost:3080' }))).toBe(false)
  })

  it('rejects an Origin with no Host header', () => {
    expect(isSameOrigin(request({ origin: 'http://localhost:3080' }))).toBe(false)
  })
})

describe.skipIf(!hasGit)('real git integration', () => {
  it('walks status and switch through a temporary repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-git-branch-'))
    const runner = new ExecGitRunner()
    try {
      const run = (args: readonly string[]) => runner.run(args, dir)
      expect((await run(['init', '-b', 'main'])).code).toBe(0)
      await run(['config', 'user.name', 't'])
      await run(['config', 'user.email', 't@example.com'])
      writeFileSync(join(dir, 'file.txt'), 'hello\n')
      expect((await run(['add', 'file.txt'])).code).toBe(0)
      expect((await run(['commit', '-m', 'init'])).code).toBe(0)
      expect((await run(['switch', '-c', 'feature/one'])).code).toBe(0)
      writeFileSync(join(dir, 'file.txt'), 'changed on feature\n')
      expect((await run(['commit', '-am', 'feature work'])).code).toBe(0)

      const status = await statusOf(runner, dir)
      expect(status.gitAvailable).toBe(true)
      expect(status.repo).toBe(true)
      expect(status.branch).toBe('feature/one')
      expect(status.branches.some(row => row.name === 'main')).toBe(true)
      expect(status.branches.some(row => row.name === 'feature/one')).toBe(true)

      await expect(switchTo(runner, { cwd: dir, branch: 'main' }))
        .resolves.toEqual({ ok: true, branch: 'main' })
      expect((await statusOf(runner, dir)).branch).toBe('main')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a conflict when uncommitted changes block the switch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-git-branch-'))
    const runner = new ExecGitRunner()
    try {
      const run = (args: readonly string[]) => runner.run(args, dir)
      expect((await run(['init', '-b', 'main'])).code).toBe(0)
      await run(['config', 'user.name', 't'])
      await run(['config', 'user.email', 't@example.com'])
      writeFileSync(join(dir, 'file.txt'), 'hello\n')
      expect((await run(['add', 'file.txt'])).code).toBe(0)
      expect((await run(['commit', '-m', 'init'])).code).toBe(0)
      expect((await run(['switch', '-c', 'feature/one'])).code).toBe(0)
      writeFileSync(join(dir, 'file.txt'), 'changed on feature\n')
      expect((await run(['commit', '-am', 'feature work'])).code).toBe(0)
      // Both branches now differ; a fresh working-tree edit on top blocks the
      // switch back to main.
      writeFileSync(join(dir, 'file.txt'), 'uncommitted change\n')

      const failure = await switchTo(runner, { cwd: dir, branch: 'main' }).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(SwitchFailure)
      expect((failure as SwitchFailure).code).toBe('switch-conflict')
      expect((failure as SwitchFailure).message).toMatch(/would be overwritten|local changes/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates a branch and checks it out, and refuses a duplicate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-git-branch-'))
    const runner = new ExecGitRunner()
    try {
      const run = (args: readonly string[]) => runner.run(args, dir)
      expect((await run(['init', '-b', 'main'])).code).toBe(0)
      await run(['config', 'user.name', 't'])
      await run(['config', 'user.email', 't@example.com'])
      writeFileSync(join(dir, 'file.txt'), 'hello\n')
      expect((await run(['add', 'file.txt'])).code).toBe(0)
      expect((await run(['commit', '-m', 'init'])).code).toBe(0)

      await expect(createBranch(runner, { cwd: dir, branch: 'feature/new' }))
        .resolves.toEqual({ ok: true, branch: 'feature/new' })
      const status = await statusOf(runner, dir)
      expect(status.branch).toBe('feature/new')
      expect(status.branches.some(row => row.name === 'feature/new')).toBe(true)

      // Working-tree edits carry over to the new branch (same HEAD).
      writeFileSync(join(dir, 'file.txt'), 'dirty\n')

      const duplicate = await createBranch(runner, { cwd: dir, branch: 'feature/new' })
        .catch((error: unknown) => error)
      expect(duplicate).toBeInstanceOf(SwitchFailure)
      expect((duplicate as SwitchFailure).code).toBe('branch-exists')
      await expect(statusOf(runner, dir)).resolves.toMatchObject({ branch: 'feature/new' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports upstream tracking facts against a real remote', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-git-branch-'))
    const remote = join(tmpdir(), `dsh-git-remote-${Date.now()}.git`)
    const runner = new ExecGitRunner()
    const git = (cwd: string) => (args: readonly string[]) => runner.run(args, cwd)
    try {
      const run = git(dir)
      // The bare remote must exist before execFile can run git inside it.
      mkdirSync(remote, { recursive: true })
      expect((await runner.run(['init', '--bare', '-b', 'main'], remote)).code).toBe(0)
      await runner.run(['config', 'user.name', 't'], remote)
      await runner.run(['config', 'user.email', 't@example.com'], remote)
      expect((await run(['init', '-b', 'main'])).code).toBe(0)
      await run(['config', 'user.name', 't'])
      await run(['config', 'user.email', 't@example.com'])
      writeFileSync(join(dir, 'file.txt'), 'hello\n')
      expect((await run(['add', 'file.txt'])).code).toBe(0)
      expect((await run(['commit', '-m', 'init'])).code).toBe(0)
      await run(['remote', 'add', 'origin', remote])
      expect((await run(['push', '-u', 'origin', 'main'])).code).toBe(0)

      // In sync: upstream present, no counts.
      let status = await statusOf(runner, dir)
      expect(status.branches).toEqual([{ name: 'main', upstream: 'origin/main' }])

      // Ahead: one unpushed local commit.
      expect((await run(['commit', '-am', 'local work', '--allow-empty'])).code).toBe(0)
      status = await statusOf(runner, dir)
      expect(status.branches[0]).toMatchObject({ name: 'main', upstream: 'origin/main', ahead: 1 })
      expect(status.branches[0].behind).toBeUndefined()

      // Ahead + behind: advance the REMOTE main, then fetch. The parent must
      // be the remote's own head (the local head now has unpushed commits).
      const remoteHead = await runner.run(['rev-parse', 'main'], remote)
      const tree = await run(['write-tree'])
      const commit = await runner.run(
        ['commit-tree', tree.stdout.trim(), '-p', remoteHead.stdout.trim(), '-m', 'remote work'],
        remote,
      )
      expect(commit.code).toBe(0)
      expect((await runner.run(['update-ref', 'refs/heads/main', commit.stdout.trim()], remote)).code).toBe(0)
      expect((await run(['fetch', 'origin'])).code).toBe(0)
      status = await statusOf(runner, dir)
      expect(status.branches[0]).toMatchObject({ name: 'main', upstream: 'origin/main', ahead: 1, behind: 1 })

      // Gone: delete the remote branch and prune.
      expect((await runner.run(['update-ref', '-d', 'refs/heads/main'], remote)).code).toBe(0)
      expect((await run(['fetch', 'origin', '--prune'])).code).toBe(0)
      status = await statusOf(runner, dir)
      expect(status.branches[0]).toMatchObject({ name: 'main', upstream: 'origin/main', gone: true })
      expect(status.branches[0].ahead).toBeUndefined()

      // Local-only branch carries no upstream.
      expect((await run(['switch', '-c', 'local-only'])).code).toBe(0)
      status = await statusOf(runner, dir)
      const local = status.branches.find(row => row.name === 'local-only')
      expect(local).toEqual({ name: 'local-only' })

      // Remote-only branch: create `feature` on the remote, fetch, track it.
      const featureTree = await run(['write-tree'])
      const featureCommit = await runner.run(
        ['commit-tree', featureTree.stdout.trim(), '-p', commit.stdout.trim(), '-m', 'feature work'],
        remote,
      )
      expect(featureCommit.code).toBe(0)
      expect((await runner.run(['update-ref', 'refs/heads/feature', featureCommit.stdout.trim()], remote)).code).toBe(0)
      expect((await run(['fetch', 'origin'])).code).toBe(0)
      status = await statusOf(runner, dir)
      expect(status.remoteOnly).toContain('origin/feature')
      expect(status.remoteOnly).not.toContain('origin/HEAD')

      await expect(trackRemote(runner, { cwd: dir, branch: 'origin/feature' }))
        .resolves.toEqual({ ok: true, branch: 'feature' })
      status = await statusOf(runner, dir)
      expect(status.branch).toBe('feature')
      expect(status.branches.some(row =>
        row.name === 'feature' && row.upstream === 'origin/feature')).toBe(true)
      expect(status.remoteOnly).not.toContain('origin/feature')

      // Tracking a branch that now exists locally fails.
      const duplicate = await trackRemote(runner, { cwd: dir, branch: 'origin/feature' })
        .catch((error: unknown) => error)
      expect(duplicate).toBeInstanceOf(SwitchFailure)
      expect((duplicate as SwitchFailure).code).toBe('track-failed')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(remote, { recursive: true, force: true })
    }
  }, 30000)
})
