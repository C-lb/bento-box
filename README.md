## Environment

All API keys live in the repo-root `.env` (gitignored). `next.config.ts` loads it
via `@next/env`, so `npm run dev` / `npm run build` pick it up regardless of cwd.
No per-package `.env` is needed.

## Tools

### Headshot Studio

Canva renderer setup: see `docs/setup/canva.md`.
