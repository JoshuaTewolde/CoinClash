# 0001: Monorepo, tooling and repo conventions

- **Date:** 2026-11-14
- **Status:** Accepted

## Context

The spec (§2) asks for a pnpm-workspace monorepo in TypeScript, with games as separate packages
that both the server (rules) and the web app (boards) consume. We have under 24 hours, so build
steps must stay minimal and CI must be trustworthy from the first commit.

## Decision

- **pnpm 9 workspaces**: `apps/*`, `packages/*`, `packages/games/*`.
- **Workspace packages export TypeScript source** (`"exports": { ".": "./src/index.ts" }`). Vite
  and Vitest compile it on the fly, and the server's **tsup** build bundles `@coinclash/*`
  (`noExternal`). No package has its own build step.
- Game packages expose two subpaths: `./engine` (pure, server-safe) and `./board` (React, web
  only). The server can never accidentally pull in React.
- **Strict TS** with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`. ESLint 9 flat config
  with typescript-eslint. Prettier. husky + lint-staged pre-commit.
- **Vitest 2 workspace** (`vitest.workspace.ts`), with one project per package and coverage
  configured at the root.
- **CI** (`ci.yml`): lint, format check, typecheck, tests with coverage, build, plus a **gitleaks
  full-history scan via the CLI Docker image**.
- Conventional Commits, one logical change per commit, `main` always green.

## Alternatives considered

- **Building each package to `dist/`** (tsc project references): more correct for publishing, but
  slower and adds watch-mode complexity. We don't publish packages, so we rejected it.
- **gitleaks GitHub Action**: it fails on a repository's very first push because the root commit
  has no parent. We switched to running the CLI over the full history, which is also stricter.
- **Turborepo/Nx**: unnecessary for 5–8 packages.

## Consequences / trade-offs

- Any consumer of a workspace package must understand TS (Vite, Vitest, tsup, tsx all do).
- pnpm was installed with `npm i -g pnpm@9.15.9` because `corepack enable` needs admin rights on
  this Windows machine. CI uses `pnpm/action-setup`, which reads `packageManager`.
