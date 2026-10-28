-- Fixed ids so the students below and the scripts in api/ (seed-demo.js,
-- make-manager.js, ...) point at the same tenants on every fresh database.
INSERT INTO tenants (id, slug, name, ussd_ext)
VALUES  ('eadd75ae-1946-45f7-a73b-ea2b850b8d2c', 'Green-hills', 'Green-Hills School', '001'),
        ('41c2bc98-5776-489f-9f10-085fab23bc8a', 'St-mary', 'St-Marys School', '002');

BEGIN;
SET LOCAL app.current_tenant = 'eadd75ae-1946-45f7-a73b-ea2b850b8d2c';

INSERT INTO students (tenant_id, admission_no, full_name, class_label) VALUES
  ('41c2bc98-5776-489f-9f10-085fab23bc8a', 'ADM-001', 'Salha Ally',  'Form 2'),
  ('41c2bc98-5776-489f-9f10-085fab23bc8a', 'ADM-002', 'Barack Obama',  'Form 2'),
  ('41c2bc98-5776-489f-9f10-085fab23bc8a', 'ADM-003', 'Samia Suluhu',    'Form 3');

COMMIT;