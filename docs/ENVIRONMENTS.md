# Environments: beta and production

Every change is tested on **beta** before it reaches **production**.

| | Production | Beta |
|---|---|---|
| Git branch | `main` | `beta` |
| Backend (Render web service) | `threadline-backend` | `threadline-backend-beta` |
| Dashboard (Render static site) | `threadline-dashboard` | `threadline-dashboard-beta` |
| Database | prod Neon database | **separate** Neon database |
| WhatsApp (Whapi) | real channel, webhook points here | **none** — webhook is never pointed at beta |
| Outbound WhatsApp sends | sent | **faked and logged** (`APP_ENV=beta`) |
| Inbound student messages | real | "Simulate student message" button + seed script |

## Why beta can't touch production

1. **Separate database.** Beta has its own `DATABASE_URL`. No prod tickets or student data live there.
2. **No inbound traffic.** Whapi only lets one webhook URL per channel, and that stays the prod backend. Beta never receives real student messages.
3. **No outbound traffic.** With `APP_ENV=beta`, `src/services/whapiClient.js` returns a fake response for every send, reaction, and forward *before* it reads `WHAPI_TOKEN`. Even if someone pasted the prod token into beta, nothing would reach a student. Leave `WHAPI_TOKEN` unset in beta anyway.
4. **Can't be mistaken for prod.** The beta dashboard shows an amber "BETA environment" strip on every screen.
5. **Beta-only tools stay out of prod.** `/api/dev/*` (simulated messages) is only mounted when `APP_ENV=beta`, and `scripts/seed-beta-tat.js` refuses to run unless `APP_ENV=beta`.

## One-time setup

### 1. Beta database (Neon)
In the Neon console, create a new project (or a new database in the existing project) named `threadline-beta`. Copy its connection string, then create the tables:

```bash
psql "<BETA_DATABASE_URL>" -f src/schema.sql
psql "<BETA_DATABASE_URL>" -f src/holidays.sql
```

Don't use a Neon *branch of the prod database* — that would copy real students' phone numbers and chats into beta.

### 2. Beta backend (Render → New → Web Service)
- Repo: this repo, **Branch: `beta`**
- Build: `npm install` · Start: `npm start`
- Env vars:
  - `APP_ENV=beta`
  - `DATABASE_URL=<beta Neon URL>`
  - `DASHBOARD_PASSWORD=<a different password from prod>`
  - `WEBHOOK_SECRET=<any random string>`
  - `GEMINI_API_KEY=<same as prod is fine>`
  - do **not** set `WHAPI_TOKEN`

### 3. Beta dashboard (Render → New → Static Site)
- Repo: this repo, **Branch: `beta`**, Root directory: `client`
- Build: `npm install && npm run build` · Publish directory: `dist`
- Env vars:
  - `VITE_API_URL=<beta backend URL from step 2>`
  - `VITE_APP_ENV=beta`

Check: `<beta backend URL>/health` should return `{"ok":true,"env":"beta"}`.

## Day-to-day flow

```
feature/xyz ──merge──▶ beta ──(auto-deploys beta)──▶ test on beta dashboard
                         │
                         └──merge──▶ main ──(auto-deploys prod)
```

1. Build on a `feature/...` branch, merge it into `beta`, and push. Render redeploys beta.
2. Test on the beta dashboard (simulate messages, run the seed script, check reports).
3. When it's signed off, merge `beta` into `main` and push. Render redeploys prod.
4. **If the release changes `src/schema.sql`, run it against the prod database *before* merging to `main`.** Every statement in it is safe to re-run.
5. **If the release changes `src/holidays.sql`, run it on beta and prod too.** It only adds dates that aren't there yet.
6. **If the release adds a file in `migrations/`, run it once on each database, after deploying the code.** Each migration file says when to run it. These files are one-off: never re-run them.

## Running against beta from your machine

Your local `.env` may point at the **prod** database. To run beta-only scripts, pass the beta values inline:

```bash
APP_ENV=beta DATABASE_URL="<beta Neon URL>" node scripts/seed-beta-tat.js
```
