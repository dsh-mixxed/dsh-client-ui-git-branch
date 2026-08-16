# dsh-client-ui-git-branch

English | [中文](README.zh.md)

A dsh (DeepSeek Harness) out-of-tree plugin that adds a **git branch selector** to the chat
composer, immediately **left of the model seat** (`conversation.input.right`).

## Features

- Composer seat **left of the model selection**, same chip/menu chrome as the model seat
- Shows only when `git` is installed **and** the session workspace is a git repository
- Fuzzy branch search (substring or in-order subsequence), with a clear button
- List shows **at most 5 rows**; more branches scroll inside the list (no page-level scrolling)
- **Current branch marked in a distinct color** (brand blue + check icon)
- **Upstream tracking facts (VSCode-style)**: every branch shows its remote short name
  (`origin/main`) with colored ahead/behind commit counts (`↑2` amber / `↓3` green) and a red
  `gone` marker when the upstream ref was deleted; local-only branches show nothing. The trigger
  chip carries the same badge when the current branch is out of sync
- **Local / Remote groups** — see [Branch groups](#branch-groups)
- **New branch action**: a dialog asks for the branch name, then creates the branch from HEAD and
  checks it out (`git switch -c`); invalid names are flagged live, collisions surface git's message
- Branch switching with conflict detection: failures pop a transient toast carrying git's stderr
- Full **zh / en i18n** and automatic **multi-theme** support through `--dsw-*` design tokens
- Detached-HEAD safe (trigger falls back to `HEAD`); unborn-HEAD repos still list the current branch

## Branch groups

The list is split under two sticky headings:

- **Local branches** — every local branch. Tracked branches keep their upstream mapping
  (`master → origin/master`, with ahead/behind counts).
- **Remote branches** — only branches that exist remotely but have **no local counterpart**
  (`origin/HEAD` symrefs and bare remote refs are excluded).

Behavior:

- The fuzzy **search spans both groups** at once; a group with no matches collapses away.
- Clicking a **remote** branch creates a local tracking branch and switches to it
  (`git switch --track origin/feature` → local `feature` tracking `origin/feature`); the branch
  then moves into the local group.
- Clicking a **local** branch switches the work tree (`git switch`); a blocked switch —
  typically uncommitted changes that would be overwritten — pops a toast with git's own message.

## Install

1. Build and pack the plugin:

   ```sh
   pnpm install
   pnpm run typecheck
   pnpm test
   pnpm run build
   npm pack          # dsh-client-ui-git-branch-0.4.0.tgz
   ```

2. Install the package into your profile:

   ```sh
   dsh plugin --profile web add ./dsh-client-ui-git-branch-0.4.0.tgz
   ```

3. Mount it in `$DSH_HOME/profiles/<name>/cordis.patch.yml`:

   ```yaml
   - insert:
       - id: ui-git-branch              # plugin id (unchanged)
         name: dsh-client-ui-git-branch # npm package name
   ```

4. Restart the profile and refresh the browser page. In a session whose workspace is a git
   repository, the branch chip appears left of the model seat.

## Verify

```sh
dsh --profile <name> --dump-config | Select-String ui-git-branch
```

After the restart, the composer shows the branch chip; opening it reveals the grouped list, the
search box, and the New branch action.

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
