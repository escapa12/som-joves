# Som joves però no tant — context for Claude

Web app for Arnau's friend group (11 members). UI 100% in **Catalan**, mobile-first. Talk to Arnau in Catalan, concise and decisive. He is "Escarpa", the admin.

- Live: https://escapa12.github.io/som-joves/ (join link: `#/join/<group code>`, the code is private: never commit it)
- Repo: github.com/escapa12/som-joves, branch `main`. Push to `main` → GitHub Actions (tests → build → Pages) → live in 1–2 min.
- Backend: Supabase project `som-joves` (EU), https://bajaggfebebhgykhupfm.supabase.co, anonymous sign-ins ON. Free tier: pauses after 7 days idle.

## Stack & layout
Vite + Preact + TypeScript. `src/core/` (api interface, `supabaseApi.ts`, `demoApi.ts` localStorage backend, store, types), `src/shell/` (home, join, members, audit), `src/ui/` (components, `styles.css`), `src/modules/<id>/` (one mini-game each, `ModuleDef` in `src/core/registry.ts`, listed in `src/modules/index.ts`).

Modules:
- `assistencia`: attendance ranking (`att_` tables, points rules in `scoring.ts`, kids multiplier ×2^kids).
- `tiers`: tier list game (`tier_`): guess hidden category + author.
- `nomateix`: No diguis el mateix (`nm_`): 5 questions, lose if you match the creator. Creator visible, answers hidden until you finish.
- `fdps`: Fill de puta o Subnormal (`fs_`): one 0–10 vote per person per day (10 = 😈 fill de puta, 0 = 🤪 subnormal, sub = 10 − fdp), public votes, split-bar ranking.

## Rules when changing things
- Every API method must exist in **both** `supabaseApi.ts` and `demoApi.ts`.
- DB changes go in `supabase/schema.sql`, must be **idempotent** and **additive** (old app versions in open tabs still hit the same DB: never rename/drop what the live app uses). Tables prefixed per module, RLS with `is_member()` / `is_admin()`, writes via `security definer` RPCs with `set search_path = public, extensions`, function bodies quoted with `$fn$`.
- Deploy order: **run the SQL in Supabase first, then push**.
- Before committing: `npx tsc --noEmit && npm test && npm run build`. Check UI in demo mode (`npm run dev`, no `VITE_` vars in `.env.local` → localStorage demo, never touches prod).
- New players are added in the app (Membres → ＋), not in code. Private seed `supabase/seed.local.sql` is gitignored.

## Running SQL on production
Connection string lives in `.env.local` as `SUPABASE_DB_URL=postgresql://...` (Supabase → Connect → Session pooler). Do NOT put `VITE_SUPABASE_*` there or `npm run dev` will use prod.
```bash
set -a; source .env.local; set +a
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
```
Ask Arnau before any destructive SQL (delete/update of real data).
