# EduLevy API

Version 0.1 — Week 27 design spec. No handlers exist yet.

---

## Conventions

Stated once so they are not repeated on every endpoint.

**Base paths**

- `/api/…` — JSON endpoints for the dashboard
- `/webhook/…` — inbound traffic from M-Pesa, Africa's Talking, Meta

**Methods**

| Verb | Use |
|---|---|
| `GET` | Read |
| `POST` | Create, or trigger an action |
| `PATCH` | Partial update |
| `DELETE` | Remove |

**Response shape** — always these keys, on success and failure.

```json
{ "data": {}, "error": null }
{ "data": null, "error": { "message": "…", "code": "…" } }
```

**Pagination** — list endpoints accept `?limit=20&offset=0` (max 100) and
return a `meta` block: `{ "total": 412, "limit": 20, "offset": 0 }`.

**Money** — every amount is `…Minor`, an integer in cents. `700000` is
KES 7,000. Never a decimal: floating point cannot represent decimal money
exactly and the errors accumulate across thousands of transactions.

**Authentication** — a session cookie, **not a JWT**.

Login sets `__Host-sid`, an opaque random id, with `HttpOnly; Secure;
SameSite=Lax`. The session record lives in Redis; the cookie is meaningless
on its own. Every request costs one Redis lookup.

The trade: a JWT needs no lookup, but cannot be revoked before it expires —
a dismissed bursar would keep dashboard access until the token ran out.
Deleting a Redis key removes access immediately. For a system holding
schools' financial records, instant revocation is worth the lookup.

**Roles** — `bursar` and `manager`. The bursar operates; the manager
authorises anything that spends the school's money. Endpoints marked
**manager only** are enforced in the route itself, not merely hidden in the
UI — hiding a button does not stop the request being sent by hand.

**Tenant resolution**

- Dashboard routes: `tenant_id` from the server-side session record
- USSD: the three-digit school code the caller enters
- WhatsApp: the school's registered number

Never from a URL, body, query parameter, header or subdomain.

**Standard errors** — assumed on every authenticated endpoint. Individual
endpoints document only their additions.

| Code | Meaning |
|---|---|
| 400 | Invalid input |
| 401 | No valid session |
| 403 | Session valid, role insufficient |
| 404 | Not found in this tenant |
| 409 | Conflict — duplicate, or invalid state transition |
| 422 | Well-formed but semantically invalid |

---

# 1. Auth

### POST /api/auth/login

Authenticates a staff member and starts a session.

**Auth:** none.

**Body**
```json
{ "email": "mary@greenhills.ac.ke",
  "password": "…",
  "tenantSlug": "green-hills" }
```

`tenantSlug` selects which school's users to search. Email is unique per
school, not globally, so the same person may hold accounts at two schools.

**Response 200** — plus `Set-Cookie: __Host-sid=…`
```json
{ "data": { "id": "uuid", "email": "mary@greenhills.ac.ke", "role": "bursar",
            "tenant": { "id": "uuid", "name": "Green Hills School" } },
  "error": null }
```

No token in the body. The cookie is the credential.

**Errors**
- `400` — missing fields
- `401` — wrong email or password. **Identical response for both**, so the
  endpoint does not reveal which emails exist
- `429` — rate limited: 5 attempts per 15 minutes, keyed by IP *and* by
  email independently

**Notes**
- Argon2id verification. On user-miss, verify against a dummy hash anyway so
  response timing does not leak account existence
- Destroy any existing session id and mint a new one — session fixation defence

---

### POST /api/auth/logout

Ends the session.

**Auth:** session.

**Body** — none.

**Response 204** — no content, plus a cookie-clearing header.

Deletes the Redis key. This is the revocation path that justifies choosing
sessions over JWTs.

---

### GET /api/auth/me

Returns the current user. The dashboard calls this on load to decide what
to render.

**Auth:** session.

**Response 200**
```json
{ "data": { "id": "uuid", "email": "mary@greenhills.ac.ke", "role": "bursar",
            "tenant": { "id": "uuid", "name": "Green Hills School",
                        "pinAuthEnabled": false } },
  "error": null }
```

`role` drives which controls the UI shows. It is not the security boundary —
the routes enforce that independently.

---

# 2. Students

### GET /api/students

Lists students for the current school.

**Auth:** session. Bursar or manager.

**Query**

