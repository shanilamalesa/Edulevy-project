# EduLevy

A multi-tenant school fee collection platform for schools whose parents do not
have smartphones or internet access. Parents dial a USSD short code, pay with
M-Pesa or a card, and the payment appears on the school's dashboard in real
time. Several schools share one system, and no school can see another's
records.

Built as a Week 27 capstone for the Mctaba Labs Full-Stack Marathon.

---

## The problem

Paying school fees in much of East Africa means leaving work, travelling to a
bank branch, queuing to pay cash, collecting a printed receipt, and carrying
that receipt to the school office as proof. At the school, the bursar writes
each payment by hand into a ledger book. Working out who has paid means
reading pages of handwriting.

EduLevy replaces the bank queue with the parent's phone and the ledger book
with a screen that updates as money arrives.

---

## What it does

**For parents** — dial a short code from any handset, no app and no internet.
Select a child, see what is owed, pay by M-Pesa or card, receive a receipt by
SMS.

**For the bursar** — add students, register guardians, create fee items,
charge a class or the whole school in one action, and watch payments arrive
live.

**For the manager** — everything the bursar can do, plus the decisions that
spend the school's money: fee waivers, bursaries, and payroll approval.

---

## Architecture

```
Parent's phone ──USSD──→ Africa's Talking ──┐
Parent's phone ──WhatsApp─→ Twilio ─────────┼──→ Express API ──→ PostgreSQL
Bursar's browser ──→ Next.js dashboard ─────┘         │              (RLS)
                                                      ├──→ Redis
                                                      │    (sessions,
                                                      │     USSD state,
                                                      │     pub/sub)
                                                      ├──→ M-Pesa Daraja
                                                      └──→ Paystack
```

```
sme-os/
├── sql/              Migrations. Run once, by hand, as postgres.
├── api/              Express backend
│   └── src/
│       ├── app.js            Wiring: middleware, routes, server
│       ├── db/               pool, redis, withTenant
│       ├── auth/             session create/read/destroy
│       ├── middleware/       requireSession, requireRole
│       ├── payments/         provider abstraction, Paystack
│       ├── mpesa/            Daraja STK Push
│       ├── ussd/             USSD session state
│       ├── whatsapp/         WhatsApp session state
│       ├── notify/           SMS
│       ├── events/           Redis pub/sub event bus
│       └── routes/           HTTP endpoints
├── client/           Next.js dashboard
└── docs/             API specification
```

Three layers, each talking only to the one below it. A route never touches
the connection pool directly — it always goes through `withTenant()`.

---

## Six decisions worth defending

### 1. Isolation is enforced by the database, not the application

Every tenant-scoped table carries a `tenant_id`, and PostgreSQL row-level
security filters every query independently of the application code:

```sql
CREATE POLICY tenant_isolation ON students
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
```

The point is what happens when the application forgets. A query written
without a `WHERE` clause — and across nearly forty endpoints, eventually one
will be — returns nothing rather than everything. RLS is a safety net beneath
the code, not a replacement for it.

**`FORCE` is required, not optional.** RLS does not apply to the role that
owns the table by default, and the application connects as owner. Without
`FORCE` the policies are silently bypassed.

**And superusers bypass RLS entirely.** The first isolation test here returned
every school's students, and the policies looked correct — the test was
running as `postgres`. The application connects only as `edulevy_app`, which
owns nothing and bypasses nothing. Connecting as superuser would disable every
policy while isolation tests run as a normal role continued to pass.

### 2. `tenant_id` comes only from the server-side session

Never from a request body, query parameter, header, or subdomain. Every
multi-tenant breach is a variant of trusting a client-supplied tenant
identifier.

There are exactly two exceptions, both documented in code: the `tenants`
lookup by USSD dial code, and `payment_lookup` in the payment callback. Both
exist to *establish* the tenant, so neither can require one.

### 3. Balance is derived, never stored

There is no `balance` column anywhere. It is a view:

```
balance = charges + adjustments − settled payments
```

A stored column would let two payments arriving in the same moment both read
the old value and both write their own result, silently losing one. Deriving
it also makes overpayment work with no special case — the balance goes
negative, which *is* credit, and next term's charge absorbs it automatically.
A stored column would most likely have been clamped at zero, losing the
parent's money.

Money is stored as `BIGINT` in minor units. Floating point cannot represent
decimal money exactly, and the errors accumulate until a bursar finds
shillings that will not reconcile.

### 4. Payments are idempotent

M-Pesa retries a callback if it does not receive a clear response, so
duplicate deliveries are certain rather than hypothetical. A payment credited
twice is the worst bug this system could have.

Two guards. The handler checks the payment is still `pending` before touching
it, and `UNIQUE (provider, provider_ref)` on the receipt number backs that up.
The pattern is **insert and catch the violation, never check then insert** —
checking first leaves a gap where two simultaneous callbacks both pass the
check and both insert. Only the database can check and insert as one
indivisible action.

