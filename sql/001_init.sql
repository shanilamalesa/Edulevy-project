-- ============================================================
-- EDULEVY — DATABASE SCHEMA
-- Multi-tenant school fee collection and payroll platform
-- ============================================================
--
-- KEY DECISIONS 
--
--   Isolation : shared tables + tenant_id, Postgres RLS with FORCE.
--   Money     : bigint in minor units (cents). Never float — decimals
--               cannot be represented exactly and errors accumulate.
--   Balance   : DERIVED (charges + adjustments - payments), never stored.
--               A stored column would let two concurrent payments read
--               the same value and overwrite each other, losing one.
--   Ids       : UUID, not sequential. Sequential ids can be enumerated
--               and leak how many tenants exist.
--   Ledger    : charges, payments and adjustments are APPEND ONLY.
--               Corrections are new rows, never UPDATEs.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1. REGISTRY
-- ============================================================

-- NOT RLS-protected. This is the table that RESOLVES tenancy, so it
-- must be readable before any tenant context exists. Lookup by
-- ussd_ext is the only query in the system permitted to run outside
-- a tenant-scoped transaction.
CREATE TABLE tenants (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug              VARCHAR(100) NOT NULL UNIQUE,
    name              VARCHAR(255) NOT NULL,
    ussd_ext          CHAR(3) UNIQUE,                  -- dialled school code
    status            VARCHAR(50) NOT NULL DEFAULT 'active',
    pin_auth_enabled  BOOLEAN NOT NULL DEFAULT FALSE,  -- per-school PIN toggle
    country_code      CHAR(2) NOT NULL DEFAULT 'KE',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);


-- Staff who log into the dashboard. One user belongs to ONE school.
-- Bursar and manager are the same kind of thing with different
-- permissions, so this is one table with a role column, not two tables.
CREATE TABLE users (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    email          VARCHAR(255) NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,
    role           VARCHAR(50) NOT NULL CHECK (role IN ('bursar', 'manager')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ
);


CREATE TABLE students (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    admission_no  VARCHAR(50) NOT NULL,
    full_name     VARCHAR(255) NOT NULL,
    class_label   VARCHAR(50),                 -- nullable: may be unassigned
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ
);


-- Parents, grandparents, sponsors — anyone who pays or checks a balance.
-- One table, because they all play the same role in the system.
--
-- msisdn MUST be normalised to E.164 (+254...) before insert. Without
-- that, "0712...", "254712..." and "+254712..." are three different
-- strings and the unique constraint catches none of them.
--
-- The phone number is the parent's credential: USSD has no login, and
-- the network supplies the caller's number so it cannot be forged.
CREATE TABLE guardians (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    msisdn               VARCHAR(20) NOT NULL,
    full_name            VARCHAR(255),
    pin_hash             VARCHAR(255),              -- hashed, never plaintext
    failed_pin_attempts  SMALLINT NOT NULL DEFAULT 0,
    pin_locked_at        TIMESTAMPTZ,               -- set after 3 failures
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Scoped to tenant so a parent with children at two schools can
    -- register at both. Globally unique would block the second school.
    CONSTRAINT uq_guardians_msisdn_tenant UNIQUE (tenant_id, msisdn)
);


-- Which guardian may access which student.
--
-- Many-to-many: one parent has several children, one child has several
-- parents. Neither side can hold the link, so it needs its own table.
--
-- THIS IS THE AUTHORIZATION BOUNDARY FOR USSD AND WHATSAPP. An inbound
-- caller is shown only the children linked to their number, so there is
-- no admission number to enumerate.
CREATE TABLE guardian_students (
    guardian_id  UUID NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
    student_id   UUID NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
    tenant_id    UUID NOT NULL REFERENCES tenants(id)   ON DELETE RESTRICT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (guardian_id, student_id)
);


-- People who receive a salary. They do NOT log in — no dashboard,
-- no password. They appear on payroll and receive notifications.
CREATE TABLE staff (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    full_name    VARCHAR(255) NOT NULL,
    msisdn       VARCHAR(20) NOT NULL,
    role_title   VARCHAR(100),
    gross_minor  BIGINT NOT NULL CHECK (gross_minor > 0),
    active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ,

    CONSTRAINT uq_staff_msisdn_tenant UNIQUE (tenant_id, msisdn)
);


-- ============================================================
-- 2. LEDGER
-- ============================================================

CREATE TABLE fee_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    code          VARCHAR(50) NOT NULL,
    label         VARCHAR(255) NOT NULL,
    category      VARCHAR(100) NOT NULL
                  CHECK (category IN ('tuition', 'trip', 'club', 'sport')),
    amount_minor  BIGINT NOT NULL CHECK (amount_minor > 0),
    currency      CHAR(3) NOT NULL DEFAULT 'KES',
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_fee_items_code_tenant UNIQUE (tenant_id, code)
);


