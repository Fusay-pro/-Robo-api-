# Security Audit — 2026-07-05

A code audit of the three repos (backend API, staff web, parent web) covering
authentication, authorization, injection, data leaks, and error handling.
This doc records **how each issue was spotted, why it matters, and how it was fixed**,
so future changes don't reintroduce the same class of bug.

Fixed in commit `Security hardening: fix IDORs, branch scoping, rate limits, error leaks`.

---

## How the audit was done

1. **Trace the request pipeline** — read `src/app.js` top-to-bottom to see what
   every request passes through (helmet → CORS → rate limits → JSON parser →
   auth middleware → routes). Anything mounted *before* `authMiddleware` is
   public; everything after only proves *"has a valid JWT"* — not *"is allowed
   to see this row."*
2. **Audit every route for the second check.** For each endpoint ask:
   *who can call this (role guard)?* and *which rows can they touch (ownership /
   branch scope)?* Missing either one on a route that takes an `:id` = IDOR
   (Insecure Direct Object Reference).
3. **Check every SQL query's placeholders** — count `$1…$n` against the params
   array, and look for string interpolation inside SQL.
4. **Grep the frontends for raw-HTML sinks** —
   `dangerouslySetInnerHTML | innerHTML | document.write | eval | new Function`.
5. **Check secret handling** — is `.env` gitignored? does any endpoint echo
   secrets? are frontend env vars limited to `NEXT_PUBLIC_API_URL`?
6. **Verify live** — restart the API and hit the fixed endpoints with a real
   owner token (404/403/data checks).

---

## Findings & fixes

### 1. 🔴 IDOR: any logged-in user could read/edit ANY student
**Files:** `src/routes/students.js`

**How it was spotted:** `GET /students/:id`, `GET/POST /students/:id/notes`, and
`PATCH /students/:id` sit behind `authMiddleware` but had **no role guard and no
ownership check** — the handler went straight from `req.params.id` to SQL.
A parent account could enumerate `/students/1`, `/students/2`, … and pull every
family's name/phone/email, read internal staff notes, or edit any child.

**Fix:** a single helper used by all four routes:

```js
async function loadStudentAuthorized(req, res) {
  const { rows: [student] } = await query(
    'SELECT * FROM students WHERE student_id = $1 AND deleted_at IS NULL',
    [req.params.id]);
  if (!student) { notFound(res); return null; }
  const u = req.user;
  const allowed =
    u.role === 'parent'      ? student.parent_user_id === u.user_id :
    u.role === 'super_owner' ? true :
    student.branch_id === u.branch_id;
  if (!allowed) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return student;
}
```

- parents → only their own children
- staff/owner → only their branch
- notes additionally got `roleGuard(['owner','staff','super_owner'])` so parents
  can never read internal notes.

**Rule for new routes:** any endpoint with `:id` needs BOTH a role guard and a
row-level check. "Logged in" is not authorization.

### 2. 🟠 Cross-branch data leak in parent search
**File:** `src/routes/users.js` — `GET /users/parents`

**Spotted by:** reading the WHERE clause: `role = 'parent' AND deleted_at IS NULL`
— no `branch_id`. Staff of branch A could list every branch's parents.

**Fix:** added `AND branch_id = $3` bound to `req.user.branch_id`.

### 3. 🟠 SQL crash: placeholder/params mismatch in parent search
**File:** `src/routes/students.js` — `GET /students` (parent role)

**Spotted by:** counting placeholders vs params. The list query's search clause
used `$4` (params: id, limit, offset, search) but the **count query reused the
same clause** while passing only 2 params → `$4 does not exist` error whenever a
parent searched.

**Fix:** the count query builds its own clause with `$2`.

**Rule:** never share a SQL fragment between queries with different param layouts.

### 4. 🟠 Staff could create students in other branches
**File:** `src/routes/students.js` — `POST /students`

**Spotted by:** `branch_id` came from the request body for every role.

**Fix:** staff/owner are forced to `req.user.branch_id`; only parents (choosing
their branch at registration) and super_owner may pass it.

### 5. 🟡 `withRLS` was a silent no-op + injection-prone pattern
**File:** `src/config/db.js`