The same pattern guards payroll runs, via `UNIQUE (tenant_id, period)`, so a
retried scheduled job cannot create two runs for one month.

### 5. Authorization on a channel with no authentication

USSD has no login, no password, no session. The network supplies the calling
number and it cannot be forged, so the phone number is the credential. A join
table decides which children that number may see.

An earlier version of this design had parents typing an admission number to
check a balance. Admission numbers are sequential, so anyone could dial in and
walk through them reading every family's financial position. Resolving from
the calling number instead means there is nothing to enumerate.

### 6. Sessions can be revoked; JWTs cannot

Login stores an opaque random id in Redis and returns it as an `HttpOnly`
cookie. The cookie is meaningless without the server.

A JWT is self-verifying — the server checks the signature and trusts it
without looking anything up. That is faster, but it cannot be revoked. If a
bursar were dismissed at 10am, her token would stay valid until it expired.
Deleting one Redis key ends access instantly. The cost is a lookup per
request, which is the right trade for a system holding financial records.

`SET LOCAL` rather than `SET` for the tenant, because the application reuses
pooled connections — a session-level setting would leak the tenant into the
next unrelated request.

---

## Roles

The bursar operates; the manager authorises anything that spends the school's
money.

| | Bursar | Manager |
|---|---|---|
| View students, payments, staff, payroll | Yes | Yes |
| Add students, guardians, fee items, charges | Yes | Yes |
| Waive fees, grant bursaries, reverse payments | **No** | Yes |
| Add or change staff and salaries | **No** | Yes |
| Approve payroll, mark it paid | **No** | Yes |
| View the audit log | **No** | Yes |

Enforced in the route with `requireRole('manager')`, not by hiding buttons.
Hiding a control is not security — the request can still be sent by hand.

Every privileged action writes an immutable row to `audit_log`. The
application has `INSERT` permission on that table and nothing else:

```sql
REVOKE UPDATE, DELETE ON audit_log FROM edulevy_app;
```

It is not that no delete route exists. The database refuses.

---

## Payments

Two providers behind one interface. Callers do not know which one runs.

**M-Pesa (Daraja STK Push)** — a prompt appears on the parent's handset and
they enter their PIN. Kenyan numbers only.

**Paystack** — a card checkout link, sent by SMS for USSD parents and in the
chat for WhatsApp parents. Covers international guardians and anyone
preferring a card.

```
Parent confirms
   ↓
startPayment() chooses the provider
   ↓
Payment row written as PENDING, channel session ends immediately
   ↓
Parent pays
   ↓
Provider webhook → verify → settle → publish event → SMS receipt
```

The channel session ends before the payment completes on purpose. A USSD
session dies after about three minutes and a parent needs longer than that to
find their PIN.

**Webhook verification differs by provider.** Paystack signs the body with
HMAC SHA512, verified on the raw bytes before parsing. Daraja does not sign
at all — security there comes from an unguessable callback URL and matching
against a pending row this system created.

---

## Real-time dashboard

Payments appear without a refresh. Server-Sent Events over a connection the
browser holds open, backed by Redis pub/sub so an event published on one API
instance reaches a dashboard connected to another.

Events are filtered by tenant in the SSE route, using the tenant from the
session — so two schools can both have a stream open and neither receives the
other's payments.

The stream connects directly to the API rather than through the Next.js
rewrite, because the rewrite buffers streaming responses and cuts the
connection.

---

## Running it locally

**Requirements:** Node 20+, PostgreSQL 15+, Redis.

### 1. Database

```bash
psql -U postgres -c "CREATE DATABASE edulevy_db;"
psql -U postgres -d edulevy_db -f sql/001_init.sql
psql -U postgres -d edulevy_db -f sql/003_app_role.sql
psql -U postgres -d edulevy_db -f sql/004_audit_lockdown.sql
psql -U postgres -d edulevy_db -f sql/005_checkout_request_id.sql
psql -U postgres -d edulevy_db -f sql/006_payment_lookup.sql
psql -U postgres -d edulevy_db -f sql/007_receipt_token.sql
```

`003_app_role.sql` creates `edulevy_app`. Set its password:

```bash
psql -U postgres -d edulevy_db -c "ALTER ROLE edulevy_app WITH LOGIN PASSWORD 'your-password';"
```

### 2. Environment

Copy `.env.example` to `.env` and fill in:

```dotenv
PG_HOST=localhost
PG_PORT=5432
PG_USER=edulevy_app          # NOT postgres — superusers bypass RLS
PG_PASSWORD=
PG_DATABASE=edulevy_db

REDIS_URL=redis://localhost:6379
PORT=4000
PUBLIC_URL=https://your-tunnel-url

MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
MPESA_SHORTCODE=174379
MPESA_PASSKEY=
MPESA_CALLBACK_URL=https://your-tunnel-url/webhook/mpesa/callback

PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_CALLBACK_URL=https://your-tunnel-url/health

AT_USERNAME=sandbox
AT_API_KEY=

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

### 3. Seed demo data (development only)

```bash
cd api && npm install && node seed-demo.js
```

Creates two schools with students, guardians, staff and payment history.
**Skip this for a real deployment.**

You will also need staff accounts — see `make-user.js` and `make-manager.js`.

### 4. Run

```bash
cd api && node src/app.js       # port 4000
cd client && npm run dev        # port 3000
```

Dashboard at `http://localhost:3000`.

