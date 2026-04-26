# Robotics School — UI Specification for Kimi
**Two apps, one backend API at http://localhost:3000**

---

## App 1: Parent App

Used by parents on their phones. Login via LINE. Thai-friendly UI.

---

### Screen 1: Login
**Purpose:** Entry point for returning parents
**Components:**
- School logo + name
- Email input
- Password input
- "Login" button
- "Don't have an account? Register" link → goes to Screen 2
- "Browse courses without account" link → goes to Screen 3

**API:** `POST /auth/login` with `{ email, password }`
**On success:** store `access_token` + `refresh_token` in secure storage, redirect to Screen 4 (Home)

---

### Screen 2: Register (new parents)
**Purpose:** Parent creates an account
**Form fields:**
- Full name (required)
- Email (required)
- Password (required, min 8 characters)
- Phone number (required)
- Consent checkbox: "I agree to the school collecting my child's data for teaching purposes" — **required**

**API:** `POST /auth/register` with `{ name, email, password, phone, consent: true }`
**On success:** store `access_token` + `refresh_token`, redirect to Screen 4 (Home)

---

### Screen 3: Browse Courses (public, no login)
**Purpose:** Parents can browse before signing up
**Components:**
- Branch selector dropdown (load from `GET /public/branches`)
- Course cards: course name, level badge, robot type badge, packages list with price and promo discount if active
- "Sign up to enroll" CTA button

**API:** `GET /public/courses?branch_id=X`
**Data shown per course:**
```
Course name
Level: Beginner / Intermediate / Advanced
Robot: [robot type name]
Packages:
  - 10 classes — ฿2,500  (PROMO: 10% off → ฿2,250)
  - 5 classes  — ฿1,400
```

---

### Screen 4: Home (Dashboard)
**Purpose:** Parent's main view after login
**Components:**
- "My Children" section: cards showing each child, approval status badge (pending/approved), classes remaining
- "Upcoming Classes" list: next 3 confirmed sessions across all children
- "Low Class Warning" banner if any child has ≤ 3 classes left → "Buy more" button
- Bottom nav: Home | Children | Schedule | Profile

**APIs:**
- `GET /my/children`
- `GET /my/schedule`
- `GET /my/packages`

---

### Screen 5: My Children
**Purpose:** Manage children, add new ones
**Components:**
- List of children with name, age, approval status pill
  - Pending = yellow badge "Waiting for staff confirmation"
  - Approved = green badge
- "+ Add Child" button → opens Screen 6

**API:** `GET /my/children`

---

### Screen 6: Add Child
**Purpose:** Register a new child
**Form fields:**
- Child's name (required)
- Nickname
- Age
- Pre-existing conditions / health notes (text area, optional) — label: "Any medical conditions or physical limitations staff should know?"
- Branch selector (required — which branch will they study at?)

**API:** `POST /students` with `{ name, nickname, age, pre_existing_conditions, branch_id }`
**After submit:** show "Your child is pending confirmation from the branch. You'll be notified when approved."

---

