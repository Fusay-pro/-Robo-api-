# Google Sheet → Database Sync: Setup Guide

How to wire a branch's Google registration sheet to the app so you can **import
students + parents** (with RCC / RCP codes) and **write codes back to the sheet**.

There are two parts:
- **Part A — one-time global setup** (do once, ever — shared by all branches)
- **Part B — per-branch setup** (repeat for each branch / each sheet)

---

## Part A — One-time global setup

You only do this once. It gives the backend a Google identity so it can read and
write sheets.

### A1. Create a Google service account + key
1. Go to <https://console.cloud.google.com/> → create (or pick) a project.
2. **APIs & Services → Library →** search **"Google Sheets API" → Enable**.
3. **APIs & Services → Credentials → Create credentials → Service account.**
   - Give it a name (e.g. `robotics-sheets`). Create. No roles needed. Done.
4. Open the new service account → **Keys → Add key → Create new key → JSON → Create.**
   A `.json` file downloads. **Keep it safe — it's a password.**
5. Note the service account **email** — it looks like
   `robotics-sheets@your-project.iam.gserviceaccount.com`. You'll share sheets with it.

### A2. Put the key in the backend `.env` (on the VM)
The backend reads `GOOGLE_SERVICE_ACCOUNT_KEY` as a JSON string. It must be on **one line**.

1. Minify the downloaded JSON to a single line (e.g. paste into <https://jsonformatter.org/json-minify>).
2. Edit `~/projects/robotics-school/R13en0ne/robotics-school/.env` and set:
   ```
   GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"robotics-sheets@...iam.gserviceaccount.com", ... }'
   ```
   Wrap the whole JSON in **single quotes**. Keep the `\n` sequences inside `private_key` exactly as they are.
3. Restart the backend so it picks up the new env:
   ```bash
   pm2 restart robo-api
   ```

### A3. Make sure the DB has the required columns
Run these once in **Supabase → SQL Editor** (safe to re-run — `IF NOT EXISTS`):
```sql
-- sheet URLs per branch
ALTER TABLE branches ADD COLUMN IF NOT EXISTS sheets_operational_id TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS sheets_finance_id     TEXT;
-- student / parent codes
ALTER TABLE students ADD COLUMN IF NOT EXISTS student_code VARCHAR(20);
ALTER TABLE users    ADD COLUMN IF NOT EXISTS user_code    VARCHAR(20);
```
(These also live in `migrations/013_branch_sheets.sql` and `migrate_codes.sql`.)

---

## Part B — Per-branch setup (repeat for each branch)

### B1. Prepare the Google Sheet
The importer auto-detects the tab that has the registration headers. Your sheet
can have extra columns — it only reads the ones it recognises (see the
**Column reference** below). The only **required** column is the student name.

If you want codes preserved, add a `รหัสประจำตัว` column (student RCC) and/or a
`รหัสผู้ปกครอง` column (parent RCP). Leave cells blank to have them auto-generated.

### B2. Share the sheet with the service account — as **Editor**
1. Open the sheet → **Share**.
2. Paste the service account email from step A1 (`...@...iam.gserviceaccount.com`).
3. Set permission to **Editor** (not Viewer — Editor is needed so the app can write
   the parent-code column back). Send.

### B3. Point the branch at the sheet (in the app)
1. Log in to the **staff web** app as the branch **owner**.
2. **Manage → Settings → Data Sync.**
3. Set the **operational sheet URL** to the full sheet link, e.g.
   `https://docs.google.com/spreadsheets/d/XXXXXXXX/edit` — enter the owner password to save.

### B4. Import
1. Same panel → **Import Students from Registration Sheet.**
2. It reports: imported / skipped (duplicates) / parents created / whether it wrote
   codes back to the sheet, plus any per-row errors.
3. Check the **Students** page — students should appear with their RCC codes,
   parents linked with RCP codes, courses, and class balances.

### B5. If something looks wrong — roll back and redo
The safety net is a full reset:
1. **Manage → Settings → Data Sync → Danger Zone → Reset All Data** (owner password).
   This wipes all students, parents, staff, courses, schedules, etc. for the branch
   but **keeps the owner account and the branch itself**.
2. Fix the sheet, then re-import (B4). Clean slate every time.

---

## Column reference (Thai header → what it becomes)

| Sheet column (any of these headers) | Maps to | Notes |
|---|---|---|
| `รหัสประจำตัว` | student code (RCC) | reused if present, else auto `RCC-XXXX` |
| `ชื่อ - สกุล (ไทย)` / `ชื่อ - สกุล` | student name | **required** |
| `ชื่อเล่น` | nickname | |
| `วัน เดือน ปี เกิด` / `วันเกิด` | date of birth | Thai Buddhist year is converted (−543) |
| `อายุ` | age | reads the number before `ปี` |
| `คอร์สเรียน` / `คอร์ส` | course | course auto-created if new |
| `คงเหลือ` | classes remaining | becomes the active package's balance |
| `ชื่อ-สกุล (ผู้ปกครอง)` / `ผู้ปกครอง` | parent name | siblings with the same name share one parent |
| `เบอร์มือถือ` / `เบอร์โทร` | parent phone | |
| `รหัสผู้ปกครอง` / `RCP` | parent code (RCP) | reused if present, else auto `RCP-XXXX`; **written back** |

**Behaviour notes**
- A student whose name already exists in the branch is **skipped** (no duplicates).
- Parents are grouped by their **RCP code** if the sheet has one, otherwise by
  **full parent name**. Matched siblings share a single parent account.
- Parent accounts are created with name + phone + RCP, but **no email/password**,
  so they can't log in until credentials are set later. (Multiple parents without
  email is fine — the DB allows it.)
- Each branch imports **independently** from its own sheet; RCC/RCP counters are
  global so codes never collide across branches.

---

## Troubleshooting

| Message | Cause / fix |
|---|---|
| `Google service account not configured` | `GOOGLE_SERVICE_ACCOUNT_KEY` empty or invalid JSON in `.env`. Redo A2, `pm2 restart robo-api`. |
| `No operational sheet configured for this branch` | Set the sheet URL in B3. |
| `Could not find a student registration tab` | No tab has recognisable headers — check the sheet has `ชื่อ - สกุล` / `คอร์สเรียน` / `ชื่อเล่น`. |
| `Could not find student name column` | The detected tab lacks a name column. |
| `Sheet write-back failed (is the service account an Editor?)` | Students still imported, but the sheet wasn't updated. Re-share as **Editor** (B2). |
| Reset says it failed | Check backend logs: `pm2 logs robo-api`. |

## Handy commands (on the VM)
```bash
pm2 status                 # is the backend + tunnel up?
pm2 logs robo-api          # backend logs (errors show here)
pm2 restart robo-api       # reload after .env change or git pull
git -C ~/projects/robotics-school/R13en0ne/robotics-school pull   # get latest code
```