| Param | Notes |
|---|---|
| `classLabel` | Exact match |
| `status` | `paid` \| `partial` \| `unpaid` \| `credit` |
| `search` | Name or admission number, partial match |
| `limit`, `offset` | Default 20, max 100 |

**Response 200**
```json
{ "data": [ { "id": "uuid", "admissionNo": "ADM/2026/014",
              "fullName": "Amina Otieno", "classLabel": "Form 2",
              "balanceMinor": 700000 } ],
  "meta": { "total": 412, "limit": 20, "offset": 0 },
  "error": null }
```

`balanceMinor` comes from the `student_balances` view — charges plus
adjustments minus settled payments. It is never a stored column.
**A negative balance is a credit, not an error.**

---

### POST /api/students

Adds a student.

**Auth:** session. Bursar or manager.

**Body**
```json
{ "admissionNo": "ADM/2026/014",
  "fullName": "Amina Otieno",
  "classLabel": "Form 2" }
```

`classLabel` is optional — a newly enrolled student may not be assigned yet.

**Response 201**
```json
{ "data": { "id": "uuid", "admissionNo": "ADM/2026/014",
            "fullName": "Amina Otieno", "classLabel": "Form 2",
            "createdAt": "2026-08-17T09:12:00Z" },
  "error": null }
```

**Errors**
- `400` — `admissionNo` or `fullName` missing
- `409` — admission number already exists at this school

The uniqueness index is `(tenant_id, upper(admission_no))` and excludes
soft-deleted rows, so a departed student's number can be reused.

---

### GET /api/students/:id

One student.

**Auth:** session. Bursar or manager.

**Response 200**
```json
{ "data": { "id": "uuid", "admissionNo": "ADM/2026/014",
            "fullName": "Amina Otieno", "classLabel": "Form 2",
            "guardians": [ { "id": "uuid", "fullName": "Mary Otieno",
                             "msisdn": "+254712345678" } ],
            "balanceMinor": 700000 },
  "error": null }
```

**Errors** — `404` if the student belongs to another tenant. RLS makes this
indistinguishable from not existing, which is the correct behaviour: it does
not confirm that an id exists elsewhere.

---

### PATCH /api/students/:id

Updates a student.

**Auth:** session. Bursar or manager.

**Body** — any subset:
```json
{ "fullName": "Amina A. Otieno", "classLabel": "Form 3" }
```

`admissionNo` is **immutable** once set. It appears on receipts and is used
by parents to identify the student, so changing it would orphan history.
Correcting a mistyped number means soft-deleting and re-creating.

**Response 200** — the updated student.

---

### GET /api/students/:id/balance

**Auth:** session. Bursar or manager.

**Response 200**
```json
{ "data": { "studentId": "uuid",
            "chargedMinor": 1200000,
            "paidMinor":     500000,
            "adjustedMinor": -500000,
            "balanceMinor":   200000 },
  "error": null }
```

Read directly from the `student_balances` view.

---

### GET /api/students/:id/ledger

Full statement: every charge, payment and adjustment in date order.

**Auth:** session. Bursar or manager.

**Response 200**
```json
{ "data": [
    { "type": "charge",     "id": "uuid", "amountMinor": 1200000,
      "label": "Term 2 Tuition", "createdAt": "2026-05-01T08:00:00Z" },
    { "type": "payment",    "id": "uuid", "amountMinor": 500000,
      "provider": "mpesa", "providerRef": "RK7B2X9QLM",
      "paidBy": "Mary Otieno", "createdAt": "2026-05-14T09:22:00Z" },
    { "type": "adjustment", "id": "uuid", "amountMinor": -500000,
      "kind": "waiver", "reason": "Family hardship — approved by board",
      "actor": "James Mwangi", "createdAt": "2026-05-20T11:00:00Z" } ],
  "error": null }
```

Every row is append-only. Nothing here can be edited or deleted; corrections
appear as new rows.

---

# 3. Guardians

### GET /api/guardians

**Auth:** session. Bursar or manager.

**Query** — `search` (name or number), `limit`, `offset`.

**Response 200**
```json
{ "data": [ { "id": "uuid", "fullName": "Mary Otieno",
              "msisdn": "+254712345678",
              "pinSet": true, "pinLocked": false,
              "students": [ { "id": "uuid", "fullName": "Amina Otieno" },
                            { "id": "uuid", "fullName": "Yusuf Otieno" } ] } ],
  "meta": { "total": 380, "limit": 20, "offset": 0 },
  "error": null }
```

