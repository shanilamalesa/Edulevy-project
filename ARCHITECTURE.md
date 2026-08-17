### Multi-tenancy
*** pattern ***
-shared tables with a `tenant_id` column, with postgres row-level security enforces isolation at the database level.

*** Tenant ***
-One school institution. One user belongs to exactly one tenant.

*** Why this pattern ***
->Why this pattern: We expect hundreds of schools rather than tens. Schema-per-tenant would mean running every database change once per school, and database-per-tenant would mean maintaining hundreds of separate databases —both are too much work at this scale. Shared tables keep one set of migrations and one connection pool.

The weakness of shared tables is that every query must remember to filter by school, and one forgotten filter leaks data. Row-level security removes that risk: even if a query forgets, Postgres only returns rows belonging to the school the bursar logged into.

**Tenant resolution:**
- Dashboard: session holds `tenant_id`; middleware sets `app.current_tenant`
- USSD: three-digit school code entered by the caller
- WhatsApp: the school's registered number

**Exception:** the school lookup by dial code is the only query that runs
outside a tenant-scoped transaction.

**RLS:** `ENABLE` *and* `FORCE` on every tenant-scoped table. FORCE is
required because the application connects as the table owner, and RLS
does not apply to the owner by default.

**Bypass role:** reconciliation only. The payroll job loops per tenant
rather than using bypass.

**Deletion:** soft-delete for 30 days, then hard-delete via cron
(designed, not built this sprint).