**Spotted by:** two smells in three lines:
- `SET LOCAL` **outside a transaction does nothing** (Postgres just warns), so
  the RLS variables never actually applied.
- values were string-interpolated into SQL (`'${role}'`). Today they come from
  a signed JWT, but the pattern is one refactor away from injection.

**Fix:** real transaction + parameterized `set_config()`:

```js
await client.query('BEGIN');
await client.query(
  `SELECT set_config('app.role',$1,true),
          set_config('app.branch_id',$2,true),
          set_config('app.user_id',$3,true)`,
  [String(role), String(branchId ?? 0), String(userId ?? 0)]);
// ... fn(client) ... COMMIT / ROLLBACK
```

### 6. 🟡 500 errors leaked internals
**File:** `src/app.js` global error handler

**Spotted by:** the handler returned raw `err.message` — Postgres errors expose
table/column names and query fragments to any client.

**Fix:** 4xx keeps its message; **5xx now returns generic** `Internal server error`
(full detail still logged server-side). Because the Data-Sync panel relies on
readable errors ("sheet not shared", "no sheet configured"), `src/routes/sync.js`
catches those operational failures and returns them explicitly as **400 + message**.

### 7. 🟡 OTP generated with `Math.random()`
**File:** `src/routes/auth.js`

**Spotted by:** grep for `Math.random` in security-relevant code. It's a
predictable PRNG — not acceptable for a login code even with rate limiting.

**Fix:** `crypto.randomInt(1000, 10000)` (CSPRNG).

### 8. 🟡 Rate limits were unrealistic (self-DoS) & refresh tokens accumulated
**Files:** `src/app.js`, `src/routes/auth.js`

**Spotted by:** arithmetic: global limit was 100 req/15 min **per IP**, but a
staff dashboard fires dozens of calls and a whole school shares one WiFi IP —
legit users would hit 429. Meanwhile `/auth` at 10/15min would break token
refresh (each session refreshes ~4×/hour). Expired refresh tokens were also
never deleted.

**Fix:** global 1000/15min, `/auth` 60/15min, dedicated `/auth/login` 20/15min
(brute-force stays hard); expired tokens for a user are purged on each new
token issue.

---

## Checked and found SAFE (no action needed)

| Area | Result |
|---|---|
| **XSS / hardcoded HTML** | Zero `dangerouslySetInnerHTML` / `innerHTML` / `eval` in either frontend. All rendering is JSX (auto-escaped). Backend returns JSON only. |
| **Secrets over the network** | Google key, JWT secrets, DB URL live only in server `.env` (gitignored). No endpoint echoes them. Frontends embed only `NEXT_PUBLIC_API_URL`. No response contains `password_hash`. |
| **SQL injection** | All other queries use parameterized `$n` placeholders. |
| **Refresh-token design** | Tokens are 320-bit randoms, stored as SHA-256 hashes, rotated on every use. |
| **CORS / headers** | `helmet()` on; CORS restricted to the two app URLs from env. |
| **Path traversal in uploads** | multer generates random 32-hex filenames; no user-controlled paths. `/uploads` intentionally left public: URLs are unguessable capability links, and `<img>` tags can't send auth headers. Revisit if truly sensitive documents get uploaded. |

## Known remaining trade-offs

- **Tokens in `localStorage`** (both frontends) — vulnerable to theft *if* an XSS
  ever appears; acceptable now because no HTML sinks exist. Alternative: httpOnly
  cookies (bigger refactor).
- **Email enumeration** — register returns 409 "Email already registered". Low value
  target; left as-is.
- **Rotate the Google service-account key** — the current key was shared through
  an insecure channel during setup. Create a new JSON key, update `.env`,
  `pm2 restart robo-api`, then delete the old key in Google Cloud Console.

## How the fixes were verified

```
login owner@demo.local                    → 200, token issued
GET  /students?limit=2                    → 200 {"data":[],"total":0}
GET  /students?search=test                → 200 (count query no longer crashes)
GET  /users/parents                       → 200, branch-scoped
GET  /students/999999                     → 404 (not 200/500)
PATCH /students/999999                    → 404 (was: editable by anyone)
```
All six edited files pass `node -c`; API restarted under pm2 with 0 errors.
