# dsh-client-ui-git-branch

A dsh (DeepSeek Harness) out-of-tree plugin: a **Git 分支选择器**（git branch selector）in the
chat composer, immediately **left of the model seat** (`conversation.input.right`).

When the session's workspace is inside a git work tree (and `git` is on PATH), the composer tool
row shows a branch chip next to the model select. Opening it reveals a fuzzy-search box above the
branch list; at most 5 branches are visible at once and the rest are reached through the internal
scrollbar. The current branch is highlighted in the brand-blue tone with a check mark. Picking
another branch switches the work tree (`git switch`); if the switch is blocked — typically
uncommitted changes that would be overwritten — a toast pops up with git's own error message.

## Features

- Composer seat **left of the model selection**, same chip/menu chrome as the model seat.
- Shows only when `git` is installed **and** the session workspace is a git repository.
- Fuzzy branch search (substring or in-order subsequence), with a clear button.
- List shows **at most 5 rows**; more branches scroll inside the list (no page-level scrolling).
- **Current branch marked in a distinct color** (brand blue + check icon).
- **Upstream tracking facts (VSCode-style)**: each branch shows its remote short name
  (`origin/main`) with colored ahead/behind commit counts (`↑2` amber / `↓3` green) and a red
  `gone` marker when the upstream ref was deleted; local-only branches show nothing. The trigger
  chip carries the same badge when the current branch is out of sync.
- Branch switching with conflict detection: failures pop a transient toast carrying git's stderr.
- **New branch action** at the bottom of the menu: a dialog asks for the branch name, then creates
  the branch from HEAD and checks it out (`git switch -c`); invalid names are flagged live, and
  collisions surface git's message inside the dialog.
- Full **zh / en i18n** and automatic **multi-theme** support through `--dsw-*` design tokens.
- Detached-HEAD safe (trigger falls back to `HEAD`); unborn-HEAD repos still list the current branch.

## Architecture

Dual-half package, no harness source changes:

- **Node half** (`src/index.ts`, `src/git.ts`) — registers three HTTP routes on `ctx.webServer`:
  - `GET /plugin/ui-git-branch/status?cwd=<workspace>` → git availability, repo membership,
    current branch, and the local branch list with upstream-tracking facts (one
    `git for-each-ref` call: `%(upstream:short)` + `%(upstream:track)` → ahead/behind/gone).
  - `POST /plugin/ui-git-branch/switch` `{ cwd, branch }` → `git switch -- <branch>`;
    non-zero exits return `409 { error: { code, message } }` with git's stderr.
  - `POST /plugin/ui-git-branch/create` `{ cwd, branch }` → `git switch -c <branch>`
    (create from HEAD and check out); an existing branch maps to `branch-exists`.
  - Git runs via `node:child_process` `execFile` (argv-only, no shell).
- **Browser half** (`src/client/`) — registers a `conversation.input.right` entry
  (`order: 100`, namespace `gitBranch`); reads the session workspace from the standard
  `useSessions` kit and talks to the routes over same-origin fetch.

## Install

```sh
# 1) Build and pack (requires pnpm)
pnpm install
pnpm run typecheck && pnpm test && pnpm run build
npm pack                                   # → dsh-client-ui-git-branch-0.1.0.tgz

# 2) Install into a profile (e.g. your web profile)
dsh plugin --profile web add ./dsh-client-ui-git-branch-0.1.0.tgz

# 3) Mount the plugin in the profile's own patch layer
#    $DSH_HOME/profiles/<name>/cordis.patch.yml:
#    - insert:
#        - id: ui-git-branch
#          name: dsh-client-ui-git-branch
```

Plugin-set changes (new rows) need a profile restart for the client to discover the package —
although a running instance may hot-mount through patch-file HMR (the host routes and boot graph
pick up the new row without restart; the browser picks it up on the next page load / refresh).

## Development

```sh
pnpm run typecheck   # strict tsc over src + tests
pnpm test            # vitest: host logic (fake runner) + real-git integration + jsdom component tests
pnpm run build       # esbuild dual output → lib/index.js (node ESM) + lib/client.js (browser CJS closure)
```

Test profile used during development: `git-branch-dev` (independent of the user's `web` profile),
booted with `dsh --profile git-branch-dev --port 3800`.

## License

MIT