### 5. External channels

Webhooks need a public URL:

```bash
ngrok http 4000
```

Then set the tunnel URL plus the path in each provider's dashboard:

| Provider | Path |
|---|---|
| Africa's Talking USSD | `/webhook/ussd` |
| M-Pesa Daraja | `/webhook/mpesa/callback` |
| Paystack (webhook, not callback) | `/webhook/paystack` |
| Twilio WhatsApp sandbox | `/webhook/whatsapp` |

**Free tunnels rotate their URL on restart**, so all four need updating each
time. The Twilio sandbox join also expires after 72 hours.

---

## Deploying for a real school

Run the migrations on an **empty** database and skip the seed entirely.

Then provision the school and its first manager. This has to happen outside
the application, because someone must exist before anyone can log in:

```bash
node provision.js green-hills "Green Hills School" 001 head@school.ac.ke password
```

Everything after that happens through the dashboard: staff, students,
guardians, fee items, charges.

---

## What is not built

Named precisely, because naming limitations accurately is an engineering
signal rather than an apology.

**Scheduled payroll generation.** The design has a BullMQ job running daily at
06:00 `Africa/Nairobi` that creates a draft on the 28th, made safe by
`UNIQUE (tenant_id, period)`. The endpoints and the dashboard button exist;
the scheduler does not. Runs are created manually.

**User administration.** A manager cannot create a bursar account. Staff
accounts are created by script. The endpoint is designed, not built.

**Editing a drafted payroll run.** A manager can deactivate a staff member,
which excludes them from future runs, but cannot remove a line from a run
already drafted.

**Parent PIN.** The schema has `pin_hash`, `failed_pin_attempts` and
`pin_locked_at`, and `tenants.pin_auth_enabled` toggles it per school. The
flow — create, verify, three-attempt lockout, bursar-only reset — is designed
but not implemented. Reset is deliberately not self-service: if a parent could
reset their PIN by dialling in, anyone holding the handset could too.

**Announcement delivery.** Announcements create one delivery row per intended
recipient before anything is sent, so the bursar can answer "did Mary get it?".
The worker that sends them and updates each status does not exist — rows stay
`queued`.

**Payment allocations.** The table exists so a payment can be split across
specific charges, answering "is the trip paid?" rather than only "what is the
balance?". It is not yet populated.

**Bulk student import.** Adding 400 students at the start of term needs a CSV
upload. Today they are added one at a time or seeded.

**Rate limiting on login**, specified in `docs/API.md` as a Redis sliding
window, is not implemented.

**A global error handler.** An unexpected throw currently leaves the client
waiting rather than returning a clean 500.

**Automated tests.** Isolation is verified by hand against the three attack
tests below. There is no test suite.

### Sandbox constraints

M-Pesa settlement is demonstrated with a simulated callback. Safaricom's
sandbox accepts the STK Push for its designated test number but that number
never answers a PIN prompt, so every real attempt times out with result code
1037. The callback handler is identical either way.

WhatsApp runs on Twilio's shared sandbox, which requires each tester to send
a join code and does not reliably deliver internationally. A registered
WhatsApp sender needs Meta business verification.

A live `*384*XXXX#` short code requires telco approval and payment. The
Africa's Talking simulator is used instead.

---

## Verifying isolation

Three tests, run as `edulevy_app` — never as `postgres`.

**An unfiltered query returns only one school's rows**

```sql
BEGIN;
SET LOCAL app.current_tenant = '<tenant-uuid>';
SELECT admission_no, full_name FROM students;
COMMIT;
```

Forty students exist across two schools. Twenty-four are returned. There is no
`WHERE` clause.

**A known primary key from another school returns nothing**

```sql
BEGIN;
SET LOCAL app.current_tenant = '<school-a-uuid>';
SELECT * FROM students WHERE id = '<school-b-student-uuid>';
COMMIT;
```

Zero rows. Note it returns nothing rather than an access-denied error — an
error would confirm the id exists somewhere.

**No tenant context fails closed**

```sql
SELECT * FROM students;
```

Errors rather than returning everything. How a security control behaves when
misconfigured matters more than how it behaves when correct.

**And the audit log cannot be tampered with**

```sql
INSERT INTO audit_log ...   -- succeeds
DELETE FROM audit_log       -- ERROR: permission denied
```

---

## Stack

Express · PostgreSQL · Redis · Next.js · M-Pesa Daraja · Paystack ·
Africa's Talking · Twilio · Argon2 · pdfkit

JavaScript throughout, front and back.

---

## API

Every endpoint is specified in [`docs/API.md`](docs/API.md) with request body,
response shape and error codes.