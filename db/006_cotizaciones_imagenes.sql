ALTER TABLE purchase_requests
  ALTER COLUMN frequency SET DEFAULT 'MENSUAL',
  ADD COLUMN quote_fingerprint char(64),
  ADD COLUMN quote_snapshot jsonb,
  ADD COLUMN review_issue text,
  ADD COLUMN resolution_key uuid UNIQUE,
  ADD CONSTRAINT requests_quote_check CHECK (
    (quote_fingerprint IS NULL) = (quote_snapshot IS NULL)
  );

ALTER TABLE packages
  ADD COLUMN image_data bytea,
  ADD COLUMN image_mime varchar(12),
  ADD CONSTRAINT packages_uploaded_image_check CHECK (
    (image_data IS NULL AND image_mime IS NULL) OR
    (image_data IS NOT NULL AND image_mime IS NOT NULL AND
      octet_length(image_data) BETWEEN 1 AND 1048576 AND
      image_mime IN ('image/jpeg', 'image/png', 'image/webp'))
  );

CREATE TABLE entity_saves (
  idempotency_key uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  fingerprint char(64) NOT NULL,
  entity_id uuid NOT NULL
);

ALTER TABLE users ADD COLUMN signup_key uuid UNIQUE;

INSERT INTO schema_migrations(version) VALUES(6);