### Screen 7: Buy a Package
**Purpose:** Parent purchases a class package for a specific child
**Components:**
- Child selector (if multiple children)
- Course list with packages (same as Screen 3 but only approved child's branch)
- Package card: name, class count, original price, discounted price if promo active
- "Buy" button → payment screen

**APIs:**
- `GET /public/courses?branch_id=X`
- On buy: `POST /checkout` with `{ student_id, package_id }` → returns Omise PromptPay QR

**Payment screen:**
- Shows PromptPay QR code
- "I've paid" button (polling `GET /my/packages` every 5s until package becomes active)
- Timeout after 15 minutes

---

### Screen 8: Weekly Schedule (Book a Slot)
**Purpose:** Parent sets a recurring weekly class slot for a child
**Components:**
- Child selector
- Package selector (which package to use)
- Calendar/time picker showing available sessions for the branch
  - Green slots = available
  - Red/greyed = full
- Selected slot shows: day of week, time, teacher name, spots left
- "Book recurring slot" button

**APIs:**
- `GET /schedules` (filtered by branch) — shows available slots with capacity
- `POST /reservations` with `{ student_id, schedule_id }`
**After booking:** "Slot reserved! You'll get a reminder the day before to confirm."

---

### Screen 9: Upcoming Sessions
**Purpose:** See all upcoming confirmed sessions, confirm day-before reservations
**Components:**
- Tabs: "Confirmed" | "Pending Confirmation"
- Each session card shows: date, time, course, teacher, location
- Pending cards have: yellow banner "Confirm by [deadline time]" + "Confirm" button + "Cancel" button

**APIs:**
- `GET /my/schedule` — confirmed sessions
- Confirm: `PATCH /reservations/:id/confirm`
- Cancel: `DELETE /reservations/:id`

---

### Screen 10: Request Reinstatement
**Purpose:** Parent requests a class credit back after child was absent
**Entry point:** Only accessible from an attendance record marked "absent" — NOT a top-level menu item
**Components:**
- Shows the session details (date, course, teacher)
- Reason dropdown: Medical Emergency | Bereavement | Accident
- Reason detail text area (minimum 50 characters — show character count)
- Evidence upload (photo of medical certificate, required)
- Submit button

**Validation shown inline:**
- "Reason must be at least 50 characters" if too short
- "Please upload evidence (e.g. medical certificate)" if no file

**API:** `POST /reinstatements` as multipart/form-data with fields: `attendance_id, student_id, customer_package_id, reason_category, reason_detail` + file field `evidence`
**After submit:** "Request sent to branch admin. You'll be notified of the decision."

---

### Screen 11: Profile
**Purpose:** Edit parent info, view consent status, logout
**Components:**
- Name, phone (editable)
- Consent status (read-only, shows when given)
- "Logout" button

**APIs:**
- `GET /my/profile`
- `PATCH /my/profile`
- `POST /auth/logout`

---

## App 2: Staff/Admin App

Used by staff and owners on desktop or tablet. Email/password login.

---

### Screen 1: Login
**Form:** Email + Password
**API:** `POST /auth/login`
**Redirect:** owner → Dashboard; staff → My Schedule Today

---

### Screen 2: My Schedule Today (Staff default home)
**Purpose:** Staff opens this every morning
**Components:**
- Date header (today's date in Thai Buddhist calendar format optional)
- Session cards sorted by time:
  - Branch session: time, course, room/location, enrolled students count vs capacity
  - Contract school visit: school name, address, time, max students
- Tap a session → opens Screen 3

**API:** `GET /schedules/my-today`

---

### Screen 3: Session Detail + Attendance
**Purpose:** Staff marks attendance during/after class
**Components:**
- Session header: course, time, location
- Student list with:
  - Student name + nickname
  - Pre-existing conditions (shown as orange warning badge if not null)
  - Attendance toggle: Present | Absent | Excused
- "Save Attendance" button

**APIs:**
- `GET /attendance/:scheduleId` — load student list
- `POST /attendance` per student (or batch)

---

### Screen 4: Pending Confirmations (Staff + Owner)
**Purpose:** Confirm new children waiting for approval
**Components:**
- List of pending children: name, age, parent name + phone, branch, submitted date
- "Approve" (green) and "Reject" (red) buttons per child

**API:**
- `GET /confirmations/pending`
- `PATCH /confirmations/:studentId` with `{ status: 'approved' | 'rejected' }`

---

### Screen 5: Dashboard (Owner only)
**Purpose:** Overview of branch health
**Tabs:** Capacity | Profit

**Capacity tab:**
- Table: upcoming sessions, course name, booked/max capacity, spots left
- Red highlight if spots_left === 0 (full)

**Profit tab:**
- Month picker (default current month)
- Cards: Total Revenue | Contract Revenue | Salary Cost | Other Expenses | Net Profit
- Each in ฿ with commas

**APIs:**
- `GET /dashboard/capacity`
- `GET /dashboard/profit?month=YYYY-MM`

---

### Screen 6: Schedule Management (Owner)
**Purpose:** Create and manage sessions, assign teachers
**Components:**
- Calendar view (week or month) showing all scheduled sessions
- Each session: time block, course name, teacher name, capacity fill
- Conflict indicator: orange outline if teacher is double-booked somewhere else that day
- "+ New Session" button → opens create form
- Click session → edit form (change teacher, capacity, time)

**Create/Edit form fields:**
- Course (dropdown)
- Teacher (dropdown — staff list)
- Type: Branch Session | Contract School Visit
- If contract school: school selector
- Date, Start time, End time
- Max capacity (pre-filled from branch setting, editable)
- "Force assign" checkbox (shown only if teacher conflict detected)

**APIs:**
- `GET /schedules`
- `POST /schedules` / `PATCH /schedules/:id`
- `DELETE /schedules/:id`
- Returns 409 if teacher conflict → show warning + force checkbox

---

### Screen 7: Students List (Owner + Staff)
**Purpose:** Browse and manage all students at the branch
**Components:**
- Search by name
- Filter by approval status
- Table: student name, parent name, parent phone, age, packages count, classes remaining
- Click row → student detail (packages, enrollment history, warnings)

**APIs:**
- `GET /students?limit=50&offset=0`
- Paginated — show "Load more" or page controls

---

### Screen 8: Reinstatement Requests (Owner only)
**Purpose:** Review and approve/reject emergency requests
**Components:**
- List of pending requests: student name, session date, reason category, submitted date
- Click → detail view:
  - Session info
  - Reason category + detail text
  - Evidence image (tap to view full size)
  - "Approve" button (green)
  - "Reject" button (red) → opens rejection note input (required text field)

**API:**
- `GET /reinstatements` (owner sees branch requests)
- `PATCH /reinstatements/:id` with `{ status, reviewer_note }`

---

### Screen 9: Contract Schools (Owner)
**Purpose:** Manage B2B school partnerships and log payments
**Components:**
- List of contract schools: name, address, contact
- "+ Add School" button
- Each school row: "Log Payment" button → opens payment form (amount, date, notes)
- Payment history per school (accordion)

**APIs:**
- `GET /contract-schools`
- `POST /contract-schools`
- `PATCH /contract-schools/:id`
- `POST /contract-schools/:id/payments`

---

### Screen 10: Promotions (Owner)
**Purpose:** Create and manage package discounts
**Components:**
- Active promotions list: package name, discount %, valid dates, uses count / max uses
- "+ Create Promotion" form:
  - Package selector
  - Discount % (1-100)
  - Valid from / until date pickers
  - Max uses (optional)
- Deactivate button per promotion

**APIs:**
- `GET /promotions`
- `POST /promotions`
- `PATCH /promotions/:id` with `{ deactivate: true }`

---

### Screen 11: Staff & Salaries (Owner)
**Purpose:** Manage staff accounts and salary data
**Components:**
- Staff list: name, role, email, salary, active_from, active_until
- "+ Add Staff" button
- Edit salary / dates per staff member
- Soft delete (sets deleted_at)

**APIs:**
- `GET /users`
- `POST /users`
- `PATCH /users/:id`
- `DELETE /users/:id`

---

### Screen 12: Expenses (Owner + Staff)
**Purpose:** Submit and approve expense reimbursements
**Components:**
- Staff view: "My Expenses" list + "+ Submit Expense" form (amount, category, description, receipt photo)
- Owner view: all branch expenses with "Approve" / "Reject" per pending item
- Owner cannot approve their own expenses (button disabled + tooltip)

**APIs:**
- `GET /expenses`
- `POST /expenses`
- `PATCH /expenses/:id` with `{ status: 'approved' | 'rejected' }`

---

### Screen 13: Transactions (Owner only)
**Purpose:** View payments, manually confirm cash/transfer payments
**Components:**
- Table: student name, package, amount, payment method, status, date
- Filter by status (pending / confirmed)
- "Confirm" button on pending cash/transfer rows

**APIs:**
- `GET /transactions`
- `PATCH /transactions/:id` with `{ status: 'confirmed' }`

---

### Screen 14: Warnings (Staff + Owner)
**Purpose:** Daily list of students running low on classes
**Components:**
- Generated today's date header
- Student list sorted by classes remaining (lowest first)
- Red badge if ≤ 2, orange if = 3
- Parent phone shown for easy follow-up call

**API:** `GET /warnings`

---

## Shared UI Conventions

| Element | Spec |
|---------|------|
| Primary color | #1A56DB (blue) |
| Success | #057A55 (green) |
| Warning | #E3A008 (yellow) |
| Danger | #E02424 (red) |
| Font | Sarabun (Thai-compatible Google Font) |
| Currency | Always display as ฿X,XXX format |
| Dates | Display in `DD/MM/YYYY` format; store UTC |
| Pagination | All lists use `limit=50&offset=0`; show "Load more" button |
| Error handling | Toast notification bottom-right; red background; auto-dismiss 4s |
| Auth expiry | On 401 response → try `POST /auth/refresh`; if fails → redirect to login |
| Loading state | Skeleton loaders (not spinners) for list views |
| Empty states | Friendly Thai message + illustration, not blank white |

---

## API Base URL
```
Development:  http://localhost:3000
Production:   https://api.yourdomain.com
```

## Auth Header (all authenticated requests)
```
Authorization: Bearer <access_token>
```