-- A fee item applied to a student. This is what creates debt.
CREATE TABLE charges (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id)   ON DELETE RESTRICT,
    student_id    UUID NOT NULL REFERENCES students(id)  ON DELETE RESTRICT,
    fee_item_id   UUID NOT NULL REFERENCES fee_items(id) ON DELETE RESTRICT,
    amount_minor  BIGINT NOT NULL CHECK (amount_minor > 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Money that actually arrived.
--
-- student_id is NULLABLE ON PURPOSE. If a parent mistypes an admission
-- number the money has already left their account — Safaricom has it.
-- It must be RECORDED and reconciled later, never rejected. Rejecting
-- it means money exists in the school's account and nowhere in the system.
--
-- The unique constraint is GLOBAL, not tenant-scoped. A provider
-- reference is globally unique, so scoping it per tenant would allow the
-- same payment to be inserted once per school — meaning one payment
-- recorded twice if tenant resolution ever went wrong.
--
-- Idempotency pattern: INSERT and catch the violation. Never
-- check-then-insert — two simultaneous callbacks would both pass the check.
CREATE TABLE payments (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    student_id           UUID REFERENCES students(id)         ON DELETE RESTRICT,
    paid_by_guardian_id  UUID REFERENCES guardians(id)        ON DELETE RESTRICT,
    provider             VARCHAR(100) NOT NULL,
    provider_ref         VARCHAR(255) NOT NULL,   -- M-Pesa receipt number
    amount_minor         BIGINT NOT NULL CHECK (amount_minor > 0),
    status               VARCHAR(50) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'settled', 'failed')),
    raw_payload          JSONB NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_payments_provider_ref UNIQUE (provider, provider_ref)
);


-- Which charges a payment was applied to.
--
-- Needed because a single payment can cover several charges, or part of
-- one. The USSD flow asks the parent to pick a category, so that
-- information exists and should not be thrown away otherwise the
-- system knows a total balance but cannot say whether the trip is paid.
--
-- Anything unallocated is general credit against the student.
CREATE TABLE payment_allocations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id)  ON DELETE RESTRICT,
    payment_id    UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    charge_id     UUID NOT NULL REFERENCES charges(id)  ON DELETE RESTRICT,
    amount_minor  BIGINT NOT NULL CHECK (amount_minor > 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_payment_allocation UNIQUE (payment_id, charge_id)
);


-- ADJUSTMENTS
-- Changes to what a student owes where no money changes hands.
-- e.g. school waives 5,000 of Amina's 12,000 fee -> she now owes 7,000.
--
-- Not a payment (no money arrived) and cannot edit the charge
-- (ledger is append only), so it is a third row type.
--
-- amount_minor is signed: negative reduces what is owed (waiver,
-- bursary), positive increases it (correcting a mistyped charge).
--
-- reason and actor_user_id are NOT NULL so every waiver has a
-- name and a justification attached.
CREATE TABLE adjustments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id)  ON DELETE RESTRICT,
    student_id     UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
    kind           VARCHAR(50) NOT NULL
                   CHECK (kind IN ('waiver', 'bursary', 'reversal', 'correction')),
    amount_minor   BIGINT NOT NULL CHECK (amount_minor <> 0),
    reason         TEXT NOT NULL,
    actor_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- 3. ADMINISTRATIVE WORKFLOW
