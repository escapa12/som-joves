# Som joves però no tant 🍻

Web per al grup: rànquing d'assistència a les trobades + joc de tiers. 100% en català, pensada per al mòbil.

Stack: Vite + Preact + TypeScript · Supabase (Postgres, anonymous auth, RLS) · GitHub Pages.

## Setup (once)

1. **Supabase** → new project (EU).
   - Authentication → Sign In / Providers → enable **Allow anonymous sign-ins**.
   - SQL Editor → run `supabase/schema.sql`, then the private `supabase/seed.local.sql` (members, faces, group code — not in git).
2. **GitHub** → push this repo. Settings → Pages → Source: **GitHub Actions**.
   Settings → Secrets and variables → Actions → add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (publishable/anon key, never the service_role key).
3. Push to `main` → the site deploys to `https://<user>.github.io/som-joves/`.
4. Share in WhatsApp: `https://<user>.github.io/som-joves/#/join/<GROUP_CODE>`. Each friend taps their face and picks a 4-digit PIN.

## Dev

```bash
npm i
npm run dev      # without .env.local → demo mode (data in localStorage)
npm test         # scoring unit tests
```

## Adding a mini-game

1. `src/modules/<id>/index.tsx` exporting a `ModuleDef` (see `src/core/registry.ts`).
2. Add it to `src/modules/index.ts`.
3. Tables prefixed `<id>_` in `supabase/schema.sql` + RLS using `is_member()` / `is_admin()`.

## Points (Rànquing d'assistència)

Each event type has a rule (editable by the admin in ⚙):
`fixed` (Cervesa +1, Barça +1, Cap de setmana +10) · `sleep_hours` (Festa: +1 per hour after 00:00) · `win` (Pàdel +1 if won) · `meet_time` (Bicicleta: −3 before 09:00, −1 after).
Kids multiplier ×2 per kid (from birth date), applied to meetup points; manual ± adjustments are not multiplied.
