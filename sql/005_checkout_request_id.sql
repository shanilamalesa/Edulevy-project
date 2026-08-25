-- CheckoutRequestID identifies a push ATTEMPT; the M-Pesa receipt number
-- identifies a completed PAYMENT. They are different things, so they get
-- different columns.
--
-- provider_ref (the receipt) stays the idempotency key, but is only known
-- once a payment succeeds — so it must be nullable while pending.

ALTER TABLE payments ADD COLUMN checkout_request_id VARCHAR(255);
ALTER TABLE payments ALTER COLUMN provider_ref DROP NOT NULL;

CREATE INDEX idx_payments_checkout ON payments(tenant_id, checkout_request_id);