-- ============================================================

-- Permanent record of every privileged action. Append only: no
-- UPDATE route, no DELETE route, no updated_at column.
--
-- Records fee waivers, bursaries, payment reversals, payroll approval,
-- and parent PIN resets — who did it, what they did, and when.
CREATE TABLE audit_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    user_id      UUID REFERENCES users(id) ON DELETE RESTRICT,  -- null = system
    action       VARCHAR(100) NOT NULL,      -- 'fee.waived', 'pin.reset'
    target_type  VARCHAR(100) NOT NULL,      -- 'student', 'guardian'
    target_id    UUID NOT NULL,
    changes      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- One monthly payroll batch per school.
--
-- UNIQUE (tenant_id, period) is the IDEMPOTENCY GUARD. If the cron
-- fires twice — retry, redeploy, or two worker instances — the second
-- insert violates the constraint and short-circuits harmlessly.
--
-- approved_by/at and paid_by/at are separate on purpose: this is
-- separation of duties made visible. Deciding the amount is correct and
-- confirming the money left are two different acts.
--
-- The system does NOT move money. M-Pesa B2C is out of scope, so the
-- actual transfer happens outside the system and is then recorded here.
CREATE TABLE payroll_runs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    period        CHAR(7) NOT NULL,                    -- '2026-08'
    status        VARCHAR(50) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'approved', 'paid', 'cancelled')),
    total_minor   BIGINT NOT NULL DEFAULT 0,
    created_by    UUID REFERENCES users(id) ON DELETE RESTRICT,  -- null = cron
    approved_by   UUID REFERENCES users(id) ON DELETE RESTRICT,
    approved_at   TIMESTAMPTZ,
    paid_by       UUID REFERENCES users(id) ON DELETE RESTRICT,
    paid_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_payroll_period UNIQUE (tenant_id, period)
);


-- PAYROLL_LINES
-- One row per staff member per run. The run is the month;
-- these are the individual payslips in it.
--
-- gross_minor is SNAPSHOTTED here rather than joined from staff at read
-- time. If a teacher gets a raise in September, August's record must
-- still show August's figure. Historical records do not move.
CREATE TABLE payroll_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id)      ON DELETE RESTRICT,
    payroll_run_id  UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
    staff_id        UUID NOT NULL REFERENCES staff(id)        ON DELETE RESTRICT,
    gross_minor     BIGINT NOT NULL CHECK (gross_minor > 0),
    notified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_staff_per_payroll_run UNIQUE (payroll_run_id, staff_id)
);

-- PAYROLL_LINES
-- One row per staff member per run. The run is the month;
-- these are the individual payslips in it.

CREATE TABLE announcements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    created_by          UUID NOT NULL REFERENCES users(id)   ON DELETE RESTRICT,
    title               VARCHAR(255) NOT NULL,
    body                TEXT NOT NULL,
    target_type         VARCHAR(50) NOT NULL DEFAULT 'all'
                        CHECK (target_type IN ('all', 'class')),
    target_class_label  VARCHAR(50),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_announcement_target CHECK (
        (target_type = 'all'   AND target_class_label IS NULL) OR
        (target_type = 'class' AND target_class_label IS NOT NULL)
    )
);


-- One row per recipient, so a single bad phone number does not
-- obscure whether everyone else received the message.
--
-- USSD is NOT a valid channel: it is caller-initiated only. You cannot
-- push a message to someone who has not dialled in.
CREATE TABLE announcement_deliveries (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id)       ON DELETE RESTRICT,
    announcement_id  UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    guardian_id      UUID NOT NULL REFERENCES guardians(id)     ON DELETE CASCADE,
    channel          VARCHAR(50) NOT NULL CHECK (channel IN ('sms', 'whatsapp')),
    status           VARCHAR(50) NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'sent', 'delivered', 'failed')),
    error_message    TEXT,
    sent_at          TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_delivery_per_guardian UNIQUE (announcement_id, guardian_id)
);


