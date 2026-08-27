-- No RLS: this is what RESOLVES the tenant for an incoming callback,
-- so it must be readable before any tenant is known. Same role that
-- tenants plays for USSD dial codes.
CREATE TABLE payment_lookup (
  checkout_request_id VARCHAR(255) PRIMARY KEY,
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  payment_id          UUID NOT NULL
);