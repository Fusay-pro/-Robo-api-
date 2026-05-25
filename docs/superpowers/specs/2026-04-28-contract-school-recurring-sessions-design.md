# Contract School Recurring Sessions — Design

**Date:** 2026-04-28
**Status:** Approved (pending user spec review)

## Problem

The owner currently has to create every contract-school visit one by one in the schedule manager. For a school under contract for 3 months, two visits a week, that's ~24 manual entries — too painful and error-prone. Owner asked for a "normal calendar" experience: set up the recurrence once, let the calendar fill itself in.

## Goal

Let the owner define a contract school's teaching schedule as recurring weekly slots between the contract's start and end date, and have the system auto-generate the individual session rows. Out-of-scope: recurring sessions for branch (in-house) classes — those stay manual for now.

## Design

### Data model

New table `contract_school_slots` — each row is one recurring weekly slot inside a contract.

| Column                | Type                  | Notes                                          |
|-----------------------|-----------------------|------------------------------------------------|
| `slot_id`             | serial PK             |                                                |
| `contract_school_id`  | int FK                | parent contract                                |
| `day_of_week`         | int (0–6)             | 0 = Sunday, matches `EXTRACT(DOW)`             |
| `start_time`          | time                  | "10:00"                                        |
| `duration_minutes`    | int                   | replaces per-contract duration                 |
| `teacher_user_id`     | int FK users          | recurring teacher for this slot                |
| `created_at`          | timestamptz default now |                                              |
| `deleted_at`          | timestamptz nullable  | soft delete                                    |

Existing `contract_schools.sessions_per_week` and `contract_schools.session_duration_minutes` are **deprecated**: columns stay in the DB but the form stops writing to them and the UI stops displaying them. List endpoints can compute the same numbers from the slot rows (`COUNT(*)` and `MAX(duration_minutes)`) when the front-end needs them.

The existing `schedules` table gets one new column:

| Column            | Type    | Notes                                                |
|-------------------|---------|------------------------------------------------------|
| `source_slot_id`  | int FK contract_school_slots, nullable | identifies auto-generated sessions |

`source_slot_id IS NULL` → owner-created session. `source_slot_id IS NOT NULL` → auto-generated from a contract slot.

### Auto-generation rules

When the owner saves slots on a contract, the backend regenerates the projected sessions for that contract:

1. For each active slot, walk every date between `contract_start_date` and `contract_end_date` matching `day_of_week`.
2. For each occurrence, upsert a `schedules` row keyed on `(source_slot_id, scheduled_date)`. Don't duplicate.
3. Soft-delete `schedules` rows whose `source_slot_id` no longer exists or whose date is out of the (possibly shortened) contract range — but only if `starts_at > NOW()` (never touch past sessions).

This makes editing predictable:

- **Add a slot** → fills in only the new slot's occurrences.
- **Edit a slot** (time, duration, teacher) → regenerates that slot's future-dated rows; past rows stay as the historical record.
- **Delete a slot** → soft-deletes that slot's future-dated rows. **Warns** if any of those have enrolled students (per below).
- **Extend `contract_end_date`** → fills the gap.
- **Shorten `contract_end_date`** → deletes future-dated rows past the new end. Owner sees a confirmation showing the count, with an **Undo** button (10s window) that restores the deleted slots and re-generates.

### Deletion safety

Two paths through "this delete will affect future sessions":

- **Shorten contract end date** → confirmation modal: *"This will remove 6 upcoming sessions. Undo will be available for 10 seconds."* → proceed → toast with **Undo** that restores the soft-deleted rows.
- **Delete a slot that has enrolled students on future sessions** → warning modal: *"3 of these sessions have students enrolled. They will be removed and parents will see them disappear from their schedule."* → owner can still proceed (not blocked) but they've explicitly acknowledged.

### UI changes (staff app)

#### Contract Schools screen — top tabs

Mirror the Expenses pattern: **Active · Upcoming · Expired** (Active is default).

- **Active** = `today BETWEEN contract_start_date AND contract_end_date`
- **Upcoming** = `today < contract_start_date`
- **Expired** = `today > contract_end_date`

Each card shows the slot list inline:
> 📅 **Bangkok Christian School** — *180d remaining*
>   • Mon 10:00 – 11:30 · Kru Pim
>   • Wed 14:00 – 15:00 · Kru Boss

A **"Renew soon"** orange pill appears 14 days before the contract end date.

#### Contract form modal

Two sections:

1. **Contract details** — name, address, contact, dates, notes (existing fields, minus the now-derived sessions/week + duration).
2. **Teaching slots** — list of slot rows, each: `[day chip] [start time HH:mm] [duration min] [teacher dropdown] [✕ delete]` + **"+ Add slot"** button.

Save → API call writes the contract + slots in one transaction → backend regenerates schedules → toast + modal closes.

#### Schedule Mgmt calendar (already month-grid layout)

Auto-generated school sessions stay visually identical (purple bar, 🤖 capacity etc.) but get a small **🏫** badge in the corner so owner knows it came from a contract. Long-press shows two destructive options instead of one:
- "Edit contract instead" → navigates to that contract's form (fastest path)
- "Delete this one occurrence" → deletes just this `schedule` row, leaves the slot's other future occurrences intact (escape hatch for one-off cancellations like a holiday)

#### Dashboard expiry banner

Small dismissible banner at the top of the owner Dashboard:
> ⚠️ **2 contracts expiring within 14 days** → tap to review.

Tap navigates to Contract Schools screen, Active tab, with the expiring contracts pinned to the top.

### Backend endpoints

- `GET    /contract-schools` — extend response to include `slots` array per school.
- `POST   /contract-schools` — accepts `slots: []` in the same body; transactional.
- `PATCH  /contract-schools/:id` — same; recomputes generated sessions.
- `DELETE /contract-schools/:id/slots/:slotId` — soft-delete a single slot.
- `POST   /contract-schools/:id/restore-slots` — undo helper for the 10s window.

The session generator lives in `src/services/contractSlotGenerator.js`. Wired into all four mutation endpoints above.

### Migration

`migrations/004_contract_school_slots.sql`:
- Create `contract_school_slots` table with the schema above.
- Add `schedules.source_slot_id` column with FK + index.
- For existing contract schools, no auto-conversion — owner re-enters slot details.

### Testing

- Unit test the generator: contract spanning 3 months × 2 slots/week = exactly N rows; idempotent on re-run; regenerates correctly when slot's `start_time` changes (only future sessions move); shortening end date deletes only future rows.
- Integration test the endpoints: POST /contract-schools with 2 slots produces the expected schedule rows; DELETE slot with enrolled students returns warning info.
- Manual: walk the staff app — create contract, see calendar fill, edit slot, delete slot, undo shortening.

## Out of scope

- Recurring sessions for branch classes (separate effort if owner asks later).
- Per-occurrence overrides beyond "delete this one" (e.g. moving a single occurrence to a different time). Owner can delete + manually create.
- Auto-renewal flows.
- LINE / FCM notifications to parents when sessions auto-disappear (covered by existing notification work).