-- ============================================================
-- 4. DERIVED BALANCE
--
-- Balance is charges + adjustments - settled payments.
-- A NEGATIVE balance is a CREDIT, not an error: it carries forward to
-- the next term automatically. Had balance been a stored column,
-- overpayment would likely have been clamped at zero and the parent's
-- money silently lost.
-- ============================================================

CREATE OR REPLACE VIEW student_balances AS
SELECT
    s.tenant_id,
    s.id            AS student_id,
    s.admission_no,
    s.full_name,
    s.class_label,
    COALESCE(c.total, 0) AS charged_minor,
    COALESCE(p.total, 0) AS paid_minor,
    COALESCE(a.total, 0) AS adjusted_minor,
    (COALESCE(c.total, 0) + COALESCE(a.total, 0) - COALESCE(p.total, 0))
                         AS balance_minor
FROM students s
LEFT JOIN (
    SELECT student_id, SUM(amount_minor) AS total
    FROM charges GROUP BY student_id
) c ON c.student_id = s.id
LEFT JOIN (
    SELECT student_id, SUM(amount_minor) AS total
    FROM payments WHERE status = 'settled' GROUP BY student_id
) p ON p.student_id = s.id
LEFT JOIN (
    SELECT student_id, SUM(amount_minor) AS total
    FROM adjustments GROUP BY student_id
) a ON a.student_id = s.id
WHERE s.deleted_at IS NULL;


-- ============================================================
-- 5. INDEXES
-- ============================================================

-- Case-insensitive and soft-delete aware: a deleted student's
-- admission number can be reused by a new student.
CREATE UNIQUE INDEX uq_active_users_email
    ON users(tenant_id, lower(email))           WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_active_students_admission
    ON students(tenant_id, upper(admission_no)) WHERE deleted_at IS NULL;

-- tenant_id leads every composite index because RLS filters on it in
-- every single query. Composite indexes work left to right.
CREATE INDEX idx_charges_student     ON charges(tenant_id, student_id);
CREATE INDEX idx_payments_student    ON payments(tenant_id, student_id);
CREATE INDEX idx_adjustments_student ON adjustments(tenant_id, student_id);
CREATE INDEX idx_alloc_payment       ON payment_allocations(tenant_id, payment_id);
CREATE INDEX idx_alloc_charge        ON payment_allocations(tenant_id, charge_id);

-- USSD critical path: the parent is waiting on a blank screen.
CREATE INDEX idx_guardians_msisdn    ON guardians(tenant_id, msisdn);
CREATE INDEX idx_gs_student          ON guardian_students(student_id);

-- Reconciliation screen only ever asks for orphans, so index only those.
CREATE INDEX idx_payments_unmatched  ON payments(tenant_id)
    WHERE student_id IS NULL;

CREATE INDEX idx_fee_items_active    ON fee_items(tenant_id, category)
    WHERE active = TRUE;
CREATE INDEX idx_staff_active        ON staff(tenant_id) WHERE active = TRUE;
CREATE INDEX idx_audit_target        ON audit_log(tenant_id, target_type, target_id);
CREATE INDEX idx_payroll_lines_run   ON payroll_lines(tenant_id, payroll_run_id);


-- ============================================================
-- 6. ROW-LEVEL SECURITY
--
-- FORCE is required: RLS does NOT apply to the table owner by default,
-- and the application connects as owner. Without FORCE the policies are
-- silently bypassed and an isolation test passes for the wrong reason.
--
-- app.current_tenant is set per request with SET LOCAL, which only
-- works inside an explicit transaction. Outside one it silently does
-- nothing — test that case deliberately.
--
-- tenant_id is read ONLY from the server-side session record. Never
-- from a request body, query parameter, header, or subdomain.
-- ============================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'students', 'guardians', 'guardian_students', 'staff',
    'fee_items', 'charges', 'payments', 'payment_allocations',
    'adjustments', 'audit_log', 'payroll_runs', 'payroll_lines',
    'announcements', 'announcement_deliveries'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_setting(''app.current_tenant'')::uuid)', t);
  END LOOP;
END $$;