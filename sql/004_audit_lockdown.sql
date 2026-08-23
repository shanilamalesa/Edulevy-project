-- The audit log is append-only. The application can INSERT but the
-- database physically refuses UPDATE and DELETE — so "cannot be edited
-- or deleted" is enforced by Postgres, not by the absence of a route.
REVOKE UPDATE, DELETE ON audit_log FROM edulevy_app;