---
name: verify-and-commit
description: Run after every code change to flow-mindmap. Verifies type check + library build + browser smoke test, then auto-commits on success. Use when the user edits source files and wants a safe commit.
---

# verify-and-commit

Run this skill after any code change to flow-mindmap. It will:

1. **Type check** — `pnpm typecheck` (vue-tsc). Must be 0 errors.
2. **Library build** — `pnpm build --mode lib`. Must produce `dist/` cleanly.
3. **Browser smoke test** — start dev server on port 7851, drive it with Playwright headless Chromium, take screenshots into `verify-output/`, assert: nodes render, edges render, Tab adds a child, Enter adds sibling, delete removes a node, no console errors.
4. **Stage + commit** — only if all three pass. Use a Conventional Commits message derived from the diff summary. If git is not initialized, run `git init` first, set `user.name=xuze` and `user.email=569552263@qq.com`.

## When to invoke

The user says "提交" / "commit" / "verify and commit" / "改完了提交一下", OR after every meaningful code edit the user asks you to land. Do NOT run it preemptively for trivial changes (typo fixes, doc tweaks) — but DO run it whenever source under `src/` or config files like `vite.config.ts` / `tsconfig.json` change.

## What it needs on disk

- Node 20+ and pnpm 10+
- `playwright` (devDep) and a Chromium browser installed via `pnpm exec playwright install chromium`
- `scripts/verify.mjs` — Playwright smoke script (already exists in this repo)
- Git available, repo at the project root (auto-init if missing)

## Procedure (execute in order, stop on first failure)

```bash
cd <repo-root>

# 1. typecheck
pnpm typecheck

# 2. build
pnpm build --mode lib

# 3. browser smoke (starts dev server in background, runs Playwright, then kills server)
node scripts/verify.mjs

# 4. if all green, commit
git add -A
git commit -m "<derived from diff>"
```

The verify script already starts and stops the dev server, and exits non-zero on any console error or DOM-count regression. Do not modify it unless the smoke surface changes.

## Commit message style

Use Conventional Commits. Examples for this repo:
- `feat(canvas): add collapse/expand with chevron icons`
- `fix(layout): keep root node centered when children added`
- `style: tighten toolbar pill spacing`
- `docs: document expose methods in README`

Derive the type from the largest category of files changed. If only docs/config, use `chore` or `docs`. Keep subject ≤72 chars.

## Failure handling

- **Typecheck fails** → report the file:line, do NOT proceed to build/commit. Ask the user to fix or fix it yourself if the fix is obvious.
- **Build fails** → likely a Vite config or peer-dep issue. Show the error, do not commit.
- **Playwright fails** → look at the most recent `verify-output/0N-*.png` and the error log. The DOM count assertion in `verify.mjs` (`rendered nodes: 13` → `nodes after add: 14`) catches most rendering regressions.
- **Git fails** → likely no remote configured yet. Just `git init` + local commit, do not push.

## What this skill does NOT do

- Does NOT push to remote
- Does NOT create tags or releases
- Does NOT publish to npm
- Does NOT amend existing commits (creates new ones only)
- Does NOT run lint unless the user asks — there is no eslint config yet

## Files

- `scripts/verify.mjs` — the Playwright driver
- `verify-output/` — screenshot output, gitignored
- `.claude/skills/verify-and-commit/SKILL.md` — this file
