# Working on the CRM

Read `CLAUDE.md` first: the stack, where things live, and the things that bite.

## How a change reaches the team

1. **Branch.** Never work on `main`. Create a branch from the latest `main`
   (`git switch -c your-name/short-description`).
2. **Push the branch** and open a **pull request** into `main`. Fill in the
   template: what changes, why, and whether it touches data.
3. **The owner reviews and approves.** Nothing merges without that approval
   (`.github/CODEOWNERS`).
4. **The owner merges.** Merging into `main` deploys to production
   automatically in about a minute (`.github/workflows/deploy.yml`) — there is
   no separate release step, so a merge *is* a release.

Don't push to `main`, force-push, or run anything on the server by hand; the
deploy workflow does that.

## Running it on your machine

- **Node 20** (not 25+: `tsx watch` silently never starts) and **pnpm**.
- `pnpm install`, then `pnpm dev`. Startup takes 2–3 minutes.
- You need a `.env`. It holds real credentials: the owner shares it with you
  privately (a password manager, never chat or email). Never commit it — it's
  gitignored — and don't copy it anywhere else.
- Before every push: `pnpm check` (types) and `pnpm test`.

## The database is the live one

There is no staging database and no test data. Everything you do locally —
saving a form, running a script, a test that writes — changes what the whole
team sees, immediately.

- Read freely; write only when you mean to, and say so in the pull request.
- Run scripts that change data only after the owner agrees, and dry-run first
  where the script has a `--dry` / dry-run mode.
- The background jobs stay off on your machine: the Lead Docket and Google
  Sheets syncs and the RingCentral call sync only run on the live server
  (`NODE_ENV=production`). Don't turn them on locally (`ENABLE_RC_SYNC=1`) —
  they would write the same data twice and pay twice for transcripts.
- Dates: connect with `{ uri: DATABASE_URL, timezone: "Z" }` like
  `server/db.ts`, or every date you write lands hours off.

## Rules that matter

- **The wall:** Intake roles never see facility or partner data; BD/FR roles
  never see intake case facts. Only `super_admin` crosses it
  (`shared/permissions.ts`).
- **Lead Docket is the source of truth** for leads and sign-ups; the CRM copies it.
- **Ask before changing who or what is counted** in any report.
- **No client names** in anything shared outside the CRM — logs, screenshots,
  exports, commit messages.
- **No secrets in git.** Keys and passwords live in `.env` on the server only.
