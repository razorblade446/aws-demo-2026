---
name: Use pnpm instead of npm
description: All package management in this project must use pnpm, not npm
type: feedback
---

Always use `pnpm` for installing, removing, and running packages — never `npm install` or `npm run`.

**Why:** Project policy, enforced as a non-overridable rule in CLAUDE.md.

**How to apply:** Replace any `npm install` → `pnpm install`, `npm run X` → `pnpm X` or `pnpm run X`, `npx` → `pnpm dlx` when installing tools. For scaffolding that requires npm (like create-next-app), scaffold in /tmp then copy files into the project and run `pnpm install` after.