`pinSet` and `pinLocked` are booleans derived server-side. **The PIN hash is
never returned.**

---

### POST /api/guardians

Registers a parent.

**Auth:** session. Bursar or manager.

**Body**
```json
{ "msisdn": "0712345678", "fullName": "Mary Otieno" }
```

**Response 201**
```json
{ "data": { "id": "uuid", "msisdn": "+254712345678",
            "fullName": "Mary Otieno" },
  "error": null }
```

Note the number is stored normalised. The server converts to E.164 using the
tenant's `country_code` before insert — `0712…`, `254712…` and `+254712…` are
three different strings, and without normalisation the unique constraint
catches none of them.

**Errors**
- `400` — number not valid for the school's country
- `409` — this number is already registered at this school

The constraint is `(tenant_id, msisdn)` rather than global, so a parent with
children at two schools can register at both.

---

### POST /api/guardians/:id/students

Links a guardian to a student.

**Auth:** session. Bursar or manager.

**Body**
```json
{ "studentId": "uuid" }
```

**Response 201**

**This is the authorization boundary for USSD and WhatsApp.** It decides
which children a phone number may see. A guardian with no links sees nothing.

**Errors**
- `404` — student not found in this tenant
- `409` — already linked

---

### DELETE /api/guardians/:id/students/:studentId

Removes the link.

**Auth:** session. Bursar or manager.

**Response 204**

Revokes that number's access to that child. Writes an audit row.

---

### POST /api/guardians/:id/reset-pin

Clears a forgotten or locked PIN.

**Auth:** session. Bursar or manager.

**Body** — none.

**Response 204**

Clears `pin_hash`, resets `failed_pin_attempts` to 0, clears `pin_locked_at`.
The parent is prompted to create a new PIN on their next dial-in.

**There is deliberately no self-service equivalent.** If a parent could reset
their own PIN by dialling in, then anyone holding the handset could reset it
too, and the PIN would protect nothing. Reset requires the office, where
identity can be checked.

Writes an audit row: `pin.reset`.

---

# 4. Fee items and charges

### GET /api/fee-items

**Auth:** session. Bursar or manager.

**Query** — `category` (`tuition` | `trip` | `club` | `sport`),
`active` (default `true`).

**Response 200**
```json
{ "data": [ { "id": "uuid", "code": "T2-TUITION", "label": "Term 2 Tuition",
              "category": "tuition", "amountMinor": 1200000,
              "currency": "KES", "active": true } ],
  "error": null }
```

---

### POST /api/fee-items

**Auth:** session. Bursar or manager.

**Body**
```json
{ "code": "F3-NBO-TRIP", "label": "Form 3 Nairobi Trip",
  "category": "trip", "amountMinor": 200000 }
```

**Response 201** — the created item.

**Errors**
- `400` — `amountMinor` not a positive integer, or `category` not one of the
  four permitted values
- `409` — `code` already exists at this school

---

### PATCH /api/fee-items/:id

**Auth:** session. Bursar or manager.

**Body** — any subset of `label`, `amountMinor`, `active`.

**Response 200**

**Fee items are deactivated, never deleted.** Existing charges reference
them, and deleting would break the ledger. Setting `active: false` hides it
from new charges and from the USSD menu while leaving history intact.

Changing `amountMinor` affects **future** charges only. Charges already
assigned keep the amount recorded at the time — the amount is copied onto
the charge, not looked up.

---

### POST /api/charges

Assigns a fee to one student. This is what creates debt.

**Auth:** session. Bursar or manager.

**Body**
```json
{ "studentId": "uuid", "feeItemId": "uuid" }
```

`amountMinor` is taken from the fee item, not the request, so the client
cannot set an arbitrary amount.

**Response 201**
```json
{ "data": { "id": "uuid", "studentId": "uuid", "feeItemId": "uuid",
            "amountMinor": 1200000,
            "createdAt": "2026-08-17T09:30:00Z" },
  "error": null }
```

**Errors**
- `404` — student or fee item not found in this tenant
- `422` — fee item is inactive

**Duplicates are permitted.** There is no unique constraint on
`(student, fee_item)` — a student may legitimately be charged the same item
twice, for instance two separate trips using the same fee code. The bursar
sees existing charges on the student page before adding.

---

### POST /api/charges/bulk

