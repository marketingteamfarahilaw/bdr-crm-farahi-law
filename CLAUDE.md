# Farahi Law — BD Partner CRM

Internal CRM for the Business Development / Field Rep teams, plus a walled-off
Intake ("AI Case Desk") side. Live at **https://bdcrm.farahilaw.com**.

## Stack

React 19 + Vite + Tailwind v4 + wouter · tRPC v11 · Drizzle ORM on MySQL
(TiDB Cloud serverless) · Express · pnpm. One Node process serves both the API
and the built client.

- `client/src/pages/` — ~60 pages. `App.tsx` is the routing map; read it first
  to find anything.
- `server/` — one `*Router.ts` (tRPC procedures) + `*Db.ts` (queries) per area.
  `server/routers.ts` composes them. `server/_core/` is platform plumbing
  (auth, cookies, LLM, RingCentral, Vite middleware) — change it carefully.
- `drizzle/schema.ts` — every table.
- `shared/permissions.ts` — the role model. Read this before touching anything
  role-related.

## Deploying

**Pushing to `main` deploys to production automatically** — about 40 seconds,
via `.github/workflows/deploy.yml`. There is no separate release step, so
anything merged to `main` is immediately live to the whole team. Put risky work
on a branch.

Never build or `git pull` on the server by hand; let the workflow do it.

## Running it

`pnpm dev` — needs a `.env` (gitignored, real secrets) and **Node 20**. On
Node 25+ `tsx watch` silently never binds and prints nothing, which looks like
a hang. Startup takes 2–3 minutes. Verify with `pnpm check` and `pnpm test`.

**In a cloud session there is no `.env`**, so the app cannot run and the
database is unreachable. Edit, typecheck, commit, push — the deploy workflow
and the server do the rest. Don't burn time trying to boot it.

## Things that will bite you

- **`--gold` is not gold.** It's a legacy CSS token whose value is now the navy
  brand accent, and many components share it. To recolour one element, add a
  token (see `--action`, the orange Quick Add button) rather than editing
  `--gold`.
- **There is only the production database.** No staging, no seed data. Any
  write you make while testing is real and the team sees it.
- **A background RingCentral sync runs every 2 minutes** (`server/_core/index.ts`)
  and writes to production, transcribing calls via Whisper and summarising them
  with an LLM. It runs in local dev too — real data, real spend.
- **Hard wall between BD/FR and Intake.** Intake roles must never see facility
  or partner data, and BD/FR roles must never see intake case facts. Only
  `super_admin` crosses it. See `isIntakeOnly` / `canSeeIntake`.
- **`todo.md` is stale** — it describes an early lead-scraper phase, not the
  app as it stands. Trust the code.
- `DEPLOY.md` documents the original manual setup; the deploy workflow and the
  "How it actually runs" section there are current.

## Conventions

Match the surrounding file. Comments explain *why*, not what. tRPC procedures
are `protectedProcedure` unless deliberately public, and every list query is
role-scoped — agents see only their own rows, managers see all.
