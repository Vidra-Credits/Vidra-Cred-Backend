ALTER TABLE clients ADD COLUMN approval varchar(10) NOT NULL DEFAULT 'APROBADO' CHECK (approval IN ('PENDIENTE','APROBADO','RECHAZADO'));
ALTER TABLE clients ADD COLUMN approval_note varchar(300) NOT NULL DEFAULT '';
ALTER TABLE packages ADD COLUMN image varchar(200) CHECK (image IS NULL OR image ~ '^/productos/[A-Za-z0-9._-]+$');
CREATE TABLE purchase_requests (
  id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES stores(id), client_id uuid NOT NULL, package_id uuid NOT NULL,
  purchase_date date NOT NULL, months smallint NOT NULL CHECK (months BETWEEN 1 AND 5), grace varchar(10) NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'PENDIENTE' CHECK (status IN ('PENDIENTE','APROBADA','RECHAZADA','CANCELADA')),
  credit_id uuid REFERENCES credits(id), note varchar(300) NOT NULL DEFAULT '', idempotency_key uuid UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), resolved_by uuid REFERENCES users(id), resolved_at timestamptz,
  FOREIGN KEY(client_id,store_id) REFERENCES clients(id,store_id), FOREIGN KEY(package_id,store_id) REFERENCES packages(id,store_id)
);
CREATE INDEX requests_store ON purchase_requests(store_id,status,created_at);
CREATE INDEX requests_client ON purchase_requests(client_id,created_at);
INSERT INTO schema_migrations(version) VALUES(2);