Assigns a fee item to a whole class.

**Auth:** session. Bursar or manager.

**Body**
```json
{ "feeItemId": "uuid", "classLabel": "Form 3", "skipExisting": true }
```

**Response 201**
```json
{ "data": { "created": 38, "skipped": 2, "chargeIds": ["uuid", "…"] },
  "error": null }
```

`skipExisting: true` skips students who already hold an unpaid charge for
this fee item, which is the safe default for re-running a term's tuition
assignment. `false` charges everyone regardless.

The whole batch runs in **one transaction**: either every student is charged
or none is. A partial batch would leave the bursar unable to tell how far it
got.

**Errors**
- `404` — no students in that class
- `422` — fee item is inactive

---

# 5. Payments

### GET /api/payments

**Auth:** session. Bursar or manager.

**Query** — `status` (`pending` | `settled` | `failed`), `from`, `to`,
`studentId`, `limit`, `offset`.

**Response 200**
```json
{ "data": [ { "id": "uuid", "studentId": "uuid",
              "studentName": "Amina Otieno",
              "admissionNo": "ADM/2026/014",
              "amountMinor": 500000, "provider": "mpesa",
              "providerRef": "RK7B2X9QLM", "status": "settled",
              "paidBy": { "id": "uuid", "fullName": "Mary Otieno" },
              "allocated": true,
              "createdAt": "2026-08-17T07:15:00Z" } ],
  "meta": { "total": 1284, "limit": 20, "offset": 0 },
  "error": null }
```

`raw_payload` is stored but never returned — it contains provider internals
of no use to the dashboard.

---

### GET /api/payments/unmatched

The orphan queue: payments that arrived with no matching student.

**Auth:** session. Bursar or manager.

**Response 200**
```json
{ "data": [ { "id": "uuid", "amountMinor": 500000, "provider": "mpesa",
              "providerRef": "RK7B2X9QLM",
              "payerMsisdn": "+254712345678",
              "enteredAdmissionNo": "ADM/2026/O14",
              "createdAt": "2026-08-17T07:20:00Z" } ],
  "error": null }
```

These occur when a parent mistypes an admission number, or pays from an
unregistered number. **The money has already left their account** — Safaricom
holds it — so the payment is recorded with `student_id` NULL and reconciled
by hand, never rejected. Rejecting it would mean money existing in the
school's account and nowhere in the system.

`enteredAdmissionNo` is extracted from the payload to help the bursar guess
the intended student. Note `O14` versus `014` in the example above.

Backed by a partial index on `WHERE student_id IS NULL`.

---

### PATCH /api/payments/:id/assign

Attaches an orphan payment to a student.

**Auth:** session. Bursar or manager.

**Body**
```json
{ "studentId": "uuid" }
```

**Response 200** — the updated payment.

**Errors**
- `404` — student not found in this tenant
- `409` — this payment is already assigned

Writes an audit row: `payment.assigned`.

---

### POST /api/payments/:id/allocate

Splits a payment across specific charges.

**Auth:** session. Bursar or manager.

**Body**
```json
{ "allocations": [ { "chargeId": "uuid", "amountMinor": 300000 },
                   { "chargeId": "uuid", "amountMinor": 200000 } ] }
```

**Response 201**
```json
{ "data": { "paymentId": "uuid", "allocatedMinor": 500000,
            "unallocatedMinor": 0 },
  "error": null }
```

Needed because one payment may cover several charges, or part of one. The
USSD flow asks the parent to choose a category, so that information exists
and should not be discarded — otherwise the school knows a total balance but
cannot answer "is the trip paid?".

Anything unallocated remains general credit against the student.

**Errors**
- `422` — allocations exceed the payment amount
- `422` — a charge belongs to a different student than the payment
- `409` — this payment is already allocated to that charge

---

### GET /api/payments/:id/receipt

**Auth:** session, **or** a valid signed token for parent access.

**Response 200** — `application/pdf`.

Generated on demand from the payment id; there is no receipts table, because
a receipt is a rendering of a payment rather than a separate fact.

For the SMS link sent to parents, the URL carries a signed token with a
72-hour expiry, so the link cannot be guessed by incrementing an id.

---

# 6. Adjustments

### GET /api/adjustments

**Auth:** session. Bursar or manager.

**Query** — `studentId`, `kind`, `from`, `to`.

