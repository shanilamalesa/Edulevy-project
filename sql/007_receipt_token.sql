-- A receipt link is sent by SMS and opened without logging in, so the
-- token must be unguessable. Sequential ids would let anyone read
-- another family's receipts.
ALTER TABLE payments ADD COLUMN receipt_token VARCHAR(64);
CREATE UNIQUE INDEX uq_payments_receipt_token ON payments(receipt_token)
  WHERE receipt_token IS NOT NULL;