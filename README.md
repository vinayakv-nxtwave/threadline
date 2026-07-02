# Threadline backend — Launchpad WhatsApp support desk

Receives student messages from Whapi.Cloud, turns them into tickets, and lets
your dashboard send replies back out over WhatsApp. A ticket can never be
closed until it's explicitly marked resolved, and any new message from the
student — even on an old resolved/closed ticket — reopens it automatically.

## 1. Prerequisites

- Node.js 18+
- A PostgreSQL database (local, or a hosted one — Render, Railway, Supabase, Neon all work)
- A Whapi.Cloud channel already linked to your support WhatsApp number, with its API token

## 2. Setup

```bash
cd threadline-backend
npm install
cp .env.example .env
```

Fill in `.env`:

- `DATABASE_URL` — your Postgres connection string
- `WHAPI_TOKEN` — from your Whapi channel page
- `WEBHOOK_SECRET` — make up any long random string; this stops randoms on the
  internet from POSTing fake messages into your ticket queue

Create the tables:

```bash
psql "$DATABASE_URL" -f src/schema.sql
```

Run it:

```bash
npm run dev
```

Server starts on `http://localhost:3000`. Check `http://localhost:3000/health`.

## 3. Point Whapi at your webhook

Whapi needs to reach your server over the public internet, so for local
testing, expose it with a tunnel:

```bash
ngrok http 3000
```

Then, in the Whapi dashboard → your channel → Webhooks:

1. Set the webhook URL to:
   `https://<your-ngrok-or-real-domain>/webhook/whapi?secret=<your WEBHOOK_SECRET>`
2. Enable the `messages.post` event (this covers new incoming messages)
3. Use "Test webhook" in the dashboard to confirm it reaches your server

Once deployed for real, swap the ngrok URL for your production domain.

## 4. How a message becomes a ticket

1. A student messages your WhatsApp number.
2. Whapi POSTs it to `/webhook/whapi`.
3. `ticketService.handleIncomingMessage`:
   - Looks up the most recent ticket for that phone number.
   - No ticket yet → creates one with status `new`.
   - Ticket exists and is `resolved` or `closed` → reopens it to `open` (the
     "new query, can't stay closed" rule).
   - Ticket exists and is `pending` (waiting on the student) → moves to `open`
     (waiting on your team again).
   - Ticket is already `new`/`open` → status untouched, message just gets added.
4. The message is logged either way.

## 5. API for the dashboard

| Method | Path                      | Purpose                                  |
|--------|---------------------------|-------------------------------------------|
| GET    | `/api/tickets`            | List tickets. Filter with `?status=`, `?category=`, `?search=` |
| GET    | `/api/tickets/:id`        | Ticket detail + full message thread       |
| PATCH  | `/api/tickets/:id`        | Update `status`, `category`, `priority`, `assignee`, `notes`, `tags` |
| POST   | `/api/tickets/:id/reply`  | `{ "body": "..." }` — sends a WhatsApp reply via Whapi and logs it |
| POST   | `/api/auth/login`         | `{ "password": "..." }` — returns `{ "token": "..." }` on success |

All `/api/tickets` routes require `Authorization: Bearer <token>`, obtained by
logging in with `DASHBOARD_PASSWORD`. Tokens are stateless (HMAC-signed, no
session store), so they keep working across Render free-tier restarts, and
expire after 30 days.

The server rejects `PATCH .../:id { "status": "closed" }` with a 400 unless
the ticket's current status is already `resolved` — same rule the dashboard
prototype enforces in the UI, now enforced server-side too so it can't be
bypassed by calling the API directly.

## 6. Testing without waiting for a real WhatsApp message

```bash
curl -X POST "http://localhost:3000/webhook/whapi?secret=YOUR_WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  -d '{
    "messages": [{
      "id": "test-1",
      "from_me": false,
      "type": "text",
      "from": "919876543210",
      "from_name": "Test Student",
      "text": { "body": "My live class link is not opening" }
    }]
  }'
```

Then check it landed:

```bash
curl http://localhost:3000/api/tickets
```

## 7. What's not covered yet (v1 scope)

- **Only text messages** are turned into tickets right now. Whapi also sends
  images, voice notes, documents, etc. — those webhook events are currently
  skipped. Worth adding once you know which types students actually send.
- `/api/tickets` routes require a shared dashboard password (see below) — this
  is team-level access control, not per-user accounts.
- **No agent/user accounts** — `assignee` is just a free-text name for now.
- Delivery/read status webhooks (`statuses.post`) aren't handled — useful
  later if you want to show "seen" ticks in the dashboard.

## 8. Dashboard

The `client/` folder is a Vite + React + Tailwind app (`client/src/threadline-crm.jsx`)
wired to this API — no mock data. Run it with:

```bash
cd client
npm install
cp .env.example .env   # set VITE_API_URL if the backend isn't on localhost:3000
npm run dev
```

Serves on `http://localhost:5173`. It polls `/api/tickets` and the open
ticket's detail every few seconds, so new inbound messages show up without a
manual refresh.

## 9. Deploying

`render.yaml` in the repo root configures two Render services: the backend
(`npm install` / `npm start`) and the dashboard as a static site (built from
`client/`). On Render: New → Blueprint → point at this repo, then set
`DATABASE_URL`, `WHAPI_TOKEN`, `WEBHOOK_SECRET`, and `DASHBOARD_PASSWORD` in
the dashboard (they're marked `sync: false` so Render prompts for them
instead of expecting them in the repo). Once deployed, update the Whapi
webhook URL to the backend's Render domain.

If the backend's Render URL changes, update `VITE_API_URL` in the
`threadline-dashboard` static site's env vars and trigger a redeploy (Vite
bakes env vars in at build time, so this can't be changed at runtime).