**Response 200**
```json
{ "data": [ { "id": "uuid", "studentId": "uuid",
              "studentName": "Amina Otieno",
              "kind": "waiver", "amountMinor": -500000,
              "reason": "Family hardship — approved by board",
              "actor": { "id": "uuid", "fullName": "James Mwangi" },
              "createdAt": "2026-05-20T11:00:00Z" } ],
  "error": null }
```

---

### POST /api/adjustments

**Manager only.**

Changes what a student owes without money changing hands.

**Body**
```json
{ "studentId": "uuid", "kind": "waiver", "amountMinor": -500000,
  "reason": "Family hardship — approved by board" }
```

**Response 201** — the created adjustment.

`amountMinor` is signed: negative reduces what is owed (waiver, bursary),
positive increases it (correcting a mistyped charge). Zero is rejected.

`reason` is required. In six months somebody will ask why one student owes
less than the rest of the class, and the answer must be in the database.

**Errors**
- `400` — `amountMinor` is zero, or `reason` is empty
- `403` — caller is a bursar
- `422` — `kind` not one of `waiver` | `bursary` | `reversal` | `correction`

**This endpoint is why `requireRole('manager')` is load-bearing rather than
decorative** — these rows spend the school's money. Writes an audit row.

---

# 7. Staff and payroll

### GET /api/staff

**Auth:** session. Bursar or manager.

**Response 200**
```json
{ "data": [ { "id": "uuid", "fullName": "Peter Otieno",
              "msisdn": "+254722000111", "roleTitle": "Teacher",
              "grossMinor": 4500000, "active": true } ],
  "error": null }
```

---

### POST /api/staff

**Manager only.**

**Body**
```json
{ "fullName": "Peter Otieno", "msisdn": "0722000111",
  "roleTitle": "Teacher", "grossMinor": 4500000 }
```

**Response 201**

Manager-gated because a salary figure is a commitment of the school's money.

**Errors**
- `400` — `grossMinor` not a positive integer
- `409` — this number already belongs to a staff member at this school

---

### PATCH /api/staff/:id

**Manager only.**

**Body** — any subset of `fullName`, `roleTitle`, `grossMinor`, `active`.

**Response 200**

Changing `grossMinor` affects **future** payroll runs only. Existing
`payroll_lines` hold a snapshot taken when the run was created, so a
September raise does not rewrite August's payslip.

Staff are deactivated, never deleted — payroll history references them.

---

### GET /api/payroll

**Auth:** session. Bursar or manager.

**Response 200**
```json
{ "data": [ { "id": "uuid", "period": "2026-08", "status": "approved",
              "totalMinor": 180000000, "staffCount": 40,
              "approvedBy": "James Mwangi",
              "approvedAt": "2026-08-28T10:15:00Z",
              "paidBy": null, "paidAt": null } ],
  "error": null }
```

The bursar sees this list read-only.

---

### GET /api/payroll/:id

One run plus its lines.

**Auth:** session. Bursar or manager.

**Response 200**
```json
{ "data": { "id": "uuid", "period": "2026-08", "status": "draft",
            "totalMinor": 180000000,
            "lines": [ { "id": "uuid", "staffId": "uuid",
                         "fullName": "Peter Otieno",
                         "grossMinor": 4500000, "notifiedAt": null } ] },
  "error": null }
```

---

### POST /api/payroll/:id/approve

**Manager only.**

Moves `draft` → `approved`.

**Body** — none.

**Response 200** — the updated run.

Stamps `approved_by` and `approved_at`. **Sends nothing.** Notification
happens at mark-paid, so teachers are not told about money that has not moved.

**Errors**
- `403` — caller is a bursar
- `409` — run is not in `draft` status

Writes an audit row: `payroll.approved`.

---

### POST /api/payroll/:id/mark-paid

**Manager only.**

Moves `approved` → `paid`, and triggers notifications.

**Body** — none.

**Response 200** — the updated run.

Stamps `paid_by` and `paid_at`, then enqueues **one BullMQ job per line**,
not one job looping over 40 staff, so a single bad phone number cannot kill
the batch.

**Errors**
- `403` — caller is a bursar
- `409` — run is not in `approved` status

**Two endpoints rather than one because approving the amount and confirming
the money left are separate acts.** This is separation of duties expressed
in the API surface.

**The system does not move money.** M-Pesa B2C is out of scope, so the actual
transfer happens outside the system by whatever means the school already
uses, and is then recorded here.

