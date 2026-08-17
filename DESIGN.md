### CORE QUESTION:

1. Who is a tenant?
-->One school = one tenant. Primary, secondary, or a training organisation.

2. How do tenants sign up?
-->Admin-provisioned by the platform owner. No public self-serve signup.

3. What is the isolation boundary?
-->Row-level, using PostgreSQL Row-Level Security with FORCE, plus application-level checks. Two independent layers.

4. What happens on deletion?

Soft delete immediately, hard delete after 30 days.
-->Immediate soft delete means the school disappears from the interface at once. The 30-day window exists because deletion is sometimes a mistake, and because financial records shouldn't evaporate the moment someone clicks a button.

5. Can one user belong to multiple tenants?
-->No. One user belongs to exactly one school.

6. Minimum first-day feature set
        - Log in and reach the dashboard
        - Add students
        - Create fee items and assign charges
        - See the list of students with balances
        - Receive a payment via USSD and see it appear

7. Upgrade path to paid
-->transaction fee or per-term subscription per school, and it's out of scope for this sprint. There is no billing system, no plan tiers, no payment gating.

8. Data volume
-->100 to 1,000 schools. Take one to a thousand schools at, say, 500 students each that's up to 500,000 students, and maybe a few million payment rows a year. That is comfortably within a single well-indexed Postgres instance.