CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE stores (
  id uuid PRIMARY KEY, name varchar(120) NOT NULL, business varchar(60) NOT NULL, ruc char(11) UNIQUE NOT NULL CHECK (ruc ~ '^[0-9]{11}$'),
  cut_day smallint NOT NULL CHECK (cut_day BETWEEN 1 AND 31), pay_day smallint NOT NULL CHECK (pay_day BETWEEN 1 AND 30), active boolean NOT NULL DEFAULT true
);
CREATE TABLE clients (
  id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES stores(id), name varchar(150) NOT NULL, document varchar(11) NOT NULL CHECK (document ~ '^([0-9]{8}|[0-9]{11})$'),
  phone varchar(20) NOT NULL DEFAULT '', address varchar(200) NOT NULL DEFAULT '', currency char(3) NOT NULL CHECK (currency IN ('PEN','USD')),
  tea numeric(20,12) NOT NULL CHECK (tea BETWEEN 0.15 AND 0.25), credit_limit numeric(14,2) NOT NULL CHECK (credit_limit BETWEEN 1000 AND 1000000),
  max_months smallint NOT NULL CHECK (max_months BETWEEN 1 AND 5), active boolean NOT NULL DEFAULT true, UNIQUE(store_id,document), UNIQUE(id,store_id)
);
CREATE TABLE users (
  id uuid PRIMARY KEY, store_id uuid REFERENCES stores(id), client_id uuid, email varchar(120) UNIQUE NOT NULL, name varchar(120) NOT NULL,
  password_hash text NOT NULL, role varchar(10) NOT NULL CHECK (role IN ('SISTEMA','NEGOCIO','CLIENTE')), active boolean NOT NULL DEFAULT true,
  FOREIGN KEY(client_id,store_id) REFERENCES clients(id,store_id),
  CHECK ((role='SISTEMA' AND store_id IS NULL AND client_id IS NULL) OR (role='NEGOCIO' AND store_id IS NOT NULL AND client_id IS NULL) OR (role='CLIENTE' AND store_id IS NOT NULL AND client_id IS NOT NULL))
);
CREATE TABLE packages (
  id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES stores(id), name varchar(120) NOT NULL, detail varchar(500) NOT NULL,
  currency char(3) NOT NULL CHECK(currency IN ('PEN','USD')), amount numeric(14,2) NOT NULL CHECK (amount BETWEEN 1000 AND 5000 AND mod(amount,100)=0),
  active boolean NOT NULL DEFAULT true, UNIQUE(id,store_id)
);
CREATE TABLE credits (
  id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES stores(id), client_id uuid NOT NULL, package_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
  purchase_date date NOT NULL, amount numeric(14,2) NOT NULL CHECK(amount BETWEEN 1000 AND 5000 AND mod(amount,100)=0), currency char(3) NOT NULL CHECK(currency IN ('PEN','USD')),
  tea numeric(20,12) NOT NULL CHECK(tea BETWEEN 0.15 AND 0.25), mora numeric(20,12) NOT NULL CHECK(mora=0.35), months smallint NOT NULL CHECK(months BETWEEN 1 AND 5),
  initial_balance numeric(14,2) NOT NULL, initial_interest numeric(14,2) NOT NULL, cut_date date NOT NULL, base_date date NOT NULL,
  snapshot jsonb NOT NULL, legal_reference jsonb, idempotency_key uuid UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(client_id,store_id) REFERENCES clients(id,store_id), FOREIGN KEY(package_id,store_id) REFERENCES packages(id,store_id), UNIQUE(id,store_id)
);
CREATE TABLE installments (
  id uuid PRIMARY KEY, credit_id uuid NOT NULL REFERENCES credits(id), number smallint NOT NULL CHECK(number BETWEEN 1 AND 10), due_date date NOT NULL,
  grace char(1) NOT NULL CHECK(grace IN ('T','P','S')), opening numeric(14,2) NOT NULL, interest numeric(14,2) NOT NULL CHECK(interest>=0),
  payment numeric(14,2) NOT NULL CHECK(payment>=0), principal numeric(14,2) NOT NULL CHECK(principal>=0), closing numeric(14,2) NOT NULL CHECK(closing>=0), capitalized numeric(14,2) NOT NULL CHECK(capitalized>=0),
  UNIQUE(credit_id,number), CHECK(payment=interest+principal OR grace='T'), CHECK(grace<>'T' OR (payment=0 AND principal=0 AND capitalized=interest))
);
CREATE TABLE payments (
  id uuid PRIMARY KEY, installment_id uuid UNIQUE NOT NULL REFERENCES installments(id), user_id uuid NOT NULL REFERENCES users(id), paid_date date NOT NULL,
  late_days integer NOT NULL CHECK(late_days>=0), late_fee numeric(14,2) NOT NULL CHECK(late_fee>=0), interest numeric(14,2) NOT NULL CHECK(interest>=0),
  principal numeric(14,2) NOT NULL CHECK(principal>=0), total numeric(14,2) NOT NULL CHECK(total>0), reference varchar(120) NOT NULL,
  idempotency_key uuid UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CHECK(total=late_fee+interest+principal)
);
CREATE TABLE sessions (
  token_hash char(64) PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid REFERENCES users(id), store_id uuid REFERENCES stores(id), action varchar(60) NOT NULL,
  entity_id uuid, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credits_client ON credits(client_id,purchase_date);
CREATE INDEX credits_store ON credits(store_id);
CREATE INDEX installment_due ON installments(due_date);
CREATE INDEX audit_store ON audit(store_id,created_at);
CREATE TABLE login_attempts (key_hash char(64) PRIMARY KEY, attempts integer NOT NULL, last_attempt timestamptz NOT NULL DEFAULT now());
INSERT INTO schema_migrations(version) VALUES(1);