---

### Scheduled: monthly draft creation

Not an endpoint. A BullMQ repeatable job runs daily at 06:00 `Africa/Nairobi`
and exits unless the date matches the configured payroll day (the 28th).

Timezone is pinned explicitly — leaving it on server UTC is how payroll fires
on the wrong calendar day.

Idempotency comes from `UNIQUE (tenant_id, period)`. A duplicate run from a
retry, redeploy or second worker instance violates the constraint and
short-circuits harmlessly. **Insert and catch — never check-then-insert.**

---

# 8. Announcements

### GET /api/announcements

**Auth:** session. Bursar or manager.

**Response 200**
```json
{ "data": [ { "id": "uuid", "title": "Form 3 Nairobi Trip",
              "targetType": "class", "targetClassLabel": "Form 3",
              "createdBy": "Mary Otieno",
              "createdAt": "2026-08-15T14:00:00Z",
              "deliveryStats": { "total": 40, "delivered": 38,
                                 "failed": 1, "queued": 1 } } ],
  "error": null }
```

---

### POST /api/announcements

Creates a notice and queues its deliveries.

**Auth:** session. Bursar or manager.

**Body**
```json
{ "title": "Form 3 Nairobi Trip",
  "body": "The Form 3 trip costs KES 2,000, due Friday. Dial *384*555# to pay.",
  "targetType": "class", "targetClassLabel": "Form 3",
  "channel": "sms" }
```

**Response 201**
```json
{ "data": { "id": "uuid", "recipientCount": 40 }, "error": null }
```

Creates one `announcement_deliveries` row per intended recipient **before
anything is sent**, so the bursar can later answer "did Mary get it?". A
missing row would be ambiguous — failed, or never included?

`channel` is `sms` or `whatsapp`. **USSD is not valid**: it only works when
the parent dials in, so nothing can be pushed to them.

**Errors**
- `400` — `targetType` is `class` but `targetClassLabel` missing, or
  `targetType` is `all` but a class label supplied
- `422` — no guardians match the target

---

### GET /api/announcements/:id/deliveries

The tick list: every intended recipient and what happened.

**Auth:** session. Bursar or manager.

**Query** — `status` to filter.

**Response 200**
```json
{ "data": [ { "guardianId": "uuid", "fullName": "Mary Otieno",
              "msisdn": "+254712345678", "channel": "sms",
              "status": "delivered", "sentAt": "2026-08-15T14:01:12Z",
              "errorMessage": null },
            { "guardianId": "uuid", "fullName": "John Kamau",
              "msisdn": "+254733222111", "channel": "sms",
              "status": "failed", "sentAt": null,
              "errorMessage": "Invalid MSISDN" } ],
  "error": null }
```

---

# 9. Audit log

### GET /api/audit-logs

**Manager only.**

**Query** — `action`, `actorUserId`, `targetType`, `targetId`, `from`, `to`.

**Response 200**
```json
{ "data": [ { "id": "uuid", "action": "fee.waived",
              "actor": { "id": "uuid", "fullName": "James Mwangi" },
              "targetType": "student", "targetId": "uuid",
              "changes": { "amountMinor": -500000, "reason": "Family hardship" },
              "createdAt": "2026-05-20T11:00:00Z" } ],
  "meta": { "total": 214, "limit": 20, "offset": 0 },
  "error": null }
```

**Read-only. There is no POST, PATCH or DELETE on this resource** — the log
is append-only and written internally by the actions that generate it.

Actions recorded: `fee.waived`, `bursary.granted`, `payment.reversed`,
`payment.assigned`, `pin.reset`, `payroll.approved`, `payroll.paid`,
`guardian.unlinked`.

---

# 10. Live updates

### GET /api/events

Server-Sent Events stream. Payments appear on the dashboard without a refresh.

**Auth:** session.

**Response** — `text/event-stream`, scoped to the session's tenant.

```
event: payment.settled
data: {"id":"uuid","studentId":"uuid","studentName":"Amina Otieno",
       "amountMinor":500000,"balanceMinor":700000}

event: payment.unmatched
data: {"id":"uuid","amountMinor":500000,"payerMsisdn":"+254712345678"}
```

Backed by Redis pub/sub rather than each dashboard polling the database.

**Reconnection** — the client sends `Last-Event-ID` on reconnect and the
server replays events from a short Redis buffer, so payments landing during a
brief disconnect are not missed. Beyond the buffer window the client refetches
the list instead.

