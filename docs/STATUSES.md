# Ticket statuses

There are four statuses. The rules are in `src/services/statusRules.js` and tested in `tests/status.test.js`.

| Status | When to use it | How it gets set | TAT tracking |
|---|---|---|---|
| **New Ticket** | Ticket received | **Automatic:** a student messages and has no open ticket | Response TAT starts |
| **Open** | Team is working on it, not yet responded | **Automatic:** an agent clicks into the chat in the CRM | Response and resolution TAT tracked |
| **Pending** | Waiting for a dependency; we've replied with some clarification | **Automatic:** an agent's reply (from the CRM, a forward, or the WhatsApp phone) | Time in Pending is shown; TAT clocks **keep running** |
| **Resolved** | Issue addressed | **Manual:** agent clicks **Mark as resolved** | Resolution TAT stops; the ticket is closed |

## How tickets move

```
student message ─▶ NEW TICKET ─(agent opens chat)─▶ OPEN ─(agent replies)─▶ PENDING ─(Mark as resolved)─▶ RESOLVED
                       └──────────────(agent replies without opening it first)──────────▲
```

- **Opening a chat** moves only a New Ticket to Open. Opening an Open, Pending or Resolved chat changes nothing. The inbox refreshing in the background never counts as opening.
- **An agent reply** moves New Ticket or Open to Pending. Further replies while Pending keep it Pending. A reply to a Resolved ticket leaves it Resolved.
- **Student messages never change the status of an existing ticket.** In particular, a Pending ticket stays Pending when the student writes "any update?".
- **After Resolved**, a new message from the student starts a **new ticket** (New Ticket), linked to the old one. The old ticket stays Resolved.
- **Manual override:** agents can still click any status in the details panel. For example, moving a Resolved ticket back to Open clears its resolution time.
- **Closed has been retired.** The API rejects it, and existing Closed tickets were migrated to Resolved.

## Time in Pending

Every status change is recorded in `ticket_status_events`, so time in Pending is measured exactly:
- In the inbox, Pending tickets show **⏸ 1h 15m**.
- The details panel shows **"Pending for 1h 15m (working hrs) · since …"** while it's Pending, and **"Was Pending for …"** afterwards.
- The TAT drill-down list and its CSV have a **Time in Pending** column.

This is working time only (10:00–18:00 IST, Mon–Sat, excluding holidays). A ticket that goes in and out of Pending more than once gets all its Pending periods added together.

## Not the same as "Awaiting our reply"

In the TAT Reports, **"Awaiting our reply"** means queries that haven't had a first reply from us yet. That's different from the **Pending** status.

## Releasing to an existing database

1. Run `src/schema.sql`. It adds the history table and gives every old ticket a starting history entry.
2. Deploy the code.
3. Run **once**: `migrations/2026-10-status-workflow.sql`.
   - Closed tickets become Resolved.
   - Open tickets that already have a reply become Pending, to match the new meaning.

## Testing on beta

`scripts/seed-beta-status.js` loads one ticket per case (ST1–ST5). Each ticket's notes say what you should see and what to try.