---

# 11. Webhooks

These carry **no session** and must never touch `requireSession`. Mount them
on a separate router with raw-body parsing — signature verification happens
on the raw bytes, before JSON parsing, or the signature will not match.

No session does not mean no authentication. Each is verified differently.

### POST /webhook/mpesa/callback

Inbound payment notification from Daraja.

**Auth:** none. Verified by signature on the raw body.

**Body** — Daraja's `stkCallback` structure. Stored whole in `raw_payload`.

**Response 200** — always, including for duplicates and for payments that
cannot be matched to a student. A non-200 makes Safaricom retry.

```json
{ "ResultCode": 0, "ResultDesc": "Accepted" }
```

**Idempotency** — `UNIQUE (provider, provider_ref)` on the M-Pesa receipt
number. **Insert and catch the violation; never check-then-insert**, because
two simultaneous callbacks would both pass the check and both insert.

The constraint is global rather than tenant-scoped: a provider reference is
globally unique, so scoping it per tenant would allow one payment to be
recorded twice under two schools if tenant resolution ever went wrong.

**Performance** — the handler must stay under roughly 100ms: verify, insert,
commit, publish to Redis, return. Everything slow — the confirmation SMS, the
receipt — goes to BullMQ. Awaiting a WhatsApp send inside this handler is the
most likely way to blow the two-second dashboard budget.

**Errors**
- `400` — signature verification failed. Do not process

---

### POST /webhook/ussd

Africa's Talking USSD gateway.

**Auth:** none. Source verified; tenant resolved from the dialled code.

**Body** — form-encoded: `sessionId`, `serviceCode`, `phoneNumber`, `text`.

**Response 200** — `text/plain`, prefixed:

- `CON …` — show this text and wait for more input
- `END …` — show this text and terminate the session

```
CON Enter school code:
CON Green Hills School
    1. Amina Otieno
    2. Yusuf Otieno
END Check your phone for the M-Pesa prompt.
```

**Constraints**
- 182-character screen limit; truncate fee labels server-side
- State lives in Redis keyed by `sessionId`, 180-second TTL. Africa's Talking
  sends the accumulated input string (`1*003*2*1`) on every hop — do not parse
  position-by-position, use it only as a fallback
- The tenant lookup by three-digit code is **the only query in the system
  permitted to run outside a tenant-scoped transaction**

**Flow**

```
ENTRY → school code → RESOLVE TENANT
                    → RESOLVE GUARDIAN from phone number   ← authorization gate
                    → [PIN if enabled]
                    → choose child → category → item → amount
                    → CONFIRM → enqueue STK Push → END
```

The parent **never types an admission number.** Resolution flows from the
calling number through `guardian_students`, so there is nothing to enumerate.
An unregistered number receives a polite dead end.

STK Push is fire-and-forget: the USSD session ends immediately and the
callback lands separately. Never hold the session waiting for payment.

---

### GET /webhook/whatsapp

Meta's one-time verification challenge, sent when the webhook is registered.

**Query** — `hub.mode`, `hub.verify_token`, `hub.challenge`.

**Response 200** — the raw `hub.challenge` value as plain text, if the token
matches. `403` otherwise.

---

### POST /webhook/whatsapp

Inbound WhatsApp messages.

**Auth:** none. Verified by `X-Hub-Signature-256` on the raw body.

**Response 200** — immediately, before processing. Meta retries aggressively
on slow responses, so the message is queued to BullMQ and handled
asynchronously.

Tenant resolves from the recipient number via `channel_bindings`. Guardian
resolves from the sender number, with the same authorization rule as USSD.

---

## Out of scope

Documented so their absence reads as a decision rather than an omission.

| Excluded | Reason |
|---|---|
| Public signup | Tenants are admin-provisioned by seed script |
| Forgot password | Staff accounts are reset by the platform owner |
| Tenant deletion | Soft delete only; the 30-day purge worker is designed, not built |
| Stripe | Behind a `PaymentProvider` interface — designed, not implemented |
| M-Pesa B2C | No outbound payouts; payroll records rather than transfers |
| Statutory deductions | Gross salary only; PAYE and NSSF are a regulatory domain of their own |
| Platform super-admin | No cross-tenant view |
| Sibling credit transfer | Credit is modelled per student, not per family